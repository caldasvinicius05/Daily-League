/**
 * Teste de balanceamento: gera os desafios dos próximos N dias e simula as 32
 * combinações de cada um com o jogador automático.
 *
 *   npm run balance            -> 7 dias
 *   npm run balance -- 30      -> 30 dias
 */
import { allCombos, estimateWinRate, generateDaily, todayKey } from "../shared/daily";
import { Match, matchSeed, playToEnd, TOWERS_TO_WIN, type ActionId } from "../shared/engine";
import { champName } from "../shared/meta";
import { LANES, type Team } from "../shared/types";

const days = Number(process.argv[2] ?? 7);
const SAMPLES = 60;

const teamLabel = (t: Team) => LANES.map((l) => champName(t[l])).join(", ");
const pct = (v: number) => `${Math.round(v * 100)}%`.padStart(4);

const totals = { games: 0, wins: 0, minutes: 0, byTowers: 0, kills: 0 };
const actions = new Map<ActionId, { used: number; success: number }>();

for (let d = 0; d < days; d++) {
  const date = todayKey(new Date(Date.now() + d * 86_400_000));
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
