import type { ChampionDef, DamageType, Lane } from "./types";

type Stats = [number, number, number, number, number, number, number, number, number, number, number];
type Row = [id: string, lanes: Lane[], dmg: DamageType, stats: Stats];

// Ordem dos atributos (1 a 5):
//   early, late, engage, cc, peel, burst, dps, poke, tank, mobility, split
// Os ids seguem o Data Dragon (npm run data avisa se algum não existir).
const ROWS: Row[] = [
  // ---------- Topo ----------
  ["Aatrox",      ["top"], "AD",  [4, 3, 3, 3, 1, 3, 4, 2, 3, 2, 3]],
  ["Darius",      ["top"], "AD",  [5, 2, 2, 2, 1, 4, 4, 1, 3, 1, 3]],
  ["Garen",       ["top"], "AD",  [3, 3, 1, 1, 1, 4, 3, 1, 3, 2, 4]],
  ["Malphite",    ["top"], "AP",  [2, 4, 5, 5, 2, 4, 1, 2, 5, 1, 1]],
  ["Ornn",        ["top"], "MIX", [2, 5, 4, 5, 3, 2, 2, 1, 5, 1, 1]],
  ["Sett",        ["top"], "AD",  [4, 3, 3, 3, 2, 4, 3, 1, 4, 2, 3]],
  ["Fiora",       ["top"], "AD",  [3, 5, 1, 2, 1, 3, 5, 1, 1, 3, 5]],
  ["Camille",     ["top"], "AD",  [3, 4, 4, 3, 1, 4, 4, 1, 2, 4, 5]],
  ["Jax",         ["top"], "MIX", [3, 5, 3, 3, 1, 3, 5, 1, 2, 3, 5]],
  ["Renekton",    ["top"], "AD",  [5, 2, 3, 3, 1, 4, 3, 1, 3, 3, 3]],
  ["Shen",        ["top"], "MIX", [3, 3, 4, 4, 5, 1, 2, 1, 4, 2, 4]],
  ["KSante",      ["top"], "AD",  [3, 4, 4, 4, 3, 3, 3, 1, 5, 2, 3]],
  ["Mordekaiser", ["top"], "AP",  [3, 4, 2, 2, 1, 3, 4, 1, 3, 1, 3]],
  ["Gnar",        ["top"], "AD",  [3, 3, 4, 4, 2, 3, 3, 3, 4, 3, 3]],

  // ---------- Selva ----------
  ["LeeSin",      ["jungle"], "AD",  [5, 2, 4, 3, 3, 4, 2, 1, 2, 5, 2]],
  ["Vi",          ["jungle"], "AD",  [4, 3, 5, 4, 1, 4, 3, 1, 3, 3, 1]],
  ["JarvanIV",    ["jungle"], "AD",  [4, 3, 5, 4, 2, 4, 2, 1, 3, 3, 1]],
  ["Sejuani",     ["jungle"], "AP",  [3, 4, 5, 5, 4, 2, 2, 1, 5, 1, 1]],
  ["Amumu",       ["jungle"], "AP",  [2, 4, 5, 5, 2, 3, 3, 1, 4, 2, 1]],
  ["Graves",      ["jungle"], "AD",  [4, 4, 1, 1, 1, 4, 4, 2, 2, 3, 3]],
  ["Kindred",     ["jungle"], "AD",  [3, 5, 1, 1, 4, 2, 5, 2, 1, 4, 2]],
  ["Viego",       ["jungle"], "AD",  [3, 4, 3, 1, 1, 4, 4, 1, 2, 3, 2]],
  ["Hecarim",     ["jungle"], "AD",  [3, 4, 5, 4, 1, 4, 3, 1, 3, 5, 2]],
  ["Elise",       ["jungle"], "AP",  [5, 1, 3, 3, 1, 4, 2, 2, 2, 3, 1]],
  ["Nocturne",    ["jungle"], "AD",  [3, 4, 4, 2, 1, 5, 3, 1, 2, 4, 3]],
  ["Khazix",      ["jungle"], "AD",  [4, 4, 2, 1, 1, 5, 2, 1, 1, 5, 2]],
  ["MasterYi",    ["jungle"], "AD",  [2, 5, 1, 1, 1, 3, 5, 1, 1, 4, 4]],
  ["XinZhao",     ["jungle"], "AD",  [5, 2, 4, 3, 2, 3, 4, 1, 3, 3, 2]],
  ["Zac",         ["jungle"], "AP",  [2, 4, 5, 5, 3, 2, 2, 1, 5, 4, 1]],

  // ---------- Meio ----------
  ["Ahri",        ["mid"], "AP", [3, 3, 3, 3, 2, 5, 2, 3, 1, 5, 2]],
  ["Syndra",      ["mid"], "AP", [3, 4, 2, 4, 3, 5, 2, 4, 1, 1, 1]],
  ["Orianna",     ["mid"], "AP", [2, 5, 4, 4, 4, 4, 3, 4, 1, 1, 1]],
  ["Zed",         ["mid"], "AD", [4, 3, 1, 1, 1, 5, 2, 2, 1, 5, 4]],
  ["Yasuo",       ["mid"], "AD", [3, 4, 3, 4, 2, 3, 4, 1, 1, 4, 4]],
  ["Viktor",      ["mid"], "AP", [2, 5, 1, 3, 2, 4, 4, 4, 1, 1, 1]],
  ["Akali",       ["mid"], "AP", [3, 4, 1, 1, 1, 5, 3, 1, 1, 5, 3]],
  ["Leblanc",     ["mid"], "AP", [5, 2, 1, 3, 1, 5, 1, 2, 1, 5, 3]],
  ["Katarina",    ["mid"], "AP", [3, 4, 1, 1, 1, 5, 4, 1, 1, 5, 2]],
  ["Vex",         ["mid"], "AP", [3, 3, 4, 4, 3, 5, 2, 3, 1, 2, 1]],
  ["Annie",       ["mid"], "AP", [4, 3, 4, 5, 2, 5, 2, 2, 1, 1, 1]],
  ["TwistedFate", ["mid"], "AP", [2, 4, 2, 4, 1, 3, 2, 3, 1, 2, 4]],
  ["Galio",       ["mid"], "AP", [3, 3, 5, 5, 4, 3, 2, 2, 4, 2, 1]],
  ["Hwei",        ["mid"], "AP", [2, 4, 2, 4, 3, 4, 3, 5, 1, 1, 1]],
  ["Sylas",       ["mid"], "AP", [3, 4, 3, 3, 2, 4, 3, 1, 2, 3, 2]],
  ["Xerath",      ["mid", "support"], "AP", [2, 4, 1, 3, 1, 4, 2, 5, 1, 1, 1]],

  // ---------- Atirador ----------
  ["Jinx",        ["adc"], "AD",  [2, 5, 1, 2, 1, 3, 5, 2, 1, 2, 2]],
  ["Caitlyn",     ["adc"], "AD",  [5, 3, 1, 2, 2, 3, 4, 4, 1, 2, 2]],
  ["Ezreal",      ["adc"], "AD",  [3, 4, 1, 1, 1, 3, 3, 5, 1, 4, 1]],
  ["Kaisa",       ["adc"], "MIX", [2, 5, 2, 1, 1, 4, 4, 1, 1, 4, 1]],
  ["Jhin",        ["adc"], "AD",  [3, 4, 1, 3, 1, 4, 3, 4, 1, 1, 1]],
  ["Ashe",        ["adc"], "AD",  [3, 3, 4, 5, 4, 2, 3, 3, 1, 1, 1]],
  ["Vayne",       ["adc"], "AD",  [2, 5, 1, 2, 2, 3, 5, 1, 1, 3, 3]],
  ["MissFortune", ["adc"], "AD",  [4, 3, 1, 1, 1, 4, 4, 3, 1, 1, 1]],
  ["Varus",       ["adc"], "AD",  [3, 4, 2, 4, 2, 4, 3, 5, 1, 1, 1]],
  ["Lucian",      ["adc"], "AD",  [5, 2, 1, 1, 1, 4, 4, 2, 1, 4, 1]],
  ["Draven",      ["adc"], "AD",  [5, 3, 1, 2, 1, 4, 5, 1, 1, 2, 1]],
  ["Xayah",       ["adc"], "AD",  [3, 4, 1, 3, 3, 3, 4, 2, 1, 2, 1]],
  ["Sivir",       ["adc"], "AD",  [2, 4, 2, 1, 3, 2, 4, 2, 1, 2, 1]],
  ["Twitch",      ["adc"], "AD",  [2, 5, 1, 1, 1, 3, 5, 1, 1, 2, 1]],

  // ---------- Suporte ----------
  ["Thresh",      ["support"], "MIX", [4, 3, 4, 5, 5, 1, 1, 1, 4, 2, 1]],
  ["Leona",       ["support"], "MIX", [5, 2, 5, 5, 3, 2, 1, 1, 5, 2, 1]],
  ["Nautilus",    ["support"], "MIX", [4, 3, 5, 5, 3, 2, 1, 1, 5, 1, 1]],
  ["Lulu",        ["support"], "AP",  [3, 4, 1, 3, 5, 1, 1, 2, 1, 2, 1]],
  ["Janna",       ["support"], "AP",  [2, 4, 1, 4, 5, 1, 1, 2, 1, 3, 1]],
  ["Rakan",       ["support"], "AP",  [3, 3, 5, 4, 4, 2, 1, 1, 2, 5, 1]],
  ["Nami",        ["support"], "AP",  [4, 3, 2, 4, 4, 2, 1, 3, 1, 1, 1]],
  ["Blitzcrank",  ["support"], "AP",  [4, 2, 5, 5, 2, 3, 1, 1, 3, 2, 1]],
  ["Braum",       ["support"], "MIX", [4, 3, 3, 4, 5, 1, 1, 1, 5, 2, 1]],
  ["Karma",       ["support"], "AP",  [4, 3, 2, 3, 4, 3, 1, 4, 1, 3, 1]],
  ["Milio",       ["support"], "AP",  [2, 4, 1, 2, 5, 1, 1, 2, 1, 2, 1]],
  ["Pyke",        ["support"], "AD",  [4, 2, 4, 4, 1, 5, 1, 1, 1, 4, 1]],
  ["Zyra",        ["support"], "AP",  [4, 3, 2, 3, 2, 4, 3, 4, 1, 1, 1]],
  ["Morgana",     ["support"], "AP",  [3, 3, 3, 4, 4, 3, 1, 3, 1, 1, 1]],
  ["Senna",       ["support"], "AD",  [3, 5, 1, 2, 3, 3, 3, 4, 1, 2, 1]],
];

export const CHAMPIONS: ChampionDef[] = ROWS.map(([id, lanes, dmg, s]) => ({
  id,
  lanes,
  dmg,
  attrs: {
    early: s[0], late: s[1], engage: s[2], cc: s[3], peel: s[4], burst: s[5],
    dps: s[6], poke: s[7], tank: s[8], mobility: s[9], split: s[10],
  },
}));

const BY_ID = new Map(CHAMPIONS.map((c) => [c.id, c]));

export function getChampion(id: string): ChampionDef {
  const champ = BY_ID.get(id);
  if (!champ) throw new Error(`Campeão desconhecido: ${id}`);
  return champ;
}

export function championsForLane(lane: Lane): ChampionDef[] {
  return CHAMPIONS.filter((c) => c.lanes.includes(lane));
}
