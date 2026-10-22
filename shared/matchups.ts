/**
 * Vantagem de cada confronto de rota.
 *
 * Usa os dados reais de shared/data/matchups.json (gerado por npm run riot:build) e,
 * quando o par não tem jogos suficientes, cai para os atributos dos campeões.
 */
import data from "./data/matchups.json";
import { getChampion } from "./champions";
import type { Lane } from "./types";

interface MatchupStat {
  games: number;
  winA: number;
  gold14A: number | null;
}

const LANES_DATA = data.lanes as Record<Lane, Record<string, MatchupStat>>;

export const MATCHUP_PATCHES: string[] = data.patches;

// A fase de rotas do jogo tem 4 turnos com ~80 de ouro por ponto de vantagem:
// dividir o ouro real aos 14 min por 320 coloca os dados na mesma escala dos atributos.
const GOLD_TO_EDGE = 1 / 320;
const WINRATE_TO_EDGE = 20;
// Com N jogos, os dados pesam N / (N + 15); o resto vem dos atributos.
// (A taxa de vitória já chega suavizada em direção a 50% pelo riot:build.)
const CONFIDENCE_GAMES = 15;
// Os dados reais mostram rotas menos desequilibradas do que os atributos sugerem
// (diferença típica de ~260 de ouro aos 14): reduz a escala dos atributos para combinar.
const ATTRIBUTE_SCALE = 0.6;

export interface MatchupData {
  games: number;
  winrate: number; // do primeiro campeão
  gold14: number | null; // ouro do primeiro campeão menos o do segundo, aos 14 min
}

/** Dados reais do confronto do ponto de vista de `champ`, ou null se não houver. */
export function getMatchup(lane: Lane, champ: string, opponent: string): MatchupData | null {
  const flipped = champ > opponent;
  const stat = LANES_DATA[lane]?.[flipped ? `${opponent}|${champ}` : `${champ}|${opponent}`];
  if (!stat) return null;
  return {
    games: stat.games,
    winrate: flipped ? 1 - stat.winA : stat.winA,
    gold14: stat.gold14A === null ? null : flipped ? -stat.gold14A : stat.gold14A,
  };
}

/** Força na rota só pelos atributos (fallback). */
export function attributeLaneScore(id: string): number {
  const a = getChampion(id).attrs;
  return a.early + a.burst * 0.35 + a.poke * 0.35 + a.cc * 0.2 + a.mobility * 0.1;
}

/**
 * Vantagem de `champ` sobre `opponent` na rota, em "pontos por turno" do motor.
 * Positivo = champ ganha a rota. Valores típicos ficam entre -2 e +2.
 */
export function laneEdge(lane: Lane, champ: string, opponent: string): number {
  const fromAttributes = (attributeLaneScore(champ) - attributeLaneScore(opponent)) * ATTRIBUTE_SCALE;
  const m = getMatchup(lane, champ, opponent);
  if (!m) return fromAttributes;
  // Ouro aos 14 mede a rota; a taxa de vitória complementa (e substitui quando falta o ouro).
  const fromWinrate = (m.winrate - 0.5) * WINRATE_TO_EDGE;
  const fromData = m.gold14 !== null ? (m.gold14 * GOLD_TO_EDGE + fromWinrate) / 2 : fromWinrate;
  const weight = m.games / (m.games + CONFIDENCE_GAMES);
  return weight * fromData + (1 - weight) * fromAttributes;
}
