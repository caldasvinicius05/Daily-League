/**
 * Mapa simplificado de Summoner's Rift.
 *
 * Coordenadas de 0 a 100 (x para a direita, y para baixo), como no minimapa:
 * o time do jogador ("ally") é o lado azul, com base no canto inferior esquerdo;
 * o inimigo é o lado vermelho, no canto superior direito.
 */
import type { Lane, Side } from "./types";

export type Route = "top" | "mid" | "bot";

export type Zone =
  | Route
  | "jungle-ally-top" | "jungle-ally-bot"
  | "jungle-enemy-top" | "jungle-enemy-bot"
  | "river-top" | "river-bot"
  | "baron" | "dragon"
  | "base-ally" | "base-enemy";

export interface Point {
  x: number;
  y: number;
}

export const ZONE_LABEL: Record<Zone, string> = {
  top: "rota do topo",
  mid: "rota do meio",
  bot: "rota do bot",
  "jungle-ally-top": "selva aliada (lado de cima)",
  "jungle-ally-bot": "selva aliada (lado de baixo)",
  "jungle-enemy-top": "selva inimiga (lado de cima)",
  "jungle-enemy-bot": "selva inimiga (lado de baixo)",
  "river-top": "rio de cima",
  "river-bot": "rio de baixo",
  baron: "covil do Barão",
  dragon: "covil do Dragão",
  "base-ally": "base aliada",
  "base-enemy": "base inimiga",
};

/** Centro de cada região no minimapa. */
export const ZONE_POSITION: Record<Zone, Point> = {
  top: { x: 10, y: 10 },
  mid: { x: 50, y: 50 },
  bot: { x: 90, y: 90 },
  "jungle-ally-top": { x: 25, y: 50 },
  "jungle-ally-bot": { x: 50, y: 75 },
  "jungle-enemy-top": { x: 50, y: 25 },
  "jungle-enemy-bot": { x: 75, y: 50 },
  "river-top": { x: 36, y: 36 },
  "river-bot": { x: 64, y: 64 },
  baron: { x: 30, y: 31 },
  dragon: { x: 70, y: 69 },
  "base-ally": { x: 9, y: 91 },
  "base-enemy": { x: 91, y: 9 },
};

/** Rota de cada posição (o caçador não tem rota). */
export const LANE_ROUTE: Record<Lane, Route | null> = {
  top: "top",
  jungle: null,
  mid: "mid",
  adc: "bot",
  support: "bot",
};

export function baseZone(side: Side): Zone {
  return side === "ally" ? "base-ally" : "base-enemy";
}

export function jungleZone(side: Side, half: "top" | "bot"): Zone {
  return `jungle-${side}-${half}`;
}

export type TowerTier = "outer" | "inner" | "inhib" | "nexus";

export interface TowerDef {
  id: string;
  route: Route | "base";
  tier: TowerTier;
  pos: Point; // posição da torre do time aliado; a do inimigo é espelhada
}

/**
 * As 11 torres de cada time. Dentro de cada rota, a ordem do array é a ordem
 * em que elas caem (externa → interna → inibidor); as do Nexus caem por último.
 */
export const TOWERS: TowerDef[] = [
  { id: "top-outer", route: "top", tier: "outer", pos: { x: 7, y: 28 } },
  { id: "top-inner", route: "top", tier: "inner", pos: { x: 8, y: 53 } },
  { id: "top-inhib", route: "top", tier: "inhib", pos: { x: 8, y: 72 } },
  { id: "mid-outer", route: "mid", tier: "outer", pos: { x: 40, y: 60 } },
  { id: "mid-inner", route: "mid", tier: "inner", pos: { x: 33, y: 67 } },
  { id: "mid-inhib", route: "mid", tier: "inhib", pos: { x: 25, y: 75 } },
  { id: "bot-outer", route: "bot", tier: "outer", pos: { x: 72, y: 93 } },
  { id: "bot-inner", route: "bot", tier: "inner", pos: { x: 47, y: 92 } },
  { id: "bot-inhib", route: "bot", tier: "inhib", pos: { x: 28, y: 92 } },
  { id: "nexus-top", route: "base", tier: "nexus", pos: { x: 12, y: 85 } },
  { id: "nexus-bot", route: "base", tier: "nexus", pos: { x: 15, y: 88 } },
];

export function towerPosition(tower: TowerDef, owner: Side): Point {
  return owner === "ally" ? tower.pos : { x: 100 - tower.pos.x, y: 100 - tower.pos.y };
}
