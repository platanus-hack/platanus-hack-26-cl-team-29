// Buscador de proveedores: API pública del módulo. Fuera de server/proveedores/ se importa solo este archivo.
//
// GET /api/proveedores?q=&categoria=&pagina=  → { total, pagina, paginas, conteos, resultados, mercadoPublico }
// GET /api/proveedores/:clave                → { proveedor: FichaProveedor, mercadoPublico } (clave = RUT o id de la red)
// Socket.io `red:evento` tipo `proveedores.actualizado` → { proveedores } cuando llegan giros del SII o clasificaciones.
//
// En segundo plano consulta los giros de cada RUT en la consulta pública del SII (`PROVEEDORES_SII=0` lo apaga) y
// clasifica con la IA los que siguen sin categoría. Todo queda en caché por RUT (Postgres si hay base).
import express from 'express';
import type pg from 'pg';
import { esCategoria } from '../../shared/categorias.ts';
import { formatearRut, validarRut } from '../../shared/rut.ts';
import { crearClasificadorDesdeEnv } from '../ia/index.ts';
import type { MercadoPublicoDelServidor } from '../mercado-publico/index.ts';
import type { EventoRed, Red } from '../red/index.ts';
import { consultarContribuyentePublico, ErrorStc } from '../sii-portal/index.ts';
import {
  crearAlmacenEnriquecidosMemoria, crearAlmacenEnriquecidosPostgres, crearEnriquecedor,
  type AlmacenEnriquecidos, type Clasificar, type ConsultarSii,
} from './enriquecer.ts';
import { ambiguos, armarFichas, buscar, indexar, type Indice } from './fichas.ts';

export type { FichaProveedor, ResumenProveedor } from './fichas.ts';

/** Avisos de datos nuevos agrupados: a lo más uno cada tanto, para no inundar las pantallas mientras se enriquece. */
const AVISO_CADA_MS = 10_000;

/** La consulta pública del SII como la usa el enriquecedor: un RUT no registrado es null, no un error. */
const consultarStc: ConsultarSii = async rut => {
  try {
    const c = await consultarContribuyentePublico(rut);
    return { inicioActividades: c.fechaInicioActividades, giros: c.giros.map(g => ({ codigo: g.codigo, descripcion: g.descripcion })) };
  } catch (error) {
    if (error instanceof ErrorStc && error.noRegistrado) return null;
    throw error;
  }
};

export interface OpcionesProveedores {
  db: pg.Pool | null;
  red: Pick<Red, 'estadoDeLaRed' | 'escuchar'>;
  mercadoPublico: Pick<MercadoPublicoDelServidor, 'foto'>;
  emitir: (evento: EventoRed) => void;
  env?: NodeJS.ProcessEnv;
  consultarSii?: ConsultarSii;
  clasificar?: Clasificar;
  esperaMs?: number;
}

export async function iniciarProveedores(o: OpcionesProveedores) {
  const env = o.env ?? process.env;
  let almacen: AlmacenEnriquecidos | null = null;
  if (o.db) {
    try {
      almacen = await crearAlmacenEnriquecidosPostgres(o.db);
    } catch (error) {
      console.error('[proveedores] no se pudo usar Postgres, el enriquecimiento queda en memoria', error);
    }
  }
  const clasificarIa = crearClasificadorDesdeEnv(env);
  let version = 0;
  let pendientes = 0;
  let aviso: NodeJS.Timeout | undefined;
  const enriquecedor = await crearEnriquecedor({
    almacen: almacen ?? crearAlmacenEnriquecidosMemoria(),
    consultarSii: o.consultarSii ?? consultarStc,
    clasificar: o.clasificar ?? (e => clasificarIa(e)),
    esperaMs: o.esperaMs,
    alCambiar: () => {
      version++;
      pendientes++;
      aviso ??= setTimeout(() => {
        o.emitir({ tipo: 'proveedores.actualizado', datos: { proveedores: pendientes }, en: new Date().toISOString() });
        pendientes = 0;
        aviso = undefined;
      }, AVISO_CADA_MS);
      aviso.unref?.();
    },
  });
  const conSii = env.PROVEEDORES_SII !== '0';
  o.red.escuchar(() => version++);

  let ultimo: { foto: unknown; version: number; indice: Indice } | null = null;
  /** El índice vigente; se rearma solo si cambió la red, Mercado Público o el enriquecimiento. */
  function indice(): Indice {
    const foto = o.mercadoPublico.foto();
    if (ultimo?.foto === foto && ultimo.version === version) return ultimo.indice;
    const fichas = armarFichas(o.red.estadoDeLaRed(), foto, rut => enriquecedor.de(rut));
    ultimo = { foto, version, indice: indexar(fichas) };
    // Los que más venden primero: son los que más se buscan.
    if (conSii) enriquecedor.pedirSii(fichas.filter(f => f.rut).sort((a, b) => b.organismos - a.organismos).map(f => f.rut!));
    enriquecedor.pedirClasificacion(ambiguos(fichas, rut => enriquecedor.de(rut)));
    return ultimo.indice;
  }

  const meta = () => {
    const { fuente, hasta } = o.mercadoPublico.foto();
    return { mercadoPublico: { fuente, hasta } };
  };

  const rutas = express.Router();
  rutas.get('/', (req, res) => {
    const categoria = String(req.query.categoria ?? '');
    res.json({
      ...buscar(indice(), { q: String(req.query.q ?? '').slice(0, 100), categoria: esCategoria(categoria) ? categoria : undefined, pagina: Number(req.query.pagina) || 1 }),
      ...meta(),
    });
  });
  rutas.get('/:clave', (req, res) => {
    const rut = validarRut(req.params.clave);
    const clave = rut ? formatearRut(rut) : req.params.clave;
    const proveedor = indice().fichas.find(f => f.clave === clave);
    if (!proveedor) return void res.status(404).json({ error: 'no_encontrado', mensaje: 'No encontramos ese proveedor.' });
    res.json({ proveedor, ...meta() });
  });

  return { rutas, enCalma: () => enriquecedor.enCalma(), detener: () => { enriquecedor.detener(); clearTimeout(aviso); } };
}
