/**
 * Cliente mínimo da API da Riot com controle de rate limit.
 *
 * Variáveis no .env:
 *   RIOT_API_KEY   chave do Developer Portal (RGAPI-...); RIOT_API também é aceito
 *   RIOT_PLATFORM  servidor das contas/ranked (padrão: br1)
 *   RIOT_REGION    roteamento regional das partidas (padrão: americas)
 */
import "dotenv/config";
import type { Lane } from "../../shared/types";

export const RAW_DIR = new URL("../../data/riot/", import.meta.url);
export const MATCHES_FILE = new URL("matches.jsonl", RAW_DIR);
export const STATE_FILE = new URL("state.json", RAW_DIR);

/** Uma partida reduzida ao que interessa para matchups (uma linha do matches.jsonl). */
export interface MatchRecord {
  id: string;
  patch: string; // ex.: "16.21"
  blueWin: boolean;
  lanes: Partial<Record<Lane, { blue: string; red: string; gold14?: number }>>; // gold14 = azul - vermelho
}

export const POSITION_TO_LANE: Record<string, Lane> = {
  TOP: "top",
  JUNGLE: "jungle",
  MIDDLE: "mid",
  BOTTOM: "adc",
  UTILITY: "support",
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Respeita vários limites ao mesmo tempo, ex.: 20 req/1s e 100 req/2min. */
class RateLimiter {
  private stamps: number[] = [];

  constructor(private readonly limits: [count: number, windowMs: number][]) {}

  async wait() {
    const longest = Math.max(...this.limits.map(([, w]) => w));
    for (;;) {
      const now = Date.now();
      this.stamps = this.stamps.filter((t) => now - t < longest);
      let waitMs = 0;
      for (const [count, windowMs] of this.limits) {
        const inWindow = this.stamps.filter((t) => now - t < windowMs);
        if (inWindow.length >= count) waitMs = Math.max(waitMs, windowMs - (now - inWindow[0]) + 50);
      }
      if (waitMs === 0) {
        this.stamps.push(now);
        return;
      }
      await sleep(waitMs);
    }
  }
}

// Limites da chave de desenvolvimento/pessoal, com uma pequena folga.
const limiter = new RateLimiter([[19, 1_000], [95, 120_000]]);

export class RiotKeyError extends Error {}

export class RiotClient {
  readonly platform = process.env.RIOT_PLATFORM ?? "br1";
  readonly region = process.env.RIOT_REGION ?? "americas";
  private readonly key = process.env.RIOT_API_KEY ?? process.env.RIOT_API;
  requests = 0;

  constructor() {
    if (!this.key) throw new RiotKeyError("Falta RIOT_API_KEY no .env");
  }

  platformGet<T>(path: string) {
    return this.get<T>(`https://${this.platform}.api.riotgames.com${path}`);
  }

  regionGet<T>(path: string) {
    return this.get<T>(`https://${this.region}.api.riotgames.com${path}`);
  }

  /** GET com retry em 429/5xx. Retorna null em 404. */
  private async get<T>(url: string, attempt = 0): Promise<T | null> {
    await limiter.wait();
    this.requests++;
    const res = await fetch(url, { headers: { "X-Riot-Token": this.key! } });

    if (res.ok) return (await res.json()) as T;
    if (res.status === 404) return null;
    if (res.status === 401 || res.status === 403) {
      throw new RiotKeyError("Chave da Riot inválida ou expirada (chaves de desenvolvimento duram 24h). Gere outra no Developer Portal.");
    }
    if ((res.status === 429 || res.status >= 500) && attempt < 5) {
      const retryAfter = Number(res.headers.get("Retry-After") ?? 0);
      const waitMs = retryAfter ? retryAfter * 1000 : 2000 * 2 ** attempt;
      console.warn(`  ${res.status} — aguardando ${Math.round(waitMs / 1000)}s...`);
      await sleep(waitMs);
      return this.get<T>(url, attempt + 1);
    }
    throw new Error(`${res.status} em ${url}`);
  }
}
