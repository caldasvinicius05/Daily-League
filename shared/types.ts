export type Lane = "top" | "jungle" | "mid" | "adc" | "support";

/** "ally" = time do jogador (lado azul); "enemy" = time inimigo (lado vermelho). */
export type Side = "ally" | "enemy";

export const LANES: Lane[] = ["top", "jungle", "mid", "adc", "support"];

export const LANE_LABEL: Record<Lane, string> = {
  top: "Topo",
  jungle: "Selva",
  mid: "Meio",
  adc: "Atirador",
  support: "Suporte",
};

export type DamageType = "AD" | "AP" | "MIX";

/** Atributos de 1 a 5 usados pelo motor de simulação. */
export interface Attributes {
  early: number; // força no início de jogo
  late: number; // escala para o fim de jogo
  engage: number; // capacidade de iniciar lutas
  cc: number; // controle de grupo
  peel: number; // proteção aos aliados
  burst: number; // dano explosivo
  dps: number; // dano sustentado
  poke: number; // dano à distância antes da luta
  tank: number; // resistência / linha de frente
  mobility: number; // mobilidade
  split: number; // pressão em rota lateral
}

export const ATTRIBUTE_KEYS: (keyof Attributes)[] = [
  "early", "late", "engage", "cc", "peel", "burst", "dps", "poke", "tank", "mobility", "split",
];

export interface ChampionDef {
  id: string; // id do Data Dragon (ex.: "MonkeyKing")
  lanes: Lane[];
  dmg: DamageType;
  attrs: Attributes;
}

export type Team = Record<Lane, string>;

export interface DailyChallenge {
  date: string; // AAAA-MM-DD
  enemy: Team;
  options: Record<Lane, [string, string]>;
}
