/**
 * Agrega data/riot/matches.jsonl em shared/data/matchups.json, usado pelo motor do jogo.
 *
 *   npm run riot:build                 -> últimos 2 patches, mínimo de 20 partidas por par
 *   npm run riot:build -- --patches 3 --min 30
 *
 * Para cada rota e par de campeões (A x B, em ordem alfabética), salva:
 *   games   número de partidas
 *   winA    taxa de vitória de A, puxada em direção a 50% quando há poucos jogos
 *   gold14A diferença média de ouro de A aos 14 min (só a rota)
 */
import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { CHAMPIONS } from "../../shared/champions";
import { LANES, type Lane } from "../../shared/types";
import { MATCHES_FILE, type MatchRecord } from "./common";

const args = process.argv.slice(2);
const arg = (name: string, fallback: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const PATCHES = Number(arg("patches", "2"));
const MIN_GAMES = Number(arg("min", "20"));
const INPUT = arg("input", "");
const OUTPUT = new URL("../../shared/data/matchups.json", import.meta.url);
// "Partidas imaginárias" de 50% somadas a cada par: evita que 3 vitórias em 3 jogos virem 100%.
const PRIOR_GAMES = 30;

export interface MatchupStat {
  games: number;
  winA: number;
  gold14A: number | null;
}

const source = INPUT || MATCHES_FILE;
if (!existsSync(source)) {
  console.error("Nenhuma partida coletada. Rode antes: npm run riot:collect");
  process.exit(1);
}

const records = readFileSync(source, "utf8")
  .split("\n")
  .filter(Boolean)
  .map((line) => JSON.parse(line) as MatchRecord);

// Mantém só os patches mais recentes.
const patchKey = (p: string) => p.split(".").map(Number).reduce((a, n) => a * 1000 + n, 0);
const patches = [...new Set(records.map((r) => r.patch))].sort((a, b) => patchKey(b) - patchKey(a)).slice(0, PATCHES);
const recent = records.filter((r) => patches.includes(r.patch));

// Os nomes da Riot quase sempre batem com os ids do Data Dragon; normaliza só a caixa.
const canonical = new Map(CHAMPIONS.map((c) => [c.id.toLowerCase(), c.id]));
const normalize = (name: string) => canonical.get(name.toLowerCase()) ?? name;

interface Acc { games: number; winsA: number; goldGames: number; goldSumA: number }
const acc: Record<Lane, Map<string, Acc>> = Object.fromEntries(LANES.map((l) => [l, new Map()])) as Record<Lane, Map<string, Acc>>;

for (const r of recent) {
  for (const lane of LANES) {
    const m = r.lanes[lane];
    if (!m) continue;
    const blue = normalize(m.blue);
    const red = normalize(m.red);
    if (blue === red) continue;
    const blueIsA = blue < red;
    const key = blueIsA ? `${blue}|${red}` : `${red}|${blue}`;
    const a = acc[lane].get(key) ?? { games: 0, winsA: 0, goldGames: 0, goldSumA: 0 };
    a.games++;
    if (r.blueWin === blueIsA) a.winsA++;
    if (m.gold14 !== undefined) {
      a.goldGames++;
      a.goldSumA += blueIsA ? m.gold14 : -m.gold14;
    }
    acc[lane].set(key, a);
  }
}

const lanes = {} as Record<Lane, Record<string, MatchupStat>>;
let pairs = 0;
for (const lane of LANES) {
  lanes[lane] = {};
  const sorted = [...acc[lane]].sort(([x], [y]) => x.localeCompare(y));
  for (const [key, a] of sorted) {
    if (a.games < MIN_GAMES) continue;
    lanes[lane][key] = {
      games: a.games,
      winA: Number(((a.winsA + PRIOR_GAMES * 0.5) / (a.games + PRIOR_GAMES)).toFixed(4)),
      gold14A: a.goldGames ? Math.round(a.goldSumA / a.goldGames) : null,
    };
    pairs++;
  }
}

await mkdir(new URL("../../shared/data/", import.meta.url), { recursive: true });
await writeFile(OUTPUT, JSON.stringify({
  generatedAt: new Date().toISOString(),
  patches,
  matches: recent.length,
  minGames: MIN_GAMES,
  lanes,
}, null, 1));

// Relatório: quantos pares envolvem só campeões do nosso pool.
console.log(`Patches ${patches.join(", ")} · ${recent.length} partidas · ${pairs} pares com >= ${MIN_GAMES} jogos`);
for (const lane of LANES) {
  const inPool = CHAMPIONS.filter((c) => c.lanes.includes(lane)).map((c) => c.id);
  const possible = (inPool.length * (inPool.length - 1)) / 2;
  const covered = Object.keys(lanes[lane]).filter((k) => k.split("|").every((id) => inPool.includes(id))).length;
  const extremes = Object.entries(lanes[lane])
    .filter(([k]) => k.split("|").every((id) => inPool.includes(id)))
    .sort(([, a], [, b]) => Math.abs(b.winA - 0.5) - Math.abs(a.winA - 0.5))
    .slice(0, 2)
    .map(([k, s]) => {
      const [a, b] = k.split("|");
      return s.winA >= 0.5 ? `${a} > ${b} (${(s.winA * 100).toFixed(1)}%)` : `${b} > ${a} (${((1 - s.winA) * 100).toFixed(1)}%)`;
    });
  console.log(`  ${lane.padEnd(8)} ${covered}/${possible} pares do pool${extremes.length ? ` · ex.: ${extremes.join(", ")}` : ""}`);
}
