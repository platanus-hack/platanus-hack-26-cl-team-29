---
name: revision-ui
description: Revisión de UI y UX de las vistas de la app antes de mergear. Úsala al crear o cambiar cualquier pantalla en client/ (sala, red, licitación, app del comprador, panel del proveedor, unirse) o cuando alguien pida pulir, ordenar o revisar la interfaz. Detecta elementos encimados, cortados, desalineados o con scroll horizontal en varios tamaños, y revisa fricción, clics y textos.
---

# Revisión de UI y UX

Objetivo: pantallas ambiciosas pero no sobrecargadas, bien distribuidas, sin fricción y con textos que se entienden al primer vistazo. Una vista no está terminada hasta que pasa esta revisión en todos los tamaños.

La marca (logo, color, tipografía, íconos, ilustraciones y voz) está en `DESIGN.md`: una vista rediseñada se revisa también contra esas reglas.

## Principios

1. **Una idea principal por pantalla.** Lo más importante es lo más grande. Si todo compite, nada se lee. Ante la duda, quita un elemento en vez de agregar uno.
2. **Nada encimado, nada cortado, nada desalineado.** Ningún texto tapa a otro, ninguna tarjeta se sale de su contenedor, ninguna fila queda a medias. Los elementos repetidos comparten carriles: íconos, montos y acciones en columnas de ancho fijo.
3. **Distribución intencional.** Espacio generoso alrededor de lo principal y apretado dentro de los grupos. Sin huecos grandes vacíos por accidente ni bloques pegados al borde.
4. **Mínima fricción.** La acción principal está a la vista sin hacer scroll y se hace en un toque. No se pide nada que el sistema ya sabe. Cada clic extra hay que justificarlo. Los formularios piden lo mínimo y recuerdan lo ya ingresado.
5. **Confirmación solo donde hay efecto legal o irreversible** (emitir, reclamar, nota de crédito): un paso de confirmación dentro de la página que dice qué va a pasar, nunca `alert` ni `confirm` del navegador.
6. **Lenguaje natural y conciso.** Frases cortas, como hablaría una persona: "Faltan 7 cajas para bajar a $29.900", no "Umbral del siguiente tramo: 7 unidades". Español neutro, sin emojis, sin guiones largos, **todo monto con separador de miles** en formato chileno ($6.900, $17.200, $1.234.567, nunca $6900) y decimales con coma (4,7). Los folios van sin separador. Singular y plural correctos.
7. **Contexto mínimo suficiente.** Cada número con su etiqueta corta. Sin párrafos explicativos en pantallas que se proyectan.
8. **Vivo.** Respeta la regla de tiempo real de `CLAUDE.md`: los cambios llegan solos y se notan con una animación breve, sin tapar lo demás. Respeta `prefers-reduced-motion`.
9. **Iconografía que se reconoce al instante.** Ver la sección de abajo.
10. **Aviso de modo demo.** Donde alguien se suma o actúa sin cuenta (`/unirse`, entrada de `/app`, junto a "Conectar mi SII"), una línea discreta en gris pequeño: en la demo cualquiera puede sumarse; en uso real cada negocio entra con su cuenta y su certificado digital. Nunca tapa acciones ni compite con lo principal.
11. **Estados completos.** Cada vista tiene estado vacío con guía ("Todavía no hay pedidos: súmate a la compra conjunta"), cargando, error en palabras simples y datos de prueba marcados.

## Iconografía

- **SII:** todo lo que pasa en el SII (factura emitida, reclamo, nota de crédito, "Conectar mi SII", folios) lleva el logo del SII (`/logos/sii.svg`) y su azul (#0061A0). El usuario tiene que ver de un vistazo qué quedó registrado oficialmente. Se usa para indicar la conexión, nunca como si fuera una pantalla oficial del SII.
- **Proveedores:** cada proveedor tiene su logo. Si el negocio no subió uno, se muestra un monograma (iniciales sobre un color estable derivado del nombre). El proveedor real de la demo puede traer su logo por configuración (`DEMO_PROVEEDOR_LOGO_URL`); nunca se commitea la marca de una empresa real.
- **Comercios compradores:** avatar con monograma de color estable y, si se conoce, un ícono del rubro (almacén, panadería, restaurante, farmacia, etc.).
- **Productos:** un ícono simple por producto de la canasta.
- **Un solo set de íconos de línea**, mismo grosor y tamaño en toda la app, en SVG dentro del código. Sin emojis como íconos.
- Los logos y avatares van en contenedores de tamaño fijo para que las filas queden alineadas.

## Tamaños obligatorios

| Uso | Tamaños |
|---|---|
| Pantallas que se proyectan (`/red`, `/licitacion`) | 1920x1080, 1440x810, 1024x768. Caben en una sola pantalla, sin scroll. |
| Vistas de uso personal (`/app`, `/proveedor`, `/unirse`) | 375x812, 390x844, 768x1024, 1440x900. Sin scroll horizontal; en celular la acción principal visible sin scroll o fija abajo. |

## Proceso

1. Levanta el stack (`npm start` y `npm run dev`) con datos realistas: usa la red falsa del cliente o simula una sala sumándose por la API.
2. Abre cada vista en cada tamaño (Chrome con la extensión o Playwright) y corre el detector de abajo en la consola de la página. Repite en cada fase de la vista (vacía, con datos, con muchos datos, después de un evento).
3. Mira la captura de pantalla con los principios en la mano: jerarquía, distribución, alineación, textos.
4. Corrige, vuelve a medir y deja en el PR una tabla corta: vista, tamaño, problemas encontrados, estado.

## Detector automático

Pégalo en la consola (o en `browser_evaluate` de Playwright). Lista scroll horizontal, elementos que se salen de la pantalla o de su contenedor con overflow oculto, texto cortado y textos que se tapan entre sí.

```js
(() => {
  const problemas = [];
  const vw = document.documentElement.clientWidth, vh = window.innerHeight;
  if (document.documentElement.scrollWidth > vw + 1) problemas.push(`scroll horizontal: ${document.documentElement.scrollWidth}px de ancho en ${vw}px`);
  const visibles = [...document.querySelectorAll('body *')].filter(el => {
    const r = el.getBoundingClientRect(), s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.opacity !== '0' && s.display !== 'none';
  });
  const nombre = el => `${el.tagName.toLowerCase()}${el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/)[0] : ''} "${(el.textContent || '').trim().slice(0, 30)}"`;
  for (const el of visibles) {
    const r = el.getBoundingClientRect();
    if (r.right > vw + 1 || r.left < -1) problemas.push(`fuera de la pantalla: ${nombre(el)}`);
    if (el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflowX === 'hidden' && el.children.length === 0) problemas.push(`texto cortado: ${nombre(el)}`);
  }
  const textos = visibles.filter(el => [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()) && getComputedStyle(el).position !== 'fixed');
  for (let i = 0; i < textos.length; i++) for (let j = i + 1; j < textos.length; j++) {
    const a = textos[i], b = textos[j];
    if (a.contains(b) || b.contains(a)) continue;
    const x = a.getBoundingClientRect(), y = b.getBoundingClientRect();
    const solape = Math.max(0, Math.min(x.right, y.right) - Math.max(x.left, y.left)) * Math.max(0, Math.min(x.bottom, y.bottom) - Math.max(x.top, y.top));
    if (solape > 0.15 * Math.min(x.width * x.height, y.width * y.height)) problemas.push(`textos encimados: ${nombre(a)} con ${nombre(b)}`);
  }
  const alto = document.documentElement.scrollHeight;
  return { vista: location.pathname, tamano: `${vw}x${vh}`, scrollVertical: alto > vh + 1 ? `${alto - vh}px` : 'no', problemas: [...new Set(problemas)].slice(0, 40) };
})()
```

En pantallas que se proyectan, `scrollVertical` tiene que decir `no`. Los elementos animados en el momento de medir pueden dar falsos positivos: vuelve a medir tras dos segundos.

## Lista final antes de mergear

- [ ] El detector no reporta problemas en ningún tamaño obligatorio.
- [ ] Lo más importante de cada pantalla se entiende en tres segundos.
- [ ] La acción principal está a la vista y se hace en el menor número de toques.
- [ ] Textos cortos, naturales, en español neutro, con plurales correctos y todo monto con separador de miles.
- [ ] Estados vacío, cargando y error revisados.
- [ ] Los cambios en vivo se notan sin tapar contenido.
- [ ] Logo del SII en cada acción del SII; logos o monogramas en proveedores y comercios; íconos de un solo set.
- [ ] Aviso discreto de modo demo donde corresponde.
