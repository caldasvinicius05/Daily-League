import { championsForLane } from "./champions";
import { Match, matchSeed, playToEnd } from "./engine";
import { Rng } from "./rng";
import { LANES, type DailyChallenge, type Lane, type Team } from "./types";

export const TIMEZONE = "America/Sao_Paulo";

/** Data do desafio (AAAA-MM-DD) no fuso de Brasília: todos jogam o mesmo dia. */
export function todayKey(date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(date);
}

/** As 32 combinações possíveis de time do jogador. */
export function allCombos(options: Record<Lane, [string, string]>): Team[] {
  const combos: Team[] = [];
  for (let mask = 0; mask < 32; mask++) {
    const team = {} as Team;
    LANES.forEach((lane, i) => { team[lane] = options[lane][(mask >> i) & 1]; });
    combos.push(team);
  }
  return combos;
}

/** Taxa de vitória estimada de um time, jogando com o jogador automático em várias seeds. */
export function estimateWinRate(team: Team, enemy: Team, samples: number, salt: string): number {
  let wins = 0;
  for (let i = 0; i < samples; i++) {
    const match = playToEnd(new Match(team, enemy, `${salt}#${i}|${matchSeed("sim", team)}`));
    if (match.state.winner === "ally") wins++;
  }
  return wins / samples;
}

function draw(date: string, attempt: number): DailyChallenge {
  const rng = new Rng(`daily:${date}:${attempt}`);
  const used = new Set<string>();
  const enemy = {} as Team;
  const options = {} as Record<Lane, [string, string]>;
  for (const lane of LANES) {
    const pool = rng.shuffle(championsForLane(lane).filter((c) => !used.has(c.id)));
    const [e, a, b] = pool;
    enemy[lane] = e.id;
    options[lane] = [a.id, b.id];
    for (const c of [e, a, b]) used.add(c.id);
  }
  return { date, enemy, options };
}

/**
 * Sorteia o desafio do dia. Rejeita sorteios em que nenhum time vence com frequência
 * ou em que quase tudo vence — a escolha do draft precisa importar.
 */
export function generateDaily(date: string): DailyChallenge {
  // Se nenhum sorteio passar no filtro, usa o que chegou mais perto dele.
  let closest: { daily: DailyChallenge; distance: number } | null = null;
  for (let attempt = 0; attempt < 20; attempt++) {
    const daily = draw(date, attempt);
    const rates = allCombos(daily.options).map((t) => estimateWinRate(t, daily.enemy, 40, date));
    const best = Math.max(...rates);
    const winning = rates.filter((r) => r >= 0.5).length / rates.length;
    if (best >= 0.65 && winning >= 0.2 && winning <= 0.6) return daily;

    const distance = Math.max(0, 0.65 - best) + Math.max(0, 0.2 - winning, winning - 0.6);
    if (!closest || distance < closest.distance) closest = { daily, distance };
  }
  return closest!.daily;
}
