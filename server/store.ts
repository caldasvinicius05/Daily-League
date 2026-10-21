import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { MatchSummary } from "../shared/engine";
import type { Team } from "../shared/types";

export interface ResultEntry extends MatchSummary {
  userId: string;
  username: string;
  picks: Team;
  submittedAt: string;
}

type Data = Record<string, Record<string, ResultEntry[]>>; // data -> servidor -> resultados

/** Armazenamento simples em JSON — suficiente para um grupo de amigos. */
export class ResultStore {
  private readonly file: string;
  private data: Data;

  constructor(url: URL) {
    this.file = fileURLToPath(url);
    this.data = existsSync(this.file) ? (JSON.parse(readFileSync(this.file, "utf8")) as Data) : {};
  }

  has(date: string, guildId: string, userId: string): boolean {
    return Boolean(this.data[date]?.[guildId]?.some((e) => e.userId === userId));
  }

  /** Só a primeira partida do dia conta. Retorna false se o usuário já tinha jogado. */
  add(date: string, guildId: string, entry: ResultEntry): boolean {
    if (this.has(date, guildId, entry.userId)) return false;
    ((this.data[date] ??= {})[guildId] ??= []).push(entry);
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(this.file, JSON.stringify(this.data, null, 2));
    return true;
  }

  leaderboard(date: string, guildId: string): ResultEntry[] {
    return [...(this.data[date]?.[guildId] ?? [])].sort((a, b) =>
      Number(b.won) - Number(a.won)
      || (a.won ? a.minute - b.minute : b.minute - a.minute) // vitória rápida / derrota longa
      || (b.kills - b.deaths) - (a.kills - a.deaths));
  }
}
