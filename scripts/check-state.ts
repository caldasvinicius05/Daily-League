// Verifica a consistência do estado individual dos campeões ao longo de muitas partidas.
import { allCombos, generateDaily, todayKey } from "../shared/daily";
import { Match, matchSeed, playToEnd, TOWERS_TO_WIN, type DecisionPrompt, type EventKind, type Side } from "../shared/engine";
import { LANES } from "../shared/types";

// Lutas, abates e torres sempre dizem quem estava lá.
const NEEDS_PARTICIPANTS = new Set<EventKind>(["lane-kill", "gank", "gank-fail", "gank-escape", "skirmish", "pick", "tower", "teamfight", "dragon", "baron", "action"]);

const daily = generateDaily(todayKey(new Date("2026-01-01T15:00:00Z")));
const errors: string[] = [];
let checked = 0;
let events = 0;
let withParticipants = 0;

for (const team of allCombos(daily.options)) {
  for (const pickIndex of [0, 1, 2]) {
    const choose = (p: DecisionPrompt) => p.options[Math.min(pickIndex, p.options.length - 1)].id;
    const m = playToEnd(new Match(team, daily.enemy, matchSeed(daily.date, team)), choose);
    const s = m.state;
    for (const side of ["ally", "enemy"] as Side[]) {
      const foe: Side = side === "ally" ? "enemy" : "ally";
      const champs = LANES.map((l) => s.champions[side][l]);
      const kills = champs.reduce((n, c) => n + c.kills, 0);
      const deathsOfFoe = LANES.reduce((n, l) => n + s.champions[foe][l].deaths, 0);
      const gold = champs.reduce((n, c) => n + c.gold, 0);
      if (kills !== s[side].kills) errors.push(`${side}: abates individuais ${kills} != time ${s[side].kills}`);
      if (deathsOfFoe !== s[side].kills) errors.push(`${side}: mortes do inimigo ${deathsOfFoe} != abates ${s[side].kills}`);
      if (Math.abs(gold - s[side].gold) > 1) errors.push(`${side}: ouro individual ${gold} != time ${s[side].gold}`);
      if (s.towersStanding[foe].length !== TOWERS_TO_WIN - s[side].towers) errors.push(`${side}: torres de pé inconsistentes`);
    }
    for (const e of s.events) {
      events++;
      if (e.allies.length || e.enemies.length) withParticipants++;
      else if (NEEDS_PARTICIPANTS.has(e.kind) && !e.text.includes("farmou com segurança")) errors.push(`evento sem participantes (${e.kind}): ${e.text}`);
      for (const v of e.victims) {
        const inEvent = (v.side === "ally" ? e.allies : e.enemies).includes(v.lane);
        if (!inEvent && (e.allies.length || e.enemies.length)) errors.push(`vítima fora do evento: ${e.text}`);
      }
    }
    checked++;
  }
}

if (errors.length) {
  console.error([...new Set(errors)].slice(0, 15).join("\n"));
  console.error(`${errors.length} inconsistência(s) em ${checked} partidas.`);
  process.exit(1);
}
console.log(`OK: ${checked} partidas consistentes · ${events} eventos (${Math.round((withParticipants / events) * 100)}% com participantes).`);
