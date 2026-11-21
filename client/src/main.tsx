import type React from 'react';
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { io } from 'socket.io-client';

const socket = io();

// Prueba de tiempo real: los mensajes de una pestaña aparecen en las demás
function App() {
  const [msgs, setMsgs] = useState<string[]>([]);
  const [texto, setTexto] = useState('');
  useEffect(() => {
    const on = (d: string) => setMsgs(m => [...m, d]);
    socket.on('evento', on);
    return () => { socket.off("evento", on); };
  }, []);
  const enviar = (e: React.FormEvent) => {
    e.preventDefault();
    if (!texto) return;
    socket.emit('evento', texto);
    setMsgs(m => [...m, `yo: ${texto}`]);
    setTexto('');
  };
  return (
    <main style={{ fontFamily: 'system-ui', padding: 16, maxWidth: 600, margin: 'auto' }}>
      <h1>team-29 · tiempo real</h1>
      <p>¡Hola, Jorge! Un saludo desde Luciano.</p>
      <form onSubmit={enviar}>
        <input value={texto} onChange={e => setTexto(e.target.value)} placeholder="Escribe algo…" />
        <button>Enviar</button>
      </form>
      <ul>{msgs.map((m, i) => <li key={i}>{m}</li>)}</ul>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
