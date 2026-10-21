import type { ActionId, MatchSummary } from "../../shared/engine";
import type { DailyChallenge, Team } from "../../shared/types";
import type { Session } from "./discord";

export interface LeaderboardEntry extends MatchSummary {
  userId: string;
  username: string;
}

export async function fetchDaily(): Promise<DailyChallenge> {
  const res = await fetch("/api/daily");
  if (!res.ok) throw new Error("Não foi possível carregar o desafio do dia");
  return res.json();
}

export async function submitResult(session: Session, picks: Team, decisions: ActionId[]) {
  const res = await fetch("/api/result", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.accessToken}` },
    body: JSON.stringify({ guildId: session.guildId, picks, decisions }),
  });
  if (!res.ok) throw new Error("Falha ao enviar o resultado");
  return (await res.json()) as { counted: boolean };
}

export async function fetchLeaderboard(session: Session): Promise<LeaderboardEntry[]> {
  const res = await fetch(`/api/leaderboard?guildId=${encodeURIComponent(session.guildId ?? "dm")}`);
  if (!res.ok) return [];
  return res.json();
}
