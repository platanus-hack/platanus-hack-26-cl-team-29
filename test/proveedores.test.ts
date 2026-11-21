import { test } from 'node:test';
import assert from 'node:assert/strict';
import { categoriaDeGiro, categoriaDeUnspsc } from '../shared/categorias.ts';
import { limpiarOrdenes } from '../server/mercado-publico/index.ts';
import type { OrdenMP, PrecioMP } from '../server/mercado-publico/normalizar.ts';
import type { EstadoRed } from '../server/red/index.ts';
import { crearAlmacenEnriquecidosMemoria, crearEnriquecedor } from '../server/proveedores/enriquecer.ts';
import { armarFichas, buscar, contactable, indexar, paraElMapa, sinContactoBuscado } from '../server/proveedores/fichas.ts';
import { telefonoChileno, validarContacto } from '../server/ia/index.ts';

const precio = (p: Partial<PrecioMP>): PrecioMP => ({
  orden: 'o', producto: 'Arroz grado 2, bolsa 1 kg', codigoProducto: 50221101, rubro: '', categoria: '', unidad: 'unidad',
  cantidad: 10, precioUnitario: 1000, fecha: '2026-11-01', despacho: '', organismo: 'Liceo A', ...p,
});
const orden = (codigo: string, rut: string, nombre: string, precios: PrecioMP[]): OrdenMP => ({
  codigo, fecha: '2026-11-01', proveedor: { rut, nombre, comuna: '', region: 'Región del Biobío' }, precios,
});

test('UNSPSC y giros del SII caen en la taxonomía de Bando', () => {
  assert.equal(categoriaDeUnspsc(50221101), 'abarrotes', 'arroz');
  assert.equal(categoriaDeUnspsc(50112004), 'carnes', 'pollo');
  assert.equal(categoriaDeUnspsc(50407170), 'frutas', 'tomate');
  assert.equal(categoriaDeUnspsc(47131807), 'limpieza', 'detergente');
  assert.equal(categoriaDeUnspsc(43211503), null, 'un computador no es insumo');
  assert.equal(categoriaDeUnspsc(null), null, 'Convenio Marco viene sin código');
  assert.equal(categoriaDeGiro({ codigo: '463011', descripcion: 'VENTA AL POR MAYOR DE FRUTAS Y VERDURAS' }), 'frutas');
  assert.equal(categoriaDeGiro({ codigo: '107100', descripcion: 'ELABORACION DE PRODUCTOS DE PANADERIA' }), 'panaderia');
  assert.equal(categoriaDeGiro({ codigo: '469000', descripcion: 'VENTA AL POR MAYOR DE PRODUCTOS DE LIMPIEZA' }), 'limpieza', 'sin código conocido, por la descripción');
  assert.equal(categoriaDeGiro({ codigo: '661100', descripcion: 'ADMINISTRACION DE MERCADOS FINANCIEROS' }), null);
});

test('la limpieza descarta el total de contrato, normaliza unidades y saca los vales de alimentación', () => {
  const arroz = [900, 1000, 1050, 1100, 1200].map((p, i) => precio({ orden: `a${i}`, precioUnitario: p, unidad: i ? 'unidad' : 'EA' }));
  const limpias = limpiarOrdenes([
    orden('1', '76.000.000-0', 'Distribuidora', [...arroz, precio({ orden: 'atipico', precioUnitario: 64_491_970 }), precio({ orden: 'raro', precioUnitario: 95_000 })]),
    orden('2', '77.000.000-9', 'Pollos', [precio({ producto: 'Pechuga de pollo', codigoProducto: 50112004, unidad: 'kilogramo', precioUnitario: 5290 })]),
    orden('3', '96.781.350-8', 'Vales SA', [precio({ producto: 'ALIMENTACIÓN(4323060) ALIMENTACIÓN', codigoProducto: null, precioUnitario: 300_000 })]),
    orden('4', '78.000.000-7', 'Convenio', [precio({ producto: 'SAL COCINA BOLSA 1 K UNIDAD X REGIÓN(4202049) SAL COCINA', codigoProducto: null, unidad: 'BX', precioUnitario: 565 })]),
  ]);
  const precios = limpias.flatMap(o => o.precios);
  assert.deepEqual(precios.filter(p => p.codigoProducto === 50221101).map(p => p.precioUnitario), [900, 1000, 1050, 1100, 1200], 'fuera el total y el atípico');
  assert.ok(precios.every(p => ['unidad', 'kg', 'litro', 'caja', 'paquete'].includes(p.unidad)));
  assert.equal(precios.find(p => p.codigoProducto === 50112004)?.unidad, 'kg');
  assert.ok(!limpias.some(o => o.proveedor.nombre === 'Vales SA'), 'los vales no nombran un producto: no son insumo');
  const sal = precios.find(p => p.orden === 'o' && p.producto.startsWith('SAL'));
  assert.deepEqual([sal?.producto, sal?.unidad, sal?.categoriaBando], ['SAL COCINA BOLSA 1 K', 'caja', 'abarrotes']);
});

test('la búsqueda une por RUT al proveedor de la red con el de Mercado Público y encuentra por producto sin tildes', () => {
  const estado = {
    negocios: [{ id: 'n-p-1', nombre: 'Molinos del Sur', comuna: 'Puente Alto', rol: 'proveedor', telefono: '', rut: '76000000-0' }],
    ordenes: [], documentos: [], licitaciones: [], notas: { 'n-p-1': 4.6 },
  } as unknown as EstadoRed;
  const ordenes = limpiarOrdenes([
    orden('1', '76.000.000-0', 'MOLINOS DEL SUR SPA', [precio({ producto: 'Azúcar granulada 1 kg', codigoProducto: 50161509 })]),
    orden('2', '77.000.000-9', 'OTRO PROVEEDOR', [precio({ producto: 'Pechuga de pollo', codigoProducto: 50112004, organismo: 'Hospital B' })]),
  ]);
  const fichas = armarFichas(estado, { ordenes, fuente: 'mercado_publico', hasta: '2026-11-01' }, () => undefined);
  assert.equal(fichas.length, 2, 'una sola ficha para el que está en los dos');
  const molinos = fichas.find(f => f.rut === '76.000.000-0')!;
  assert.deepEqual([molinos.nombre, molinos.nota, molinos.fuentes.map(f => f.tipo)], ['Molinos del Sur', 4.6, ['bando', 'mercado_publico']]);
  const r = buscar(indexar(fichas), { q: 'AZUCAR' });
  assert.deepEqual(r.resultados.map(x => x.nombre), ['Molinos del Sur']);
  assert.equal(buscar(indexar(fichas), { q: '76000000' }).total, 1, 'por RUT sin puntos');
  assert.deepEqual(buscar(indexar(fichas), { categoria: 'carnes' }).resultados.map(x => x.nombre), ['OTRO PROVEEDOR']);
  assert.ok(!JSON.stringify(fichas).includes('Hospital B'), 'los organismos solo van contados');
  const mapa = paraElMapa(fichas);
  assert.deepEqual(mapa.map(p => [p.nombre, p.enBando, p.ubicacion]), [['Molinos del Sur', true, 'comuna'], ['OTRO PROVEEDOR', false, 'region']], 'en el mapa: por comuna si se sabe, si no por región');
  assert.ok(!JSON.stringify(mapa).includes('Hospital B'));
});

test('el enriquecimiento usa la caché: un RUT ya consultado en el SII no se vuelve a consultar', async () => {
  const almacen = crearAlmacenEnriquecidosMemoria();
  await almacen.guardar({ rut: '76.000.000-0', sii: { inicioActividades: '2001-03-01', giros: [], consultado: '2026-11-20T00:00:00Z' } });
  const consultados: string[] = [];
  const clasificados: string[] = [];
  const e = await crearEnriquecedor({
    almacen, esperaMs: 0, alCambiar: () => {},
    consultarSii: async rut => {
      consultados.push(rut);
      return { inicioActividades: '2015-01-01', giros: [{ codigo: '463011', descripcion: 'VENTA AL POR MAYOR DE FRUTAS Y VERDURAS' }] };
    },
    clasificar: async x => (clasificados.push(x.rut), { categoria: 'otros', porque: 'sin datos', fuente: 'reglas' }),
  });
  e.pedirSii(['76.000.000-0', '77.000.000-9', '77.000.000-9']);
  await e.enCalma();
  e.pedirSii(['77.000.000-9']);
  e.pedirClasificacion([{ rut: '77.000.000-9', nombre: 'X', giros: [], productos: [] }]);
  await e.enCalma();
  e.pedirClasificacion([{ rut: '77.000.000-9', nombre: 'X', giros: [], productos: [] }]);
  await e.enCalma();
  assert.deepEqual(consultados, ['77.000.000-9']);
  assert.deepEqual(clasificados, ['77.000.000-9']);
  assert.equal((await almacen.todos()).find(x => x.rut === '77.000.000-9')?.sii?.giros[0]?.codigo, '463011', 'queda guardado');
});

test('el contacto encontrado en la web solo vale con fuente y con teléfono chileno o correo válidos', () => {
  const fuente = 'https://www.ejemplo.cl/contacto';
  assert.deepEqual([telefonoChileno('+56 9 8765 4321'), telefonoChileno('(2) 2345 6789'), telefonoChileno('600 123 4567'), telefonoChileno('12345')],
    ['56987654321', '56223456789', null, null]);
  assert.deepEqual(validarContacto({ telefono: '9 8765 4321', email: 'Ventas@Ejemplo.cl', web: 'nada', fuente }),
    { telefono: '56987654321', email: 'ventas@ejemplo.cl', web: null, fuente });
  assert.equal(validarContacto({ telefono: '9 8765 4321', email: '', web: '', fuente: '' }), null, 'sin fuente no se cree');
  assert.equal(validarContacto({ telefono: 'no encontrado', email: 'sin correo', web: 'https://ejemplo.cl', fuente }), null, 'solo un sitio no alcanza');
});

test('solo se publican los proveedores a los que se les puede escribir; se busca contacto una sola vez por RUT', async () => {
  const estado = {
    negocios: [{ id: 'n-p-1', nombre: 'Molinos del Sur', comuna: 'Puente Alto', rol: 'proveedor', telefono: '', rut: '76000000-0' }],
    ordenes: [], documentos: [], licitaciones: [], notas: {},
  } as unknown as EstadoRed;
  const ordenes = limpiarOrdenes([
    orden('2', '77.000.000-9', 'CON CONTACTO', [precio({})]),
    orden('3', '78.000.000-7', 'SIN CONTACTO', [precio({})]),
  ]);
  const almacen = crearAlmacenEnriquecidosMemoria();
  const buscados: string[] = [];
  const e = await crearEnriquecedor({
    almacen, esperaMs: 0, alCambiar: () => {}, consultarSii: async () => null, clasificar: async () => null,
    buscarContacto: async x => (buscados.push(x.rut),
      x.rut === '77.000.000-9' ? { telefono: '56987654321', email: null, web: null, fuente: 'https://ejemplo.cl' } : null),
  });
  const fichas = () => armarFichas(estado, { ordenes, fuente: 'mercado_publico', hasta: '2026-11-01' }, rut => e.de(rut));
  e.pedirContacto(sinContactoBuscado(fichas(), rut => e.de(rut)));
  await e.enCalma();
  e.pedirContacto(sinContactoBuscado(fichas(), rut => e.de(rut)));
  await e.enCalma();
  assert.deepEqual(buscados, ['77.000.000-9', '78.000.000-7'], 'el de la red no se busca y nadie se busca dos veces');
  assert.deepEqual(fichas().filter(contactable).map(f => f.nombre).sort(), ['CON CONTACTO', 'Molinos del Sur']);
});
