/**
 * Coleta partidas ranqueadas (Solo/Duo) pela API da Riot e salva um resumo de cada uma
 * em data/riot/matches.jsonl. Pode ser interrompido (Ctrl+C) e retomado a qualquer momento.
 *
 *   npm run riot:collect                          -> 500 partidas novas
 *   npm run riot:collect -- --matches 3000
 *   npm run riot:collect -- --tiers EMERALD,DIAMOND,MASTER --days 21
 *   npm run riot:collect -- --no-timeline         -> 2x mais rápido, mas sem ouro aos 14 min
 *
 * Fluxo: jogadores do ranked (league-v4) -> ids das partidas recentes de cada um (match-v5)
 * -> detalhes + timeline de cada partida. Os participantes das partidas viram novos
 * jogadores na fila, então a coleta continua no mesmo elo.
 */
import { existsSync, readFileSync } from "node:fs";
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import {
  MATCHES_FILE, POSITION_TO_LANE, RAW_DIR, RiotClient, RiotKeyError, STATE_FILE, type MatchRecord,
} from "./common";

// ------------------------------------------------------------------ Argumentos

const args = process.argv.slice(2);
const arg = (name: string, fallback: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const TARGET = Number(arg("matches", "500"));
const DAYS = Number(arg("days", "14"));
const TIERS = arg("tiers", "EMERALD,DIAMOND").split(",").map((t) => t.trim().toUpperCase());
const WITH_TIMELINE = !args.includes("--no-timeline");
const MAX_PLAYERS = 5000;
const SOLO_QUEUE = 420;
const MIN_DURATION_S = 15 * 60;

// ------------------------------------------------------------------ Tipos da API

interface LeagueEntry { puuid?: string; summonerId?: string }
interface ParticipantDto {
  puuid: string;
  participantId: number;
  teamId: number; // 100 = azul, 200 = vermelho
  teamPosition: string;
  championName: string;
  win: boolean;
  gameEndedInEarlySurrender?: boolean;
}
interface MatchDto {
  metadata: { matchId: string };
  info: { gameVersion: string; gameDuration: number; queueId: number; participants: ParticipantDto[] };
}
interface TimelineDto {
  info: { frames: { participantFrames: Record<string, { totalGold: number }> }[] };
}

// ------------------------------------------------------------------ Estado

interface State {
  players: string[]; // puuids ("sid:..." = summonerId ainda não convertido)
  playerIndex: number;
  pending: string[]; // ids de partidas a buscar
  skipped: string[]; // partidas descartadas (remake, posições incompletas...)
}

function loadState(): State {
  if (existsSync(STATE_FILE)) return JSON.parse(readFileSync(STATE_FILE, "utf8")) as State;
  return { players: [], playerIndex: 0, pending: [], skipped: [] };
}

function loadCollectedIds(): Set<string> {
  if (!existsSync(MATCHES_FILE)) return new Set();
  const ids = readFileSync(MATCHES_FILE, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => (JSON.parse(line) as MatchRecord).id);
  return new Set(ids);
}

// ------------------------------------------------------------------ Coleta

let riot: RiotClient;
try {
  riot = new RiotClient();
} catch (err) {
  console.error((err as Error).message);
  process.exit(1);
}
const state = loadState();
const collected = loadCollectedIds();
const known = new Set([...collected, ...state.skipped, ...state.pending]);
const knownPlayers = new Set(state.players);

function addPlayers(ids: string[]) {
  for (const id of ids) {
    if (state.players.length >= MAX_PLAYERS) return;
    if (!knownPlayers.has(id)) {
      knownPlayers.add(id);
      state.players.push(id);
    }
  }
}

async function seedPlayers() {
  console.log(`Buscando jogadores de ${TIERS.join(", ")} em ${riot.platform}...`);
  const found: string[] = [];
  for (const tier of TIERS) {
    if (["MASTER", "GRANDMASTER", "CHALLENGER"].includes(tier)) {
      const league = await riot.platformGet<{ entries: LeagueEntry[] }>(
        `/lol/league/v4/${tier.toLowerCase()}leagues/by-queue/RANKED_SOLO_5x5`,
      );
      found.push(...(league?.entries ?? []).map(entryId));
      continue;
    }
    for (const division of ["I", "II", "III", "IV"]) {
      const entries = await riot.platformGet<LeagueEntry[]>(
        `/lol/league/v4/entries/RANKED_SOLO_5x5/${tier}/${division}?page=1`,
      );
      found.push(...(entries ?? []).map(entryId));
    }
  }
  // Embaralha para não coletar só os primeiros de cada divisão.
  addPlayers(found.filter(Boolean).sort(() => Math.random() - 0.5));
  console.log(`${state.players.length} jogadores na fila.`);
}

function entryId(e: LeagueEntry): string {
  return e.puuid ?? (e.summonerId ? `sid:${e.summonerId}` : "");
}

async function resolvePuuid(id: string): Promise<string | null> {
  if (!id.startsWith("sid:")) return id;
  const summoner = await riot.platformGet<{ puuid: string }>(`/lol/summoner/v4/summoners/${id.slice(4)}`);
  return summoner?.puuid ?? null;
}

async function queueMatchesOfNextPlayer(): Promise<boolean> {
  if (state.playerIndex >= state.players.length) return false;
  const puuid = await resolvePuuid(state.players[state.playerIndex++]);
  if (!puuid) return true;
  const startTime = Math.floor(Date.now() / 1000) - DAYS * 86_400;
  const ids = await riot.regionGet<string[]>(
    `/lol/match/v5/matches/by-puuid/${puuid}/ids?queue=${SOLO_QUEUE}&type=ranked&startTime=${startTime}&count=20`,
  );
  for (const id of ids ?? []) {
    if (!known.has(id)) {
      known.add(id);
      state.pending.push(id);
    }
  }
  return true;
}

function toRecord(match: MatchDto): MatchRecord | null {
  const { info } = match;
  if (info.queueId !== SOLO_QUEUE || info.gameDuration < MIN_DURATION_S) return null;
  if (info.participants.some((p) => p.gameEndedInEarlySurrender)) return null;

  const lanes: MatchRecord["lanes"] = {};
  for (const [position, lane] of Object.entries(POSITION_TO_LANE)) {
    const blue = info.participants.find((p) => p.teamId === 100 && p.teamPosition === position);
    const red = info.participants.find((p) => p.teamId === 200 && p.teamPosition === position);
    if (!blue || !red) return null; // posição indefinida: não dá para saber quem enfrentou quem
    lanes[lane] = { blue: blue.championName, red: red.championName };
  }
  const [major, minor] = info.gameVersion.split(".");
  const blueWin = info.participants.find((p) => p.teamId === 100)!.win;
  return { id: match.metadata.matchId, patch: `${major}.${minor}`, blueWin, lanes };
}

function addGoldAt14(record: MatchRecord, match: MatchDto, timeline: TimelineDto) {
  const frame = timeline.info.frames[14];
  if (!frame) return;
  for (const [position, lane] of Object.entries(POSITION_TO_LANE)) {
    const gold = (teamId: number) => {
      const p = match.info.participants.find((x) => x.teamId === teamId && x.teamPosition === position)!;
      return frame.participantFrames[String(p.participantId)]?.totalGold ?? 0;
    };
    record.lanes[lane]!.gold14 = gold(100) - gold(200);
  }
}

async function fetchMatch(id: string): Promise<boolean> {
  const match = await riot.regionGet<MatchDto>(`/lol/match/v5/matches/${id}`);
  const record = match ? toRecord(match) : null;
  if (!match || !record) {
    state.skipped.push(id);
    return false;
  }
  if (WITH_TIMELINE) {
    const timeline = await riot.regionGet<TimelineDto>(`/lol/match/v5/matches/${id}/timeline`);
    if (timeline) addGoldAt14(record, match, timeline);
  }
  await appendFile(MATCHES_FILE, JSON.stringify(record) + "\n");
  collected.add(id);
  addPlayers(match.info.participants.map((p) => p.puuid));
  return true;
}

async function saveState() {
  await writeFile(STATE_FILE, JSON.stringify(state));
}

async function main() {
  await mkdir(RAW_DIR, { recursive: true });
  if (state.players.length === 0) await seedPlayers();

  const started = Date.now();
  let newMatches = 0;
  let iterations = 0;
  console.log(`Coletando ${TARGET} partidas (${WITH_TIMELINE ? "com" : "sem"} timeline). Já existem ${collected.size}.`);

  while (newMatches < TARGET) {
    if (state.pending.length === 0) {
      const more = await queueMatchesOfNextPlayer();
      if (!more) {
        console.log("Acabaram os jogadores da fila.");
        break;
      }
      continue;
    }
    if (await fetchMatch(state.pending.shift()!)) newMatches++;

    if (++iterations % 10 === 0) {
      await saveState();
      const perMatch = (Date.now() - started) / Math.max(newMatches, 1);
      const eta = Math.round(((TARGET - newMatches) * perMatch) / 60_000);
      console.log(`  ${newMatches}/${TARGET} novas · total ${collected.size} · ${riot.requests} req · ~${eta} min restantes`);
    }
  }

  await saveState();
  console.log(`Pronto: ${newMatches} partidas novas (total ${collected.size}). Rode "npm run riot:build" para gerar os matchups.`);
}

process.on("SIGINT", async () => {
  await saveState();
  console.log("\nInterrompido — progresso salvo. Rode de novo para continuar.");
  process.exit(0);
});

main().catch(async (err) => {
  await saveState();
  console.error(err instanceof RiotKeyError ? `\n${err.message}` : err);
  process.exit(1);
});
