/**
 * Teste de balanceamento: gera os desafios dos próximos N dias e simula as 32
 * combinações de cada um com o jogador automático.
 *
 *   npm run balance                              -> 7 dias a partir de hoje
 *   npm run balance -- 30                        -> 30 dias
 *   npm run balance -- 20 --from 2026-01-01      -> datas fixas (resultado reproduzível)
 *   npm run balance:check                        -> modo CI: falha se sair das faixas abaixo
 */
import { allCombos, estimateWinRate, generateDaily, todayKey } from "../shared/daily";
import { Match, matchSeed, playToEnd, TOWERS_TO_WIN, type ActionId } from "../shared/engine";
import { champName } from "../shared/meta";
import { LANES, type Team } from "../shared/types";

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const days = Number(args.find((a, i) => /^\d+$/.test(a) && !args[i - 1]?.startsWith("--")) ?? 7);
const from = flag("from");
const CHECK = args.includes("--check");
const start = from ? new Date(`${from}T15:00:00Z`) : new Date();
const SAMPLES = 60;

// Faixas aceitas no modo --check. Se uma mudança de motor sair delas, o CI falha.
const LIMITS = {
  playerWinRate: [0.35, 0.6],
  avgMinutes: [30, 45],
  endedByTowers: [0.55, 1],
  daysInRange: [0.8, 1], // dias com 20%–65% das combinações vencendo
  actionSuccess: [0.25, 0.85], // por tipo de decisão (com pelo menos 30 usos)
} as const;

const teamLabel = (t: Team) => LANES.map((l) => champName(t[l])).join(", ");
const pct = (v: number) => `${Math.round(v * 100)}%`.padStart(4);

const totals = { games: 0, wins: 0, minutes: 0, byTowers: 0, kills: 0 };
const actions = new Map<ActionId, { used: number; success: number }>();
let daysInRange = 0;

for (let d = 0; d < days; d++) {
  const date = todayKey(new Date(start.getTime() + d * 86_400_000));
  const daily = generateDaily(date);
  const rates = allCombos(daily.options)
    .map((team) => ({ team, wr: estimateWinRate(team, daily.enemy, SAMPLES, "balance") }))
    .sort((a, b) => b.wr - a.wr);

  // Estatísticas gerais das partidas
  for (const { team } of rates) {
    for (let i = 0; i < 10; i++) {
      const m = playToEnd(new Match(team, daily.enemy, `stats#${i}|${matchSeed(date, team)}`));
      totals.games++;
      if (m.state.winner === "ally") totals.wins++;
      totals.minutes += m.state.minute;
      totals.kills += m.state.ally.kills + m.state.enemy.kills;
      if (Math.max(m.state.ally.towers, m.state.enemy.towers) >= TOWERS_TO_WIN) totals.byTowers++;
      for (const dec of m.state.decisions) {
        const a = actions.get(dec.id) ?? { used: 0, success: 0 };
        a.used++;
        if (dec.success) a.success++;
        actions.set(dec.id, a);
      }
    }
  }

  const winning = rates.filter((r) => r.wr >= 0.5).length;
  if (winning / 32 >= 0.2 && winning / 32 <= 0.65) daysInRange++;
  console.log(`\n=== ${date} ===`);
  console.log(`Inimigo: ${teamLabel(daily.enemy)}`);
  console.log(`Combinações com >=50%: ${winning}/32 · melhor ${pct(rates[0].wr)} · pior ${pct(rates.at(-1)!.wr)}`);
  for (const r of rates.slice(0, 3)) console.log(`  ▲ ${pct(r.wr)}  ${teamLabel(r.team)}`);
  for (const r of rates.slice(-2)) console.log(`  ▼ ${pct(r.wr)}  ${teamLabel(r.team)}`);
}

console.log("\n=== Geral ===");
console.log(`Partidas simuladas: ${totals.games}`);
console.log(`Vitória do jogador (jogador automático, times aleatórios): ${pct(totals.wins / totals.games)}`);
console.log(`Duração média: ${(totals.minutes / totals.games).toFixed(1)} min`);
console.log(`Terminaram por torres: ${pct(totals.byTowers / totals.games)} (o resto vai até a luta final)`);
console.log(`Abates por partida: ${(totals.kills / totals.games).toFixed(1)}`);
console.log("Decisões (uso · taxa de sucesso):");
for (const [id, a] of [...actions].sort((x, y) => y[1].used - x[1].used)) {
  console.log(`  ${id.padEnd(10)} ${String(a.used).padStart(5)} · ${pct(a.success / a.used)}`);
}

// ------------------------------------------------------------------ Modo CI

if (CHECK) {
  const inside = (v: number, [min, max]: readonly [number, number]) => v >= min && v <= max;
  const checks: [string, number, readonly [number, number], (v: number) => string][] = [
    ["Vitória do jogador", totals.wins / totals.games, LIMITS.playerWinRate, pct],
    ["Duração média (min)", totals.minutes / totals.games, LIMITS.avgMinutes, (v) => v.toFixed(1)],
    ["Terminaram por torres", totals.byTowers / totals.games, LIMITS.endedByTowers, pct],
    ["Dias na faixa de dificuldade", daysInRange / days, LIMITS.daysInRange, pct],
    ...[...actions]
      .filter(([, a]) => a.used >= 30)
      .map(([id, a]) => [`Sucesso de "${id}"`, a.success / a.used, LIMITS.actionSuccess, pct] as [string, number, readonly [number, number], (v: number) => string]),
  ];

  console.log("\n=== Checagem de balanceamento ===");
  let failed = 0;
  for (const [label, value, range, fmt] of checks) {
    const ok = inside(value, range);
    if (!ok) failed++;
    console.log(`${ok ? "✅" : "❌"} ${label.padEnd(30)} ${fmt(value).trim().padStart(6)}  (aceito: ${fmt(range[0]).trim()}–${fmt(range[1]).trim()})`);
  }
  if (failed) {
    console.error(`\n${failed} checagem(ns) fora da faixa. Ajuste o motor ou, se a mudança for intencional, as faixas em LIMITS.`);
    process.exit(1);
  }
  console.log("\nBalanceamento dentro das faixas.");
}
