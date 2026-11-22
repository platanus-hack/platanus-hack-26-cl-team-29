import express from 'express';
import { ErrorRed } from '../red/dominio.ts';
import type { Red } from '../red/dominio.ts';
import type { Catalogos, ProveedorCatalogo } from './index.ts';
import { origenArchivos } from './origenes.ts';
import type { ProductoEscrito } from '../../shared/catalogo.ts';

/**
 * Rutas `/api/red/proveedor/catalogo`, montadas detrás de la sesión del proveedor (rutas-web.ts), que deja en
 * `res.locals.proveedor` su id y su RUT. Su catálogo se arma solo desde sus facturas la primera vez que lo pide; además
 * puede agregar productos a mano.
 */
/** El cuerpo de agregar o editar un producto, con los tipos de cada campo. */
function escrito(cuerpo: unknown): ProductoEscrito {
  const { nombre, unidad, tramos } = (cuerpo ?? {}) as Record<string, unknown>;
  const lista = Array.isArray(tramos) ? tramos as { desde?: unknown; precioUnitario?: unknown }[] : [];
  return { nombre: String(nombre ?? ''), unidad: String(unidad ?? ''), tramos: lista.map(t => ({ desde: Number(t?.desde), precioUnitario: Number(t?.precioUnitario) })) };
}

export function crearRutasCatalogo(catalogos: Catalogos, red: Red): express.Router {
  const rutas = express.Router();
  const proveedor = (res: express.Response) => res.locals.proveedor as ProveedorCatalogo;

  rutas.get('/', (_req, res) => {
    res.json(catalogos.asegurar(proveedor(res)));
  });

  // Su lista de productos: nombre, unidad de venta y tramos por cantidad (el primero, desde 1, es el precio base).
  rutas.post('/productos', async (req, res) => {
    res.status(201).json(await catalogos.agregar(proveedor(res), escrito(req.body)));
  });

  rutas.put('/productos/:clave', async (req, res) => {
    res.json(await catalogos.editar(proveedor(res), String(req.params.clave), escrito(req.body)));
  });

  rutas.delete('/productos/:clave', async (req, res) => {
    await catalogos.quitar(proveedor(res).id, String(req.params.clave));
    res.json({ ok: true });
  });

  // Suma un producto del catálogo a la compra conjunta abierta, con sus tramos.
  rutas.post('/productos/:clave/sumar', async (req, res) => {
    const p = proveedor(res);
    const producto = catalogos.producto(p.id, String(req.params.clave));
    if (!producto) throw new ErrorRed('no_encontrado', 'Ese producto no está en tu catálogo');
    const abierta = red.licitacionAbierta();
    if (!abierta) throw new ErrorRed('transicion_invalida', 'No hay una compra conjunta abierta');
    res.status(201).json(await red.crearProducto(abierta.id, {
      proveedorId: p.id, nombre: producto.nombre, unidad: producto.unidad, precio: producto.tramos[0].precioUnitario, tramos: producto.tramos,
    }));
  });

  return rutas;
}

/**
 * Ruta de operación del equipo, `/api/red/operacion/catalogo/:proveedorId/xml` (detrás de DEMO_TOKEN): carga un XML
 * de facturas que nos entregó el facturador del proveedor o que llegó a su casilla de intercambio. El cuerpo es el
 * XML tal cual (un DTE o un EnvioDTE). Se suma a lo ya cargado; el XML no se guarda.
 */
export function crearRutasOperacionCatalogo(catalogos: Catalogos, red: Red): express.Router {
  const rutas = express.Router();
  rutas.post('/:proveedorId/xml', express.raw({ type: () => true, limit: '10mb' }), async (req, res) => {
    const negocio = red.negocioPorId(String(req.params.proveedorId));
    if (!negocio || !(negocio.rol === 'proveedor' || negocio.vende)) throw new ErrorRed('no_encontrado', 'No existe ese proveedor');
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) throw new ErrorRed('datos_invalidos', 'El cuerpo debe ser el XML de las facturas');
    res.json(await catalogos.armar({ id: negocio.id, ...(negocio.rut ? { rut: negocio.rut } : {}) }, origenArchivos([req.body])));
  });
  return rutas;
}
