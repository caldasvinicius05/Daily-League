import "dotenv/config";
import express, { type Request } from "express";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { generateDaily, todayKey } from "../shared/daily";
import { replayMatch, type ActionId } from "../shared/engine";
import { LANES, type DailyChallenge, type Team } from "../shared/types";
import { ResultStore } from "./store";

const PORT = Number(process.env.PORT ?? 3001);
const { CLIENT_ID, CLIENT_SECRET } = process.env;
if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error("Faltam CLIENT_ID e/ou CLIENT_SECRET no .env");
  process.exit(1);
}

const app = express();
app.use(express.json());

const store = new ResultStore(new URL("../data/results.json", import.meta.url));
const dailyCache = new Map<string, DailyChallenge>();

function getDaily(date: string): DailyChallenge {
  let daily = dailyCache.get(date);
  if (!daily) {
    daily = generateDaily(date);
    dailyCache.set(date, daily);
  }
  return daily;
}

/** Descobre o usuário do Discord a partir do access_token enviado pelo cliente. */
async function identify(req: Request): Promise<{ id: string; username: string } | null> {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) return null;
  const res = await fetch("https://discord.com/api/users/@me", { headers: { Authorization: auth } });
  if (!res.ok) return null;
  const user = (await res.json()) as { id: string; username: string; global_name?: string | null };
  return { id: user.id, username: user.global_name ?? user.username };
}

// Troca o "code" do OAuth2 por um access_token (o secret nunca sai do servidor).
app.post("/api/token", async (req, res) => {
  const code = req.body?.code;
  if (typeof code !== "string") {
    res.status(400).json({ error: "code ausente" });
    return;
  }
  const response = await fetch("https://discord.com/api/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      grant_type: "authorization_code",
      code,
    }),
  });
  const data = (await response.json()) as { access_token?: string };
  if (!response.ok || !data.access_token) {
    console.error("Falha no OAuth:", data);
    res.status(502).json({ error: "Falha ao autenticar com o Discord" });
    return;
  }
  res.json({ access_token: data.access_token });
});

app.get("/api/daily", (_req, res) => {
  res.json(getDaily(todayKey()));
});

// O cliente envia picks + decisões; o servidor refaz a partida para validar o resultado.
app.post("/api/result", async (req, res) => {
  const user = await identify(req);
  if (!user) {
    res.status(401).json({ error: "Não autenticado" });
    return;
  }
  const { guildId, picks, decisions } = req.body ?? {};
  const daily = getDaily(todayKey());

  const validPicks = picks && LANES.every((l) => daily.options[l].includes((picks as Team)[l]));
  if (!validPicks || !Array.isArray(decisions)) {
    res.status(400).json({ error: "Picks ou decisões inválidos" });
    return;
  }

  let summary;
  try {
    summary = replayMatch(daily, picks as Team, decisions as ActionId[]).summary();
  } catch (err) {
    res.status(400).json({ error: String(err) });
    return;
  }

  const counted = store.add(daily.date, String(guildId ?? "dm"), {
    ...summary,
    userId: user.id,
    username: user.username,
    picks: picks as Team,
    submittedAt: new Date().toISOString(),
  });
  res.json({ counted, summary });
});

app.get("/api/leaderboard", (req, res) => {
  const guildId = String(req.query.guildId ?? "dm");
  res.json(store.leaderboard(todayKey(), guildId));
});

// Em produção, o mesmo servidor entrega o frontend compilado (npm run build).
const dist = fileURLToPath(new URL("../dist", import.meta.url));
if (existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(join(dist, "index.html")));
}

app.listen(PORT, () => {
  console.log(`[server] http://localhost:${PORT} — desafio de hoje: ${todayKey()}`);
});
