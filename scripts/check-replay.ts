// Verifica que o servidor consegue reproduzir exatamente qualquer partida jogada no cliente.
import { allCombos, generateDaily, todayKey } from "../shared/daily";
import { Match, matchSeed, playToEnd, replayMatch, type DecisionPrompt } from "../shared/engine";

const daily = generateDaily(todayKey());
let checked = 0;
for (const team of allCombos(daily.options)) {
  for (const pickIndex of [0, 1, 2]) {
    const choose = (p: DecisionPrompt) => p.options[Math.min(pickIndex, p.options.length - 1)].id;
    const played = playToEnd(new Match(team, daily.enemy, matchSeed(daily.date, team)), choose);
    const replayed = replayMatch(daily, team, played.state.decisions.map((d) => d.id));
    if (JSON.stringify(played.summary()) !== JSON.stringify(replayed.summary())) {
      throw new Error(`Replay divergiu para ${JSON.stringify(team)}`);
    }
    checked++;
  }
}
console.log(`OK: ${checked} partidas reproduzidas de forma idêntica.`);
