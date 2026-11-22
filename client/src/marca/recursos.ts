// Rutas de los archivos del kit de marca (client/public/marca/). Una sola lista: las vistas importan de aquí y nunca
// escriben la ruta a mano. Cuándo usar cada uno está en DESIGN.md.

const BASE = '/marca';

export const LOGO = {
  /** Horizontal sobre blanco o crema. Mínimo 120 px de ancho; más chico, el ícono. */
  claro: `${BASE}/01-logo/bando-logo.png`,
  /** Horizontal sobre carbón o fondos oscuros. */
  oscuro: `${BASE}/01-logo/bando-logo-sobre-oscuro.png`,
  /** El hexágono miel, para espacios de menos de 120 px. Este pesa poco; el de 1024 px es para imprimir. */
  icono: `${BASE}/01-logo/favicon-192.png`,
} as const;

/** Un ícono por flujo de Bando (no reemplazan a los íconos de interfaz). Mínimo 32 px. */
export const ICONO_FLUJO = {
  entrar: `${BASE}/02-iconos-flujos/flujo-1.png`,
  comprarEnGrupo: `${BASE}/02-iconos-flujos/flujo-2.png`,
  recibirYPagar: `${BASE}/02-iconos-flujos/flujo-3.png`,
  pedidoPorWhatsapp: `${BASE}/02-iconos-flujos/flujo-4.png`,
  comoVende: `${BASE}/02-iconos-flujos/flujo-5.png`,
  masParadas: `${BASE}/02-iconos-flujos/flujo-6.png`,
  sumarProveedores: `${BASE}/02-iconos-flujos/flujo-7.png`,
} as const;

/** Escenas para estados vacíos, confirmaciones y láminas. Una por pantalla; nunca dentro de tablas o formularios. */
export const ILUSTRACION = {
  problema: `${BASE}/03-ilustraciones/problema.png`,
  equipo: `${BASE}/03-ilustraciones/equipo.png`,
  camion: `${BASE}/03-ilustraciones/camion.png`,
  entrega: `${BASE}/03-ilustraciones/entrega.png`,
  proveedorCelular: `${BASE}/03-ilustraciones/proveedor-celular.png`,
  qrMonedas: `${BASE}/03-ilustraciones/qr-monedas.png`,
  capital: `${BASE}/03-ilustraciones/capital.png`,
  mapaRed: `${BASE}/03-ilustraciones/mapa-red.png`,
  panal: `${BASE}/03-ilustraciones/panal.png`,
  cajas: `${BASE}/03-ilustraciones/cajas.png`,
} as const;

/** El panal que se llena, de vacío a lleno: la animación del ahorro (0,8 s por cuadro). */
export const PANAL_SE_LLENA = [0, 1, 2, 3].map(n => `${BASE}/03-ilustraciones/panal-${n}.png`);

export const ABEJA = {
  /** Cargando, "buscando proveedores...". */
  volando: `${BASE}/04-abejas/abeja-volando.png`,
  /** Confirmaciones: "te sumaste", "tramo alcanzado". */
  celebra: `${BASE}/04-abejas/abeja-celebra.png`,
  /** Llamar la atención: "faltan 13 cajas". */
  senala: `${BASE}/04-abejas/abeja-senala.png`,
} as const;

/** Logo del SII (tercero): en cada acción o estado que queda registrado en el SII, nunca como si fuera una pantalla del SII. */
export const LOGO_SII = '/logos/sii.svg';
