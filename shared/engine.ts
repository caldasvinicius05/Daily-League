/**
 * Motor de simulação da partida.
 *
 * Tudo é determinístico: a seed vem da data + picks, e cada decisão consome o RNG
 * na mesma ordem. Mesmo time + mesmas decisões => mesma partida (o servidor usa isso
 * para revalidar o resultado enviado pelo cliente).
 *
 * Cada turno = 2 minutos. Turnos 1–5 são a fase de rotas; depois vêm lutas,
 * objetivos e torres. Nos DECISION_TURNS o jogador escolhe a jogada.
 */
import { getChampion } from "./champions";
import { laneEdge } from "./matchups";
import { champName } from "./meta";
import { Rng } from "./rng";
import {
  ATTRIBUTE_KEYS, LANES, LANE_LABEL,
  type Attributes, type ChampionDef, type DailyChallenge, type Lane, type Team,
} from "./types";

export type Side = "ally" | "enemy";
export type ActionId = "teamfight" | "dragon" | "baron" | "dive" | "siege" | "split" | "farm" | "invade";
export type LaneOutcome = "win" | "loss" | "even";

export const MINUTES_PER_TURN = 2;
export const MAX_TURNS = 22;
export const TOWERS_TO_WIN = 11;
export const DECISION_TURNS = [4, 8, 12, 16, 20];
const LANE_PHASE_END = 5;
const FIRST_DRAGON_TURN = 3;
const DRAGON_RESPAWN = 3;
const FIRST_BARON_TURN = 10;
const BARON_RESPAWN = 3;
const BARON_DURATION = 2;
const PASSIVE_GOLD = 1900;

export interface MatchEvent {
  minute: number;
  side: Side | "neutral";
  text: string;
}

export interface DecisionOption {
  id: ActionId;
  label: string;
  description: string;
  risk: "Baixo" | "Médio" | "Alto";
  chance: number;
}

export interface DecisionPrompt {
  turn: number;
  minute: number;
  title: string;
  options: DecisionOption[];
}

export interface DecisionRecord {
  turn: number;
  id: ActionId;
  success: boolean;
  chance: number;
}

export interface SideState {
  gold: number;
  kills: number;
  towers: number; // torres inimigas destruídas por este lado
  dragons: number;
  barons: number;
  baronTurns: number; // turnos restantes do buff do Barão
}

type BigLane = "top" | "mid" | "bot";

export interface MatchState {
  turn: number;
  minute: number;
  ally: SideState;
  enemy: SideState;
  laneLead: Record<BigLane, number>; // ouro de vantagem da rota (positivo = aliado)
  jungleScore: number; // ganks bem-sucedidos (positivo = aliado)
  laneResults: Record<Lane, LaneOutcome> | null;
  dragonUp: boolean;
  nextDragonTurn: number;
  baronUp: boolean;
  nextBaronTurn: number;
  events: MatchEvent[];
  decisions: DecisionRecord[];
  pending: DecisionPrompt | null;
  winner: Side | null;
}

export interface MatchSummary {
  won: boolean;
  minute: number;
  kills: number;
  deaths: number;
  towers: number;
  dragons: number;
  barons: number;
  lanes: Record<Lane, LaneOutcome>;
  decisions: { id: ActionId; success: boolean }[];
}

const ACTIONS: Record<ActionId, Omit<DecisionOption, "id" | "chance">> = {
  teamfight: {
    label: "Forçar teamfight",
    description: "Agrupar e buscar a luta 5x5. Favorece engage, controle e vantagem de ouro.",
    risk: "Médio",
  },
  dragon: {
    label: "Disputar o Dragão",
    description: "Controlar o rio e lutar pelo Dragão. Caçador forte e prioridade no bot ajudam.",
    risk: "Médio",
  },
  baron: {
    label: "Fazer o Barão",
    description: "Recompensa enorme, mas um time com engage pode punir — ou roubar.",
    risk: "Alto",
  },
  dive: {
    label: "Dive na torre",
    description: "Mergulhar sob a torre inimiga. Precisa de engage, burst e mobilidade contra pouco peel.",
    risk: "Alto",
  },
  siege: {
    label: "Cercar a torre",
    description: "Pressionar com poke e controle de ondas. Perigoso contra times de engage.",
    risk: "Médio",
  },
  split: {
    label: "Splitpush",
    description: "Seu topo pressiona uma rota lateral enquanto o time segura o mapa.",
    risk: "Médio",
  },
  farm: {
    label: "Recuar e escalar",
    description: "Evitar lutas e farmar. Bom para late game; o inimigo pode pegar uma torre de graça.",
    risk: "Baixo",
  },
  invade: {
    label: "Invadir a selva",
    description: "Roubar campos e caçar o caçador inimigo. Exige um time forte no início.",
    risk: "Médio",
  },
};

// Peso de cada jogada para o "jogador automático" usado nos testes de balanceamento.
const AUTO_VALUE: Record<ActionId, number> = {
  teamfight: 1, dragon: 0.9, baron: 1.3, dive: 1, siege: 0.9, split: 0.85, farm: 0.6, invade: 0.7,
};

const TEAM_NAME: Record<Side, string> = { ally: "Seu time", enemy: "O inimigo" };
const GANK_PLACE = { top: "o topo", mid: "o meio", adc: "o bot" } as const;

const formatGold = (gold: number) => `${gold >= 0 ? "+" : ""}${(gold / 1000).toFixed(1)}k`;

interface Profile {
  champs: Record<Lane, ChampionDef>;
  sum: Attributes;
  apShare: number; // fração do dano que é mágico
  frontline: number; // maior "tank" fora do atirador
}

function emptyAttributes(): Attributes {
  return Object.fromEntries(ATTRIBUTE_KEYS.map((k) => [k, 0])) as unknown as Attributes;
}

function buildProfile(team: Team): Profile {
  const champs = {} as Record<Lane, ChampionDef>;
  const sum = emptyAttributes();
  let ap = 0;
  let total = 0;
  let frontline = 0;
  for (const lane of LANES) {
    const c = getChampion(team[lane]);
    champs[lane] = c;
    for (const k of ATTRIBUTE_KEYS) sum[k] += c.attrs[k];
    const weight = c.attrs.burst + c.attrs.dps;
    total += weight;
    ap += weight * (c.dmg === "AP" ? 1 : c.dmg === "MIX" ? 0.5 : 0);
    if (lane !== "adc") frontline = Math.max(frontline, c.attrs.tank);
  }
  return { champs, sum, apShare: total ? ap / total : 0.5, frontline };
}

/** Médias de composição para a tela de draft (aceita time incompleto). */
export function summarizeTeam(ids: string[]) {
  const champs = ids.map(getChampion);
  const avg = (k: keyof Attributes) => (champs.length ? champs.reduce((s, c) => s + c.attrs[k], 0) / champs.length : 0);
  let ap = 0;
  let total = 0;
  for (const c of champs) {
    const w = c.attrs.burst + c.attrs.dps;
    total += w;
    ap += w * (c.dmg === "AP" ? 1 : c.dmg === "MIX" ? 0.5 : 0);
  }
  return {
    early: avg("early"),
    late: avg("late"),
    engage: avg("engage"),
    cc: avg("cc"),
    poke: avg("poke"),
    peel: avg("peel"),
    frontline: champs.reduce((m, c) => Math.max(m, c.attrs.tank), 0),
    apShare: total ? ap / total : 0.5,
  };
}

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
const other = (side: Side): Side => (side === "ally" ? "enemy" : "ally");

/** Probabilidade de A vencer B; "sharpness" maior = vantagens pesam mais. */
export function winChance(a: number, b: number, sharpness = 4): number {
  const x = Math.pow(Math.max(a, 0.01), sharpness);
  const y = Math.pow(Math.max(b, 0.01), sharpness);
  return clamp(x / (x + y), 0.05, 0.95);
}

export function matchSeed(date: string, team: Team): string {
  return `${date}|${LANES.map((l) => team[l]).join(",")}`;
}

export class Match {
  readonly state: MatchState;
  private readonly rng: Rng;
  private readonly profiles: Record<Side, Profile>;
  /** Vantagem do aliado em cada confronto de rota (dados reais + atributos). */
  private readonly laneEdges: Record<Lane, number>;

  constructor(readonly allyTeam: Team, readonly enemyTeam: Team, seedKey: string) {
    this.rng = new Rng(seedKey);
    this.profiles = { ally: buildProfile(allyTeam), enemy: buildProfile(enemyTeam) };
    this.laneEdges = Object.fromEntries(
      LANES.map((l) => [l, laneEdge(l, allyTeam[l], enemyTeam[l])]),
    ) as Record<Lane, number>;
    const side = (): SideState => ({ gold: 2500, kills: 0, towers: 0, dragons: 0, barons: 0, baronTurns: 0 });
    this.state = {
      turn: 0,
      minute: 0,
      ally: side(),
      enemy: side(),
      laneLead: { top: 0, mid: 0, bot: 0 },
      jungleScore: 0,
      laneResults: null,
      dragonUp: false,
      nextDragonTurn: FIRST_DRAGON_TURN,
      baronUp: false,
      nextBaronTurn: FIRST_BARON_TURN,
      events: [],
      decisions: [],
      pending: null,
      winner: null,
    };
  }

  // ------------------------------------------------------------------ API

  /** Avança um turno. Em turnos de decisão, preenche state.pending e espera decide(). */
  advance(): MatchEvent[] {
    const s = this.state;
    if (s.winner || s.pending) return [];
    const before = s.events.length;

    s.turn++;
    s.minute = s.turn * MINUTES_PER_TURN;
    s.ally.gold += PASSIVE_GOLD;
    s.enemy.gold += PASSIVE_GOLD;
    this.spawnObjectives();

    if (DECISION_TURNS.includes(s.turn)) {
      s.pending = this.buildPrompt();
    } else {
      if (s.turn <= LANE_PHASE_END) this.laneTurn();
      else this.midTurn();
      this.endTurn();
    }
    return s.events.slice(before);
  }

  /** Resolve a decisão pendente com a opção escolhida. */
  decide(id: ActionId): MatchEvent[] {
    const s = this.state;
    const prompt = s.pending;
    if (!prompt) throw new Error("Nenhuma decisão pendente");
    const option = prompt.options.find((o) => o.id === id);
    if (!option) throw new Error(`Opção inválida: ${id}`);

    const before = s.events.length;
    s.pending = null;
    const success = this.rng.chance(option.chance);
    s.decisions.push({ turn: s.turn, id, success, chance: option.chance });
    this.resolveAction(id, success, option.chance);
    this.endTurn();
    return s.events.slice(before);
  }

  summary(): MatchSummary {
    const s = this.state;
    return {
      won: s.winner === "ally",
      minute: s.minute,
      kills: s.ally.kills,
      deaths: s.enemy.kills,
      towers: s.ally.towers,
      dragons: s.ally.dragons,
      barons: s.ally.barons,
      lanes: s.laneResults ?? this.computeLaneResults(),
      decisions: s.decisions.map((d) => ({ id: d.id, success: d.success })),
    };
  }

  // --------------------------------------------------------------- Poder

  /** 0 no início do jogo, 1 a partir de ~34 min. */
  private progress(): number {
    return clamp((this.state.turn - 1) / 16, 0, 1);
  }

  private curve(c: ChampionDef): number {
    const t = this.progress();
    return c.attrs.early * (1 - t) + c.attrs.late * t;
  }

  private teamPower(side: Side): number {
    const p = this.profiles[side];
    const st = this.state[side];
    const t = this.progress();
    let power = 0;
    for (const lane of LANES) {
      const a = p.champs[lane].attrs;
      const damage = a.burst * 0.8 + a.dps;
      const utility = a.engage * 0.4 + a.cc * 0.5 + a.peel * 0.4 + a.tank * 0.5;
      power += (damage + utility) * (0.55 + this.curve(p.champs[lane]) * 0.15);
    }
    // Dano todo de um tipo fica fácil de itemizar contra com o passar do jogo.
    power *= 1 - Math.abs(p.apShare - 0.5) * 0.4 * t;
    if (p.frontline < 3) power *= 0.93;
    power *= clamp(1 + this.goldDiff(side) / 25000, 0.6, 1.4);
    power *= 1 + st.dragons * 0.03 + (st.dragons >= 4 ? 0.08 : 0);
    if (st.baronTurns > 0) power *= 1.15;
    return power;
  }

  private goldDiff(side: Side): number {
    return this.state[side].gold - this.state[other(side)].gold;
  }

  private objectiveFactor(side: Side): number {
    const jg = this.profiles[side].champs.jungle.attrs;
    const botLead = side === "ally" ? this.state.laneLead.bot : -this.state.laneLead.bot;
    return 0.85 + jg.dps * 0.03 + jg.early * 0.02 * (1 - this.progress()) + (botLead > 0 ? 0.05 : 0);
  }

  private optionChance(id: ActionId): number {
    const A = this.profiles.ally;
    const E = this.profiles.enemy;
    const pa = this.teamPower("ally");
    const pe = this.teamPower("enemy");
    const ratio = Math.sqrt(pa / pe);

    switch (id) {
      case "teamfight": {
        const engageEdge = (A.sum.engage + A.sum.cc * 0.5) - (E.sum.engage + E.sum.cc * 0.5);
        return winChance(pa * (1 + engageEdge * 0.015), pe, 4);
      }
      case "dragon":
        return winChance(pa * this.objectiveFactor("ally"), pe * this.objectiveFactor("enemy"), 4);
      case "baron": {
        const dpsEdge = A.sum.dps - E.sum.dps;
        const contest = E.sum.engage + E.champs.jungle.attrs.mobility;
        return winChance(pa * 0.88 * (1 + dpsEdge * 0.02), pe * (1 + contest * 0.008), 4);
      }
      case "dive": {
        const atk = (A.sum.engage + A.sum.burst + A.sum.mobility * 0.6) * 0.9;
        const def = E.sum.peel + E.sum.tank + E.sum.cc * 0.6;
        return winChance(atk * ratio, def, 3);
      }
      case "siege": {
        const atk = A.sum.poke * 1.2 + A.sum.dps * 0.5 + A.sum.cc * 0.3;
        const def = E.sum.engage * 0.8 + E.sum.poke * 0.6 + E.sum.tank * 0.3;
        return winChance(atk * ratio, def, 3);
      }
      case "split": {
        const top = A.champs.top;
        const eTop = E.champs.top.attrs;
        const atk = top.attrs.split * 1.5 + top.attrs.dps + top.attrs.mobility * 0.5 + this.curve(top);
        const def = eTop.split * 0.7 + eTop.tank + eTop.dps * 0.7 + E.champs.jungle.attrs.mobility * 0.5 + 1.5;
        return winChance(atk * ratio, def, 2.5);
      }
      case "farm": {
        const t = this.progress();
        const atk = A.sum.late + A.sum.peel * 0.5;
        const def = E.sum.early * 1.2 * (1 - t) + E.sum.late * t + E.sum.split * 0.5 + E.sum.engage * 0.4;
        return winChance(atk, def, 2);
      }
      case "invade": {
        const score = (p: Profile) => p.champs.jungle.attrs.early * 1.5 + p.champs.mid.attrs.early * 0.7
          + p.champs.support.attrs.early * 0.7 + p.sum.mobility * 0.2;
        return winChance(score(A), score(E), 3);
      }
    }
  }

  // ------------------------------------------------------------- Helpers

  private log(side: Side | "neutral", text: string) {
    this.state.events.push({ minute: this.state.minute, side, text });
  }

  private name(side: Side, lane: Lane): string {
    return champName(this.profiles[side].champs[lane].id);
  }

  /** Campeão que mais causa dano no momento atual do jogo. */
  private star(side: Side): string {
    const champs = this.profiles[side].champs;
    const best = LANES.reduce((a, b) => {
      const score = (l: Lane) => (champs[l].attrs.burst + champs[l].attrs.dps) * this.curve(champs[l]);
      return score(b) > score(a) ? b : a;
    });
    return champName(champs[best].id);
  }

  private addGold(side: Side, amount: number) {
    this.state[side].gold += Math.round(amount);
  }

  private kill(side: Side, n: number) {
    this.state[side].kills += n;
    this.addGold(side, 300 * n);
  }

  private destroyTowers(side: Side, n: number): number {
    const st = this.state[side];
    const taken = Math.min(n, TOWERS_TO_WIN - st.towers);
    st.towers += taken;
    this.addGold(side, 600 * taken);
    return taken;
  }

  /** Luta genérica: retorna [abates do vencedor, abates do perdedor]. */
  private fight(winner: Side, win: [number, number], lose: [number, number]): [number, number] {
    const w = this.rng.int(...win);
    const l = this.rng.int(...lose);
    this.kill(winner, w);
    this.kill(other(winner), l);
    return [w, l];
  }

  private towersText(n: number) {
    return n === 1 ? "1 torre" : `${n} torres`;
  }

  // ------------------------------------------------------------- Objetivos

  private spawnObjectives() {
    const s = this.state;
    const soulTaken = s.ally.dragons >= 4 || s.enemy.dragons >= 4;
    if (!s.dragonUp && !soulTaken && s.turn >= s.nextDragonTurn) {
      s.dragonUp = true;
      this.log("neutral", "🐉 Um Dragão apareceu no rio.");
    }
    if (!s.baronUp && s.turn >= s.nextBaronTurn) {
      s.baronUp = true;
      this.log("neutral", "👾 O Barão Na'Shor está disponível.");
    }
  }

  private giveDragon(side: Side) {
    const s = this.state;
    s[side].dragons++;
    this.addGold(side, 200);
    s.dragonUp = false;
    s.nextDragonTurn = s.turn + DRAGON_RESPAWN;
    const n = s[side].dragons;
    this.log(side, n >= 4
      ? `🐉 ${TEAM_NAME[side]} conquistou a ALMA DO DRAGÃO!`
      : `🐉 ${TEAM_NAME[side]} garantiu o Dragão (${n}/4).`);
  }

  private giveBaron(side: Side) {
    const s = this.state;
    s[side].barons++;
    s[side].baronTurns = BARON_DURATION;
    this.addGold(side, 1500);
    s.baronUp = false;
    s.nextBaronTurn = s.turn + BARON_RESPAWN;
    this.log(side, `👾 ${TEAM_NAME[side]} abateu o Barão Na'Shor!`);
  }

  private autoDragon() {
    const chance = winChance(
      this.teamPower("ally") * this.objectiveFactor("ally"),
      this.teamPower("enemy") * this.objectiveFactor("enemy"),
      4,
    );
    const winner: Side = this.rng.chance(chance) ? "ally" : "enemy";
    if (this.rng.chance(0.4)) {
      const [w, l] = this.fight(winner, [1, 2], [0, 1]);
      this.log(winner, `Briga no rio pelo Dragão: ${TEAM_NAME[winner].toLowerCase()} levou a melhor (${w}x${l}).`);
    }
    this.giveDragon(winner);
  }

  // ---------------------------------------------------------- Fase de rotas

  private laneTurn() {
    const lanes: { key: BigLane; members: Lane[]; label: string }[] = [
      { key: "top", members: ["top"], label: "no topo" },
      { key: "mid", members: ["mid"], label: "no meio" },
      { key: "bot", members: ["adc", "support"], label: "no bot" },
    ];
    for (const lane of lanes) {
      const edge = lane.members.reduce((sum, l) => sum + this.laneEdges[l], 0) / lane.members.length;
      const diff = edge + this.rng.range(-1.5, 1.5);
      const gold = Math.round(diff * 80);
      this.state.laneLead[lane.key] += gold;
      this.addGold(gold > 0 ? "ally" : "enemy", Math.abs(gold));

      if (Math.abs(diff) > 1.8 && this.rng.chance(0.4)) {
        const winner: Side = diff > 0 ? "ally" : "enemy";
        this.kill(winner, 1);
        this.state.laneLead[lane.key] += winner === "ally" ? 300 : -300;
        const killer = this.name(winner, lane.members[0]);
        const victim = this.name(other(winner), this.rng.pick(lane.members));
        this.log(winner, `⚔️ ${killer} abateu ${victim} ${lane.label}.`);
      }
    }

    if (this.state.dragonUp) this.autoDragon();
    else this.jungleTurn();
  }

  private jungleTurn() {
    const jA = this.profiles.ally.champs.jungle.attrs;
    const jE = this.profiles.enemy.champs.jungle.attrs;
    // Quem vence o confronto de selva (dados de ouro/vitória) ganha a iniciativa com mais frequência.
    const initiative = clamp(jA.early / (jA.early + jE.early) + this.laneEdges.jungle * 0.06, 0.15, 0.85);
    const actor: Side = this.rng.chance(initiative) ? "ally" : "enemy";
    if (!this.rng.chance(0.65)) return; // o caçador ficou farmando

    const target = this.rng.pick(["top", "mid", "adc"] as const);
    const atkLaner = this.profiles[actor].champs[target].attrs;
    const defLaner = this.profiles[other(actor)].champs[target].attrs;
    const jungler = this.profiles[actor].champs.jungle.attrs;
    const defSupport = target === "adc" ? this.profiles[other(actor)].champs.support.attrs.peel * 0.5 : 0;

    const atk = jungler.early + jungler.engage * 0.4 + atkLaner.cc * 0.8;
    const def = defLaner.mobility * 0.8 + defLaner.peel * 0.4 + defSupport + 2;
    const ganker = this.name(actor, "jungle");
    const victim = this.name(other(actor), target);
    const laneKey: BigLane = target === "adc" ? "bot" : target;

    if (this.rng.chance(winChance(atk, def, 2))) {
      this.kill(actor, 1);
      this.state.laneLead[laneKey] += actor === "ally" ? 300 : -300;
      this.state.jungleScore += actor === "ally" ? 1 : -1;
      this.log(actor, `🌿 ${ganker} gankou ${GANK_PLACE[target]} e abateu ${victim}.`);
    } else if (this.rng.chance(0.25)) {
      this.kill(other(actor), 1);
      this.state.jungleScore += actor === "ally" ? -1 : 1;
      this.log(other(actor), `🌿 Gank falhou: ${victim} virou a luta e abateu ${ganker}.`);
    } else {
      this.log("neutral", `🌿 ${victim} escapou do gank de ${ganker}.`);
    }
  }

  private computeLaneResults(): Record<Lane, LaneOutcome> {
    const outcome = (lead: number, margin: number): LaneOutcome =>
      lead > margin ? "win" : lead < -margin ? "loss" : "even";
    const { laneLead, jungleScore } = this.state;
    return {
      top: outcome(laneLead.top, 250),
      jungle: outcome(jungleScore, 0),
      mid: outcome(laneLead.mid, 250),
      adc: outcome(laneLead.bot, 250),
      support: outcome(laneLead.bot, 250),
    };
  }

  private closeLanePhase() {
    const s = this.state;
    s.laneResults = this.computeLaneResults();
    const labels: Record<BigLane, [Lane, string]> = { top: ["top", "do topo"], mid: ["mid", "do meio"], bot: ["adc", "do bot"] };
    for (const key of ["top", "mid", "bot"] as BigLane[]) {
      const lead = s.laneLead[key];
      if (Math.abs(lead) < 900) continue;
      const side: Side = lead > 0 ? "ally" : "enemy";
      this.destroyTowers(side, 1);
      const [lane, label] = labels[key];
      this.log(side, `🏰 ${this.name(side, lane)} derrubou a primeira torre ${label}.`);
    }
    const won = Object.values(s.laneResults).filter((r) => r === "win").length;
    this.log("neutral", `Fim da fase de rotas — você venceu ${won} de 5 rotas.`);
  }

  // ------------------------------------------------------- Meio / fim de jogo

  private midTurn() {
    const s = this.state;
    if (s.dragonUp) {
      this.autoDragon();
      return;
    }
    const pa = this.teamPower("ally");
    const pe = this.teamPower("enemy");

    if (s.baronUp) {
      const ratio = pa / pe;
      if ((ratio > 1.25 || ratio < 0.8) && this.rng.chance(0.6)) {
        this.giveBaron(ratio > 1 ? "ally" : "enemy");
        return;
      }
    }

    const roll = this.rng.next();
    if (roll < 0.35) {
      const winner: Side = this.rng.chance(winChance(pa, pe, 3)) ? "ally" : "enemy";
      const [w, l] = this.fight(winner, [1, 3], [0, 1]);
      const t = w - l >= 2 ? this.destroyTowers(winner, 1) : 0;
      this.log(winner, `⚔️ Escaramuça na selva: ${TEAM_NAME[winner].toLowerCase()} venceu (${w}x${l})${t ? " e aproveitou para derrubar uma torre" : ""}.`);
    } else if (roll < 0.55) {
      const A = this.profiles.ally.sum;
      const E = this.profiles.enemy.sum;
      const winner: Side = this.rng.chance(winChance(A.cc + A.burst, E.cc + E.burst, 2)) ? "ally" : "enemy";
      this.kill(winner, 1);
      const lane = this.rng.pick(LANES);
      this.log(winner, `🎯 ${this.name(winner, "jungle")} pegou ${this.name(other(winner), lane)} desprevenido.`);
    } else {
      const A = this.profiles.ally.sum;
      const E = this.profiles.enemy.sum;
      const chance = winChance(pa * (1 + A.split * 0.01 + A.poke * 0.01), pe * (1 + E.split * 0.01 + E.poke * 0.01), 3);
      const winner: Side = this.rng.chance(chance) ? "ally" : "enemy";
      // Vantagem clara de poder vira bola de neve: duas torres de uma vez.
      const dominant = (winner === "ally" ? pa / pe : pe / pa) > 1.15;
      const t = this.destroyTowers(winner, dominant ? 2 : 1);
      if (t) this.log(winner, `🏰 ${TEAM_NAME[winner]} pressionou as rotas e derrubou ${this.towersText(t)}.`);
    }
  }

  private endTurn() {
    const s = this.state;
    if (s.turn === LANE_PHASE_END) this.closeLanePhase();

    for (const side of ["ally", "enemy"] as Side[]) {
      if (s[side].baronTurns > 0) {
        s[side].baronTurns--;
        if (this.destroyTowers(side, 1)) this.log(side, `👾 Com o buff do Barão, ${TEAM_NAME[side].toLowerCase()} derruba mais uma torre.`);
      }
    }

    this.checkWinner();
    if (!s.winner && s.turn >= MAX_TURNS) {
      const winner: Side = this.rng.chance(winChance(this.teamPower("ally"), this.teamPower("enemy"), 4)) ? "ally" : "enemy";
      this.log(winner, `⚔️ Luta final pelo Nexus! ${this.star(winner)} decide a partida.`);
      s.winner = winner;
      this.log(winner, winner === "ally" ? "🏆 VITÓRIA!" : "💀 DERROTA.");
    }
  }

  private checkWinner() {
    const s = this.state;
    for (const side of ["ally", "enemy"] as Side[]) {
      if (!s.winner && s[side].towers >= TOWERS_TO_WIN) {
        s.winner = side;
        this.log(side, side === "ally" ? "🏆 O Nexus inimigo caiu. VITÓRIA!" : "💀 Seu Nexus foi destruído. DERROTA.");
      }
    }
  }

  // ------------------------------------------------------------- Decisões

  private buildPrompt(): DecisionPrompt {
    const s = this.state;
    const early = s.turn <= LANE_PHASE_END;
    const forced: ActionId[] = [];
    if (s.baronUp && !early) forced.push("baron");
    if (s.dragonUp) forced.push("dragon");
    const pool: ActionId[] = early ? ["invade", "dive", "farm"] : ["teamfight", "siege", "split", "dive", "farm"];
    const ids = [...forced, ...this.rng.shuffle(pool)].slice(0, 3);

    const options = ids.map((id) => {
      const meta = ACTIONS[id];
      const label = id === "split" ? `Splitpush com ${this.name("ally", "top")}` : meta.label;
      return { id, ...meta, label, chance: this.optionChance(id) };
    });

    const context = [
      early ? "A fase de rotas está acabando." : `Ouro: ${formatGold(this.goldDiff("ally"))}.`,
      s.baronUp && !early ? "O Barão está vivo." : "",
      s.dragonUp ? "O Dragão está no rio." : "",
    ].filter(Boolean).join(" ");

    this.log("neutral", `⏸️ Momento decisivo aos ${s.minute} min. ${context}`);
    return { turn: s.turn, minute: s.minute, title: `Momento decisivo — ${s.minute} min`, options };
  }

  private resolveAction(id: ActionId, success: boolean, chance: number) {
    const pct = `(chance estimada: ${Math.round(chance * 100)}%)`;
    const us: Side = "ally";
    const them: Side = "enemy";

    switch (id) {
      case "teamfight": {
        const winner = success ? us : them;
        const [w, l] = this.fight(winner, [3, 5], [0, 2]);
        const t = this.destroyTowers(winner, 2);
        this.log(winner, success
          ? `✅ Teamfight vencida! ${this.star(us)} brilhou (${w}x${l}) e o time derrubou ${this.towersText(t)}. ${pct}`
          : `❌ O inimigo venceu a teamfight (${w}x${l}) e derrubou ${this.towersText(t)}. ${pct}`);
        break;
      }
      case "dragon": {
        const winner = success ? us : them;
        const [w, l] = this.fight(winner, [1, 2], [0, 1]);
        this.log(winner, success
          ? `✅ Seu time controlou o rio (${w}x${l}). ${pct}`
          : `❌ O inimigo chegou primeiro ao rio (${w}x${l}). ${pct}`);
        this.giveDragon(winner);
        break;
      }
      case "baron": {
        if (success) {
          const [w, l] = this.fight(us, [1, 2], [0, 1]);
          this.log(us, `✅ Barão feito com segurança (${w}x${l}). ${pct}`);
          this.giveBaron(us);
        } else if (this.rng.chance(0.5)) {
          this.log(them, `❌ ROUBADO! ${this.name(them, "jungle")} roubou o Barão. ${pct}`);
          this.fight(them, [2, 4], [0, 1]);
          this.giveBaron(them);
        } else {
          const [w, l] = this.fight(them, [3, 5], [0, 2]);
          this.destroyTowers(them, 1);
          this.log(them, `❌ O inimigo pegou seu time no Barão (${w}x${l}) e avançou. ${pct}`);
        }
        break;
      }
      case "dive": {
        const E = this.profiles.enemy.champs;
        const target = (["top", "mid", "adc"] as Lane[]).reduce((a, b) =>
          E[b].attrs.tank + E[b].attrs.peel < E[a].attrs.tank + E[a].attrs.peel ? b : a);
        if (success) {
          const [w] = this.fight(us, [2, 3], [0, 1]);
          this.destroyTowers(us, 1);
          this.log(us, `✅ Dive perfeito na rota ${LANE_LABEL[target].toLowerCase()}: ${this.name(them, target)} caiu, ${w} abates e uma torre. ${pct}`);
        } else {
          const [w, l] = this.fight(them, [2, 4], [0, 1]);
          this.log(them, `❌ O dive deu errado: o inimigo segurou e puniu (${w}x${l}). ${pct}`);
        }
        break;
      }
      case "siege": {
        if (success) {
          const t = this.destroyTowers(us, 2);
          this.log(us, `✅ Cerco bem-sucedido: o poke afastou o inimigo e caíram ${this.towersText(t)}. ${pct}`);
        } else {
          const [w, l] = this.fight(them, [2, 3], [0, 1]);
          this.log(them, `❌ O inimigo engajou no meio do cerco (${w}x${l}). ${pct}`);
        }
        break;
      }
      case "split": {
        const top = this.name(us, "top");
        if (success) {
          const t = this.destroyTowers(us, this.rng.chance(0.5) ? 2 : 1);
          this.log(us, `✅ ${top} dominou a rota lateral e derrubou ${this.towersText(t)}. ${pct}`);
        } else {
          this.kill(them, 1);
          this.destroyTowers(them, 1);
          this.log(them, `❌ ${top} foi pego sozinho, e o inimigo usou a vantagem para pegar uma torre. ${pct}`);
        }
        break;
      }
      case "farm": {
        if (success) {
          this.addGold(us, 900);
          this.log(us, `✅ Seu time farmou com segurança e escalou (+900 de ouro). ${pct}`);
        } else {
          this.destroyTowers(them, 1);
          this.log(them, `❌ Enquanto vocês farmavam, o inimigo pegou uma torre de graça. ${pct}`);
        }
        break;
      }
      case "invade": {
        const winner = success ? us : them;
        const [w, l] = this.fight(winner, [1, 2], [0, 1]);
        this.addGold(winner, 500);
        this.state.jungleScore += success ? 1 : -1;
        this.log(winner, success
          ? `✅ Invasão certeira: ${this.name(us, "jungle")} roubou os campos (${w}x${l}). ${pct}`
          : `❌ A invasão foi pega no flanco (${w}x${l}). ${pct}`);
        break;
      }
    }
  }
}

// ------------------------------------------------------------ Utilitários

/** Escolhe a opção com melhor valor esperado (usado nos testes de balanceamento). */
export function autoChoose(prompt: DecisionPrompt): ActionId {
  return prompt.options.reduce((a, b) => (b.chance * AUTO_VALUE[b.id] > a.chance * AUTO_VALUE[a.id] ? b : a)).id;
}

export function playToEnd(match: Match, choose: (p: DecisionPrompt) => ActionId = autoChoose): Match {
  while (!match.state.winner) {
    if (match.state.pending) match.decide(choose(match.state.pending));
    else match.advance();
  }
  return match;
}

/** Recria a partida a partir dos picks e decisões (validação no servidor). */
export function replayMatch(daily: DailyChallenge, picks: Team, decisions: ActionId[]): Match {
  const match = new Match(picks, daily.enemy, matchSeed(daily.date, picks));
  let i = 0;
  playToEnd(match, () => {
    const id = decisions[i++];
    if (!id) throw new Error("Decisões insuficientes");
    return id;
  });
  if (i !== decisions.length) throw new Error("Decisões a mais do que o esperado");
  return match;
}

export function buildShareText(date: string, s: MatchSummary): string {
  const square: Record<LaneOutcome, string> = { win: "🟦", loss: "🟥", even: "⬜" };
  return [
    `Daily League — ${date}`,
    `${s.won ? "🏆 Vitória" : "💀 Derrota"} aos ${s.minute} min`,
    `Rotas: ${LANES.map((l) => square[s.lanes[l]]).join("")}`,
    `Decisões: ${s.decisions.map((d) => (d.success ? "✅" : "❌")).join("") || "—"}`,
    `Abates: ${s.kills} x ${s.deaths} · Torres: ${s.towers}/${TOWERS_TO_WIN}`,
  ].join("\n");
}
