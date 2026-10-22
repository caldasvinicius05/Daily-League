/**
 * Motor de simulação da partida.
 *
 * Tudo é determinístico: a seed vem da data + picks, e cada decisão consome o RNG
 * na mesma ordem. Mesmo time + mesmas decisões => mesma partida (o servidor usa isso
 * para revalidar o resultado enviado pelo cliente).
 *
 * O relógio anda em ticks de 30 s (advance()). A cada TICKS_PER_TURN ticks (2 min)
 * roda um turno: turnos 1–5 são a fase de rotas; depois vêm lutas, objetivos e torres.
 * Nos DECISION_TURNS o jogador escolhe a jogada.
 *
 * Cada campeão tem estado próprio (vivo/morto, região do mapa, abates, ouro), cada
 * time tem suas 11 torres, e cada evento registra onde aconteceu e quem participou.
 */
import { getChampion } from "./champions";
import {
  baseZone, jungleZone, LANE_ROUTE, TOWERS,
  type Route, type TowerDef, type Zone,
} from "./map";
import { laneEdge } from "./matchups";
import { champName } from "./meta";
import { Rng } from "./rng";
import {
  ATTRIBUTE_KEYS, LANES, LANE_LABEL,
  type Attributes, type ChampionDef, type DailyChallenge, type Lane, type Side, type Team,
} from "./types";

export type { Side } from "./types";
export type ActionId = "teamfight" | "dragon" | "baron" | "dive" | "siege" | "split" | "farm" | "invade";
export type LaneOutcome = "win" | "loss" | "even";

export const TICK_SECONDS = 30;
export const TICKS_PER_TURN = 4;
export const TURN_SECONDS = TICK_SECONDS * TICKS_PER_TURN; // 2 min
export const MAX_TURNS = 22;
export const TOWERS_TO_WIN = TOWERS.length; // 11: as 9 de rota + as 2 do Nexus
export const DECISION_TURNS = [4, 8, 12, 16, 20];
const LANE_PHASE_END = 5;
const FIRST_DRAGON_TURN = 3;
const DRAGON_RESPAWN = 3;
const FIRST_BARON_TURN = 10;
const BARON_RESPAWN = 3;
const BARON_DURATION = 2;
const PASSIVE_GOLD = 1900;
const STARTING_GOLD = 500;
const KILL_GOLD = 300;
const TOWER_GOLD = 600;

export type EventKind =
  | "lane-kill" | "gank" | "gank-fail" | "gank-escape"
  | "skirmish" | "pick" | "tower" | "teamfight"
  | "dragon-spawn" | "dragon" | "baron-spawn" | "baron"
  | "decision" | "action" | "phase" | "end";

export interface ChampionRef {
  side: Side;
  lane: Lane;
}

export interface MatchEvent {
  time: number; // segundos de jogo
  minute: number;
  side: Side | "neutral";
  kind: EventKind;
  zone: Zone | null;
  allies: Lane[]; // campeões aliados envolvidos (pela posição)
  enemies: Lane[]; // campeões inimigos envolvidos
  victims: ChampionRef[];
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

export interface ChampionState {
  id: string;
  side: Side;
  lane: Lane;
  zone: Zone;
  alive: boolean;
  respawnAt: number; // segundo de jogo em que volta (se morto)
  kills: number;
  deaths: number;
  assists: number;
  gold: number;
}

export interface SideState {
  gold: number; // soma do ouro dos 5 campeões
  kills: number;
  towers: number; // torres inimigas destruídas por este lado
  dragons: number;
  barons: number;
  baronTurns: number; // turnos restantes do buff do Barão
}

type BigLane = Route;

export interface MatchState {
  tick: number;
  time: number; // segundos de jogo
  turn: number;
  minute: number;
  ally: SideState;
  enemy: SideState;
  champions: Record<Side, Record<Lane, ChampionState>>;
  towersStanding: Record<Side, string[]>; // ids das torres de pé, por dono
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

/** Tempo de jogo como "mm:ss". */
export function formatClock(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** Tempo de morte: ~10 s no início, chegando a 60 s no fim de jogo. */
function respawnSeconds(minute: number): number {
  return Math.round(clamp(6 + minute * 1.5, 8, 60));
}

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
const unique = <T>(items: T[]) => [...new Set(items)];

/** Probabilidade de A vencer B; "sharpness" maior = vantagens pesam mais. */
export function winChance(a: number, b: number, sharpness = 4): number {
  const x = Math.pow(Math.max(a, 0.01), sharpness);
  const y = Math.pow(Math.max(b, 0.01), sharpness);
  return clamp(x / (x + y), 0.05, 0.95);
}

export function matchSeed(date: string, team: Team): string {
  return `${date}|${LANES.map((l) => team[l]).join(",")}`;
}

/** Evento em construção: onde é e quem está lá. As mortes entram conforme acontecem. */
interface EventDraft {
  zone: Zone | null;
  allies: Lane[];
  enemies: Lane[];
  victims: ChampionRef[];
}

interface KillOptions {
  victim?: Lane; // vítima preferida (se estiver viva)
  killer?: Lane; // quem leva o abate
}

export class Match {
  readonly state: MatchState;
  private readonly rng: Rng;
  private readonly profiles: Record<Side, Profile>;
  /** Vantagem do aliado em cada confronto de rota (dados reais + atributos). */
  private readonly laneEdges: Record<Lane, number>;
  private draft: EventDraft | null = null;

  constructor(readonly allyTeam: Team, readonly enemyTeam: Team, seedKey: string) {
    this.rng = new Rng(seedKey);
    this.profiles = { ally: buildProfile(allyTeam), enemy: buildProfile(enemyTeam) };
    this.laneEdges = Object.fromEntries(
      LANES.map((l) => [l, laneEdge(l, allyTeam[l], enemyTeam[l])]),
    ) as Record<Lane, number>;

    const sideState = (): SideState => ({
      gold: STARTING_GOLD * LANES.length, kills: 0, towers: 0, dragons: 0, barons: 0, baronTurns: 0,
    });
    const champions = (side: Side, team: Team) => Object.fromEntries(LANES.map((lane) => [lane, {
      id: team[lane], side, lane, zone: baseZone(side), alive: true, respawnAt: 0,
      kills: 0, deaths: 0, assists: 0, gold: STARTING_GOLD,
    }])) as Record<Lane, ChampionState>;

    this.state = {
      tick: 0,
      time: 0,
      turn: 0,
      minute: 0,
      ally: sideState(),
      enemy: sideState(),
      champions: { ally: champions("ally", allyTeam), enemy: champions("enemy", enemyTeam) },
      towersStanding: { ally: TOWERS.map((t) => t.id), enemy: TOWERS.map((t) => t.id) },
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

  /**
   * Avança 30 s de jogo. A cada 2 min roda um turno; em turnos de decisão,
   * preenche state.pending e espera decide().
   */
  advance(): MatchEvent[] {
    const s = this.state;
    if (s.winner || s.pending) return [];
    const before = s.events.length;

    s.tick++;
    s.time = s.tick * TICK_SECONDS;
    s.minute = Math.floor(s.time / 60);
    this.updateChampions();
    if (s.tick % TICKS_PER_TURN === 0) this.runTurn();
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

  // -------------------------------------------------------------- Relógio

  private runTurn() {
    const s = this.state;
    s.turn++;
    this.addGold("ally", PASSIVE_GOLD);
    this.addGold("enemy", PASSIVE_GOLD);
    this.spawnObjectives();

    if (DECISION_TURNS.includes(s.turn)) {
      s.pending = this.buildPrompt();
    } else {
      if (s.turn <= LANE_PHASE_END) this.laneTurn();
      else this.midTurn();
      this.endTurn();
    }
  }

  /** Renascimentos e posição padrão de cada campeão neste tick. */
  private updateChampions() {
    const s = this.state;
    for (const side of ["ally", "enemy"] as Side[]) {
      for (const lane of LANES) {
        const c = s.champions[side][lane];
        if (!c.alive && s.time >= c.respawnAt) c.alive = true;
        c.zone = c.alive ? this.defaultZone(side, lane) : baseZone(side);
      }
    }
  }

  private defaultZone(side: Side, lane: Lane): Zone {
    const s = this.state;
    // O caçador alterna entre os dois lados da própria selva.
    if (lane === "jungle") return jungleZone(side, s.tick % 2 === 0 ? "top" : "bot");
    if (s.time <= LANE_PHASE_END * TURN_SECONDS) return LANE_ROUTE[lane]!;
    // Depois da fase de rotas: o topo segura a rota lateral, o resto se agrupa
    // perto do objetivo vivo (ou no meio).
    if (lane === "top") return "top";
    if (s.dragonUp) return "river-bot";
    if (s.baronUp) return "river-top";
    return "mid";
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

  // ------------------------------------------------------------- Eventos

  private champ(side: Side, lane: Lane): ChampionState {
    return this.state.champions[side][lane];
  }

  private isAlive(side: Side, lane: Lane): boolean {
    return this.champ(side, lane).alive;
  }

  /** Abre um evento: só participa quem está vivo, e os participantes vão para o local. */
  private event(zone: Zone | null, allies: Lane[], enemies: Lane[]) {
    const draft: EventDraft = {
      zone,
      allies: unique(allies).filter((l) => this.isAlive("ally", l)),
      enemies: unique(enemies).filter((l) => this.isAlive("enemy", l)),
      victims: [],
    };
    if (zone) {
      for (const l of draft.allies) this.champ("ally", l).zone = zone;
      for (const l of draft.enemies) this.champ("enemy", l).zone = zone;
    }
    this.draft = draft;
  }

  private participants(draft: EventDraft, side: Side): Lane[] {
    return side === "ally" ? draft.allies : draft.enemies;
  }

  /** Registra o evento (fechando o rascunho aberto, se houver). */
  private log(side: Side | "neutral", kind: EventKind, text: string) {
    const d = this.draft;
    this.state.events.push({
      time: this.state.time,
      minute: this.state.minute,
      side,
      kind,
      zone: d?.zone ?? null,
      allies: d ? [...d.allies] : [],
      enemies: d ? [...d.enemies] : [],
      victims: d ? [...d.victims] : [],
      text,
    });
    this.draft = null;
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

  private pickWeighted<T>(items: T[], weight: (item: T) => number): T {
    if (items.length === 1) return items[0];
    const total = items.reduce((sum, item) => sum + weight(item), 0);
    let roll = this.rng.next() * total;
    for (const item of items) {
      roll -= weight(item);
      if (roll < 0) return item;
    }
    return items[items.length - 1];
  }

  /** Ouro do time, dividido entre quem recebeu (por padrão, os 5). */
  private addGold(side: Side, amount: number, recipients: Lane[] = LANES) {
    const value = Math.round(amount);
    this.state[side].gold += value;
    for (const l of recipients) this.champ(side, l).gold += value / recipients.length;
  }

  /**
   * `side` abate até `n` campeões inimigos. Com um evento aberto, só morre quem está
   * nele (os mais frágeis morrem mais; quem tem mais dano mata mais); sem evento,
   * qualquer inimigo vivo pode morrer.
   */
  private kill(side: Side, n: number, opts: KillOptions = {}): { killer: Lane; victim: Lane }[] {
    const foe = other(side);
    const d = this.draft;
    const killers = d && this.participants(d, side).length ? this.participants(d, side) : LANES;
    const victimPool = d ? this.participants(d, foe) : LANES;
    const done: { killer: Lane; victim: Lane }[] = [];

    for (let i = 0; i < n; i++) {
      const aliveIn = (pool: Lane[]) => pool.filter((l) => this.isAlive(foe, l));
      const options = i === 0 && opts.victim && aliveIn(victimPool).includes(opts.victim)
        ? [opts.victim]
        : aliveIn(victimPool);
      if (!options.length) break;

      const victim = this.pickWeighted(options, (l) => 7 - this.profiles[foe].champs[l].attrs.tank);
      const killer = opts.killer ?? this.pickWeighted(killers, (l) => {
        const a = this.profiles[side].champs[l].attrs;
        return a.burst + a.dps;
      });

      const v = this.champ(foe, victim);
      v.alive = false;
      v.deaths++;
      v.respawnAt = this.state.time + respawnSeconds(this.state.minute);
      v.zone = baseZone(foe);
      this.champ(side, killer).kills++;
      for (const l of killers) if (l !== killer) this.champ(side, l).assists++;
      this.state[side].kills++;
      this.addGold(side, KILL_GOLD, [killer]);
      d?.victims.push({ side: foe, lane: victim });
      done.push({ killer, victim });
    }
    return done;
  }

  /** Próxima torre a cair do time `owner` (na rota pedida ou na rota mais avançada). */
  private nextTower(owner: Side, route?: Route): TowerDef | undefined {
    const standing = this.state.towersStanding[owner];
    const laneTowers = TOWERS.filter((t) => t.route !== "base" && standing.includes(t.id));
    const inRoute = route && laneTowers.find((t) => t.route === route);
    if (inRoute) return inRoute;
    if (laneTowers.length) {
      const remaining = (r: TowerDef["route"]) => laneTowers.filter((t) => t.route === r).length;
      return [...laneTowers].sort((a, b) => remaining(a.route) - remaining(b.route))[0];
    }
    return TOWERS.find((t) => standing.includes(t.id));
  }

  private destroyTowers(side: Side, n: number, route?: Route): number {
    const owner = other(side);
    let taken = 0;
    for (let i = 0; i < n; i++) {
      const tower = this.nextTower(owner, route);
      if (!tower) break;
      this.state.towersStanding[owner] = this.state.towersStanding[owner].filter((id) => id !== tower.id);
      taken++;
    }
    this.state[side].towers += taken;
    this.addGold(side, TOWER_GOLD * taken);
    return taken;
  }

  /** Luta genérica: retorna [abates do vencedor, abates do perdedor]. */
  private fight(winner: Side, win: [number, number], lose: [number, number]): [number, number] {
    const w = this.rng.int(...win);
    const l = this.rng.int(...lose);
    const wk = this.kill(winner, w).length;
    const lk = this.kill(other(winner), l).length;
    return [wk, lk];
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
      this.event("dragon", [], []);
      this.log("neutral", "dragon-spawn", "🐉 Um Dragão apareceu no rio.");
    }
    if (!s.baronUp && s.turn >= s.nextBaronTurn) {
      s.baronUp = true;
      this.event("baron", [], []);
      this.log("neutral", "baron-spawn", "👾 O Barão Na'Shor está disponível.");
    }
  }

  private giveDragon(side: Side) {
    const s = this.state;
    if (!this.draft) this.event("dragon", side === "ally" ? LANES : [], side === "enemy" ? LANES : []);
    s[side].dragons++;
    this.addGold(side, 200);
    s.dragonUp = false;
    s.nextDragonTurn = s.turn + DRAGON_RESPAWN;
    const n = s[side].dragons;
    this.log(side, "dragon", n >= 4
      ? `🐉 ${TEAM_NAME[side]} conquistou a ALMA DO DRAGÃO!`
      : `🐉 ${TEAM_NAME[side]} garantiu o Dragão (${n}/4).`);
  }

  private giveBaron(side: Side) {
    const s = this.state;
    if (!this.draft) this.event("baron", side === "ally" ? LANES : [], side === "enemy" ? LANES : []);
    s[side].barons++;
    s[side].baronTurns = BARON_DURATION;
    this.addGold(side, 1500);
    s.baronUp = false;
    s.nextBaronTurn = s.turn + BARON_RESPAWN;
    this.log(side, "baron", `👾 ${TEAM_NAME[side]} abateu o Barão Na'Shor!`);
  }

  private autoDragon() {
    const chance = winChance(
      this.teamPower("ally") * this.objectiveFactor("ally"),
      this.teamPower("enemy") * this.objectiveFactor("enemy"),
      4,
    );
    const winner: Side = this.rng.chance(chance) ? "ally" : "enemy";
    this.event("dragon", LANES, LANES);
    if (this.rng.chance(0.4)) {
      const [w, l] = this.fight(winner, [1, 2], [0, 1]);
      this.log(winner, "skirmish", `Briga no rio pelo Dragão: ${TEAM_NAME[winner].toLowerCase()} levou a melhor (${w}x${l}).`);
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
      this.addGold(gold > 0 ? "ally" : "enemy", Math.abs(gold), lane.members);

      if (Math.abs(diff) > 1.8 && this.rng.chance(0.4)) {
        const winner: Side = diff > 0 ? "ally" : "enemy";
        this.event(lane.key, lane.members, lane.members);
        const [k] = this.kill(winner, 1, { victim: this.rng.pick(lane.members) });
        if (!k) {
          this.draft = null;
          continue;
        }
        this.state.laneLead[lane.key] += winner === "ally" ? KILL_GOLD : -KILL_GOLD;
        this.log(winner, "lane-kill", `⚔️ ${this.name(winner, k.killer)} abateu ${this.name(other(winner), k.victim)} ${lane.label}.`);
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
    if (!this.isAlive(actor, "jungle")) return; // morto não ganka

    const target = this.rng.pick(["top", "mid", "adc"] as const);
    const atkLaner = this.profiles[actor].champs[target].attrs;
    const defLaner = this.profiles[other(actor)].champs[target].attrs;
    const jungler = this.profiles[actor].champs.jungle.attrs;
    const defSupport = target === "adc" ? this.profiles[other(actor)].champs.support.attrs.peel * 0.5 : 0;

    const atk = jungler.early + jungler.engage * 0.4 + atkLaner.cc * 0.8;
    const def = defLaner.mobility * 0.8 + defLaner.peel * 0.4 + defSupport + 2;
    const ganker = this.name(actor, "jungle");
    const laneKey: BigLane = target === "adc" ? "bot" : target;

    const laners: Lane[] = target === "adc" ? ["adc", "support"] : [target];
    const attackers: Lane[] = ["jungle", ...laners];
    this.event(laneKey, actor === "ally" ? attackers : laners, actor === "ally" ? laners : attackers);

    if (this.rng.chance(winChance(atk, def, 2))) {
      const [k] = this.kill(actor, 1, { victim: target, killer: "jungle" });
      if (!k) {
        this.draft = null;
        return;
      }
      this.state.laneLead[laneKey] += actor === "ally" ? KILL_GOLD : -KILL_GOLD;
      this.state.jungleScore += actor === "ally" ? 1 : -1;
      this.log(actor, "gank", `🌿 ${ganker} gankou ${GANK_PLACE[target]} e abateu ${this.name(other(actor), k.victim)}.`);
    } else if (this.rng.chance(0.25)) {
      const [k] = this.kill(other(actor), 1, { victim: "jungle" });
      if (!k) {
        this.draft = null;
        return;
      }
      this.state.jungleScore += actor === "ally" ? -1 : 1;
      this.log(other(actor), "gank-fail", `🌿 Gank falhou: ${this.name(other(actor), k.killer)} virou a luta e abateu ${ganker}.`);
    } else {
      this.log("neutral", "gank-escape", `🌿 ${this.name(other(actor), target)} escapou do gank de ${ganker}.`);
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
      const [lane, label] = labels[key];
      this.event(key, side === "ally" ? [lane] : [], side === "enemy" ? [lane] : []);
      this.destroyTowers(side, 1, key);
      this.log(side, "tower", `🏰 ${this.name(side, lane)} derrubou a primeira torre ${label}.`);
    }
    const won = Object.values(s.laneResults).filter((r) => r === "win").length;
    this.log("neutral", "phase", `Fim da fase de rotas — você venceu ${won} de 5 rotas.`);
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
      // Escaramuça de 3x3 num dos lados do rio.
      const zone: Zone = s.turn % 2 === 0 ? "river-top" : "river-bot";
      this.event(zone, this.rng.shuffle(LANES).slice(0, 3), this.rng.shuffle(LANES).slice(0, 3));
      const [w, l] = this.fight(winner, [1, 3], [0, 1]);
      const t = w - l >= 2 ? this.destroyTowers(winner, 1) : 0;
      this.log(winner, "skirmish", `⚔️ Escaramuça na selva: ${TEAM_NAME[winner].toLowerCase()} venceu (${w}x${l})${t ? " e aproveitou para derrubar uma torre" : ""}.`);
    } else if (roll < 0.55) {
      const A = this.profiles.ally.sum;
      const E = this.profiles.enemy.sum;
      const winner: Side = this.rng.chance(winChance(A.cc + A.burst, E.cc + E.burst, 2)) ? "ally" : "enemy";
      const target = this.rng.pick(LANES);
      const victim = this.champ(other(winner), target);
      this.event(victim.alive ? victim.zone : null, winner === "ally" ? ["jungle"] : [target], winner === "enemy" ? ["jungle"] : [target]);
      const killer = this.isAlive(winner, "jungle") ? "jungle" : undefined;
      const [k] = this.kill(winner, 1, { victim: target, killer });
      if (!k) {
        this.draft = null;
        return;
      }
      this.log(winner, "pick", `🎯 ${this.name(winner, k.killer)} pegou ${this.name(other(winner), k.victim)} desprevenido.`);
    } else {
      const A = this.profiles.ally.sum;
      const E = this.profiles.enemy.sum;
      const chance = winChance(pa * (1 + A.split * 0.01 + A.poke * 0.01), pe * (1 + E.split * 0.01 + E.poke * 0.01), 3);
      const winner: Side = this.rng.chance(chance) ? "ally" : "enemy";
      const target = this.nextTower(other(winner));
      this.event(target ? (target.route === "base" ? baseZone(other(winner)) : target.route) : null, [], []);
      // Vantagem clara de poder vira bola de neve: duas torres de uma vez.
      const dominant = (winner === "ally" ? pa / pe : pe / pa) > 1.15;
      const t = this.destroyTowers(winner, dominant ? 2 : 1);
      if (t) this.log(winner, "tower", `🏰 ${TEAM_NAME[winner]} pressionou as rotas e derrubou ${this.towersText(t)}.`);
      else this.draft = null;
    }
  }

  private endTurn() {
    const s = this.state;
    if (s.turn === LANE_PHASE_END) this.closeLanePhase();

    for (const side of ["ally", "enemy"] as Side[]) {
      if (s[side].baronTurns > 0) {
        s[side].baronTurns--;
        if (this.destroyTowers(side, 1)) this.log(side, "tower", `👾 Com o buff do Barão, ${TEAM_NAME[side].toLowerCase()} derruba mais uma torre.`);
      }
    }

    this.checkWinner();
    if (!s.winner && s.turn >= MAX_TURNS) {
      const winner: Side = this.rng.chance(winChance(this.teamPower("ally"), this.teamPower("enemy"), 4)) ? "ally" : "enemy";
      this.event("mid", LANES, LANES);
      this.log(winner, "teamfight", `⚔️ Luta final pelo Nexus! ${this.star(winner)} decide a partida.`);
      s.winner = winner;
      this.log(winner, "end", winner === "ally" ? "🏆 VITÓRIA!" : "💀 DERROTA.");
    }
  }

  private checkWinner() {
    const s = this.state;
    for (const side of ["ally", "enemy"] as Side[]) {
      if (!s.winner && s[side].towers >= TOWERS_TO_WIN) {
        s.winner = side;
        this.log(side, "end", side === "ally" ? "🏆 O Nexus inimigo caiu. VITÓRIA!" : "💀 Seu Nexus foi destruído. DERROTA.");
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

    this.log("neutral", "decision", `⏸️ Momento decisivo aos ${s.minute} min. ${context}`);
    return { turn: s.turn, minute: s.minute, title: `Momento decisivo — ${s.minute} min`, options };
  }

  private resolveAction(id: ActionId, success: boolean, chance: number) {
    const pct = `(chance estimada: ${Math.round(chance * 100)}%)`;
    const us: Side = "ally";
    const them: Side = "enemy";

    switch (id) {
      case "teamfight": {
        const winner = success ? us : them;
        this.event("mid", LANES, LANES);
        const [w, l] = this.fight(winner, [3, 5], [0, 2]);
        const t = this.destroyTowers(winner, 2);
        this.log(winner, "action", success
          ? `✅ Teamfight vencida! ${this.star(us)} brilhou (${w}x${l}) e o time derrubou ${this.towersText(t)}. ${pct}`
          : `❌ O inimigo venceu a teamfight (${w}x${l}) e derrubou ${this.towersText(t)}. ${pct}`);
        break;
      }
      case "dragon": {
        const winner = success ? us : them;
        this.event("dragon", LANES, LANES);
        const [w, l] = this.fight(winner, [1, 2], [0, 1]);
        this.log(winner, "action", success
          ? `✅ Seu time controlou o rio (${w}x${l}). ${pct}`
          : `❌ O inimigo chegou primeiro ao rio (${w}x${l}). ${pct}`);
        this.giveDragon(winner);
        break;
      }
      case "baron": {
        this.event("baron", LANES, LANES);
        if (success) {
          const [w, l] = this.fight(us, [1, 2], [0, 1]);
          this.log(us, "action", `✅ Barão feito com segurança (${w}x${l}). ${pct}`);
          this.giveBaron(us);
        } else if (this.rng.chance(0.5)) {
          this.fight(them, [2, 4], [0, 1]);
          this.log(them, "action", `❌ ROUBADO! ${this.name(them, "jungle")} roubou o Barão. ${pct}`);
          this.giveBaron(them);
        } else {
          const [w, l] = this.fight(them, [3, 5], [0, 2]);
          this.destroyTowers(them, 1);
          this.log(them, "action", `❌ O inimigo pegou seu time no Barão (${w}x${l}) e avançou. ${pct}`);
        }
        break;
      }
      case "dive": {
        const E = this.profiles.enemy.champs;
        const target = (["top", "mid", "adc"] as Lane[]).reduce((a, b) =>
          E[b].attrs.tank + E[b].attrs.peel < E[a].attrs.tank + E[a].attrs.peel ? b : a);
        const route = LANE_ROUTE[target]!;
        const defenders: Lane[] = target === "adc" ? ["adc", "support", "jungle"] : [target, "jungle"];
        this.event(route, ["jungle", target, target === "mid" ? "support" : "mid"], defenders);
        if (success) {
          const [w] = this.fight(us, [2, 3], [0, 1]);
          this.destroyTowers(us, 1, route);
          this.log(us, "action", `✅ Dive perfeito na rota ${LANE_LABEL[target].toLowerCase()}: ${this.name(them, target)} caiu, ${w} abates e uma torre. ${pct}`);
        } else {
          const [w, l] = this.fight(them, [2, 4], [0, 1]);
          this.log(them, "action", `❌ O dive deu errado: o inimigo segurou e puniu (${w}x${l}). ${pct}`);
        }
        break;
      }
      case "siege": {
        this.event("mid", LANES, LANES);
        if (success) {
          const t = this.destroyTowers(us, 2, "mid");
          this.log(us, "action", `✅ Cerco bem-sucedido: o poke afastou o inimigo e caíram ${this.towersText(t)}. ${pct}`);
        } else {
          const [w, l] = this.fight(them, [2, 3], [0, 1]);
          this.log(them, "action", `❌ O inimigo engajou no meio do cerco (${w}x${l}). ${pct}`);
        }
        break;
      }
      case "split": {
        const top = this.name(us, "top");
        if (success) {
          this.event("top", ["top"], ["top"]);
          const t = this.destroyTowers(us, this.rng.chance(0.5) ? 2 : 1, "top");
          this.log(us, "action", `✅ ${top} dominou a rota lateral e derrubou ${this.towersText(t)}. ${pct}`);
        } else {
          this.event("top", ["top"], ["top", "jungle"]);
          this.kill(them, 1, { victim: "top" });
          this.destroyTowers(them, 1);
          this.log(them, "action", `❌ ${top} foi pego sozinho, e o inimigo usou a vantagem para pegar uma torre. ${pct}`);
        }
        break;
      }
      case "farm": {
        if (success) {
          this.addGold(us, 900);
          this.log(us, "action", `✅ Seu time farmou com segurança e escalou (+900 de ouro). ${pct}`);
        } else {
          this.destroyTowers(them, 1);
          this.log(them, "action", `❌ Enquanto vocês farmavam, o inimigo pegou uma torre de graça. ${pct}`);
        }
        break;
      }
      case "invade": {
        const winner = success ? us : them;
        const invaders: Lane[] = ["jungle", "mid", "support"];
        this.event(jungleZone("enemy", "top"), invaders, invaders);
        const [w, l] = this.fight(winner, [1, 2], [0, 1]);
        this.addGold(winner, 500, ["jungle"]);
        this.state.jungleScore += success ? 1 : -1;
        this.log(winner, "action", success
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
