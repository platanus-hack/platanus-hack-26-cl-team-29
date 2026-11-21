// Página mínima para subir el certificado desde el link privado de WhatsApp. Se sirve desde Express (sin el front
// de React) para que el link funcione solo: el archivo y la clave van directo a nuestro servidor, nunca por el chat.

const escapar = (t: string) => t.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

const estilos = `
  :root { color-scheme: light dark; --fondo: #f6f6f3; --texto: #1a1a1a; --suave: #5f5f5a; --borde: #d9d9d2; --acento: #1d6b45; --error: #b3261e; }
  @media (prefers-color-scheme: dark) { :root { --fondo: #161616; --texto: #f2f2ee; --suave: #a3a39c; --borde: #34342f; --acento: #6fd39b; --error: #ff8a80; } }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--fondo); color: var(--texto); font: 16px/1.5 system-ui, sans-serif; }
  main { max-width: 440px; margin: 0 auto; padding: 32px 16px; }
  h1 { font-size: 1.4rem; margin: 0 0 8px; }
  p { color: var(--suave); margin: 0 0 16px; }
  label { display: block; font-weight: 600; margin: 16px 0 6px; }
  input { width: 100%; padding: 12px; border: 1px solid var(--borde); border-radius: 10px; background: transparent; color: inherit; font: inherit; }
  button { width: 100%; margin-top: 20px; padding: 14px; border: 0; border-radius: 10px; background: var(--acento); color: #fff; font: inherit; font-weight: 600; }
  button:disabled { opacity: .6; }
  #resultado { margin-top: 16px; font-weight: 600; }
  .error { color: var(--error); } .ok { color: var(--acento); }
  small { display: block; color: var(--suave); margin-top: 24px; }
`;

export function paginaSubida(token: string): string {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Conectar certificado · Bando</title><style>${estilos}</style></head><body><main>
<h1>Conecta tu certificado digital</h1>
<p>Así tus facturas salen a tu nombre en el SII (ambiente de certificación). El archivo y la clave van directo a Bando, cifrados; nunca pasan por WhatsApp.</p>
<form id="f">
  <label for="pfx">Certificado (.pfx o .p12)</label><input id="pfx" type="file" accept=".pfx,.p12" required>
  <label for="clave">Clave del certificado</label><input id="clave" type="password" autocomplete="off" required>
  <button id="b" type="submit">Conectar</button>
</form>
<div id="resultado" role="status"></div>
<small>Este link es de un solo uso y vence en 15 minutos. Si vence, pide otro en WhatsApp escribiendo "conectar certificado".</small>
</main><script>
const f = document.getElementById('f'), b = document.getElementById('b'), r = document.getElementById('resultado');
let enviando = false;
f.addEventListener('submit', async e => {
  e.preventDefault();
  if (enviando) return;
  enviando = true; b.disabled = true; b.textContent = 'Conectando...'; r.className = ''; r.textContent = 'Revisando tu certificado...';
  try {
    const archivo = document.getElementById('pfx').files[0];
    const bytes = new Uint8Array(await archivo.arrayBuffer());
    let bin = ''; for (const x of bytes) bin += String.fromCharCode(x);
    const resp = await fetch('/api/certificado/${escapar(token)}', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pfxBase64: btoa(bin), clave: document.getElementById('clave').value }) });
    const j = await resp.json();
    if (resp.status === 410) { f.remove(); throw new Error(j.mensaje); }
    if (!resp.ok) throw new Error(j.mensaje || 'No se pudo conectar el certificado.');
    r.className = 'ok'; r.textContent = 'Listo, certificado conectado. Vuelve a WhatsApp: ahí sigue tu registro.'; f.remove();
  } catch (err) { r.className = 'error'; r.textContent = err.message; b.disabled = false; b.textContent = 'Conectar'; }
  enviando = false;
});
</script></body></html>`;
}

export function paginaInvalida(): string {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Link vencido · Bando</title><style>${estilos}</style></head><body><main>
<h1>Este link ya no sirve</h1>
<p>Los links para conectar el certificado son de un solo uso y vencen en 15 minutos. Pide otro en WhatsApp escribiendo "conectar certificado".</p>
</main></body></html>`;
}
