// Corre el explorador de locales en esta máquina y vuelca la muestra a data/locales-mut.json tras cada celda.
// Si se corta, al volver a correrlo sigue desde la última celda guardada. El servidor carga ese JSON al arrancar.
//
//   node scripts/explorar-locales.ts            # pausa de 15 s entre celdas
//   LOCALES_ESPERA_MS=8000 node scripts/explorar-locales.ts
import { ARCHIVO_LOCALES, buscarEnOsm, CELDAS, crearAlmacenLocalesArchivo, crearExplorador } from '../server/locales/index.ts';

const almacen = await crearAlmacenLocalesArchivo(ARCHIVO_LOCALES);
let total = (await almacen.todos()).length;
const explorador = crearExplorador({
  almacen,
  celdas: CELDAS,
  buscar: buscarEnOsm,
  esperaMs: Number(process.env.LOCALES_ESPERA_MS) || 15_000,
  alAvanzar: ({ nuevos, avance }) => {
    total += nuevos.length;
    console.log(`celda ${avance.celda}/${avance.total} · ${avance.fase} · ${avance.distanciaKm} km del MUT · +${nuevos.length} · ${total} locales`);
  },
  registrar: m => console.warn(m),
});
process.on('SIGINT', () => { explorador.detener(); process.exit(0); });
await explorador.iniciar();
