/**
 * Conjunto acotado de ids vistos hace poco. Kapso reintenta a los 10 s, 40 s
 * y 90 s, así que una ventana de minutos basta; el tope evita crecer sin fin.
 * En memoria a propósito: un solo proceso en Render, y un reinicio a lo más
 * reprocesa un reintento en vuelo.
 */
export class RecentIds {
  readonly #seen = new Map<string, number>();
  readonly #ttlMs: number;
  readonly #max: number;

  constructor(ttlMs = 10 * 60_000, max = 10_000) {
    this.#ttlMs = ttlMs;
    this.#max = max;
  }

  /** `true` si el id es nuevo (y queda registrado); `false` si ya se vio. */
  add(id: string, now = Date.now()): boolean {
    const seenAt = this.#seen.get(id);
    if (seenAt !== undefined && now - seenAt < this.#ttlMs) return false;
    this.#seen.delete(id);
    this.#seen.set(id, now);
    // Map conserva orden de inserción: el primero es el más antiguo.
    while (this.#seen.size > this.#max) this.#seen.delete(this.#seen.keys().next().value!);
    return true;
  }
}
