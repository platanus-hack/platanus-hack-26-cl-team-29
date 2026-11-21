import express from 'express';
import { ErrorRed } from '../red/dominio.ts';
import type { Red } from '../red/dominio.ts';
import type { Catalogos, ProveedorCatalogo } from './index.ts';
import { origenArchivos } from './origenes.ts';

/**
 * Rutas `/api/red/proveedor/catalogo`, montadas detrás de la sesión del proveedor (rutas-web.ts), que deja en
 * `res.locals.proveedor` su id y su RUT. El proveedor no carga nada: su catálogo se arma solo la primera vez que lo pide.
 */
export function crearRutasCatalogo(catalogos: Catalogos, red: Red): express.Router {
  const rutas = express.Router();
  const proveedor = (res: express.Response) => res.locals.proveedor as ProveedorCatalogo;

  rutas.get('/', (_req, res) => {
    res.json(catalogos.asegurar(proveedor(res)));
  });

  // Suma un producto del catálogo a la compra conjunta abierta, con los tramos que sugiere su historial.
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
