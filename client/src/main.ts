import "./style.css";
import { Match, matchSeed } from "../../shared/engine";
import type { DailyChallenge, Team } from "../../shared/types";
import { fetchDaily, fetchLeaderboard, submitResult } from "./api";
import { connect, type Session } from "./discord";
import { mount } from "./dom";
import { draftView, matchView, messageView, resultView } from "./views";

const root = document.getElementById("app")!;

class App {
  /** Só a primeira partida do dia vai para o ranking; as outras são treino. */
  private alreadyPlayed = false;

  constructor(private session: Session, private daily: DailyChallenge) {}

  async init() {
    if (this.session.mode === "discord") {
      const board = await fetchLeaderboard(this.session);
      this.alreadyPlayed = board.some((e) => e.userId === this.session.user.id);
    }
    this.showDraft();
  }

  private banner(): string | null {
    if (this.session.mode === "local") return "Modo local: fora do Discord, o resultado não vai para o ranking.";
    if (this.alreadyPlayed) return "Você já jogou hoje. Novas partidas são só treino.";
    return null;
  }

  private showDraft() {
    mount(root, draftView(this.daily, this.banner(), (team) => this.play(team)));
  }

  private play(team: Team) {
    const match = new Match(team, this.daily.enemy, matchSeed(this.daily.date, team));
    mount(root, matchView(match, () => this.finish(match, team)));
  }

  private async finish(match: Match, team: Team) {
    const summary = match.summary();
    let status = "Partida de treino.";

    if (this.session.mode === "discord" && !this.alreadyPlayed) {
      try {
        const decisions = match.state.decisions.map((d) => d.id);
        const { counted } = await submitResult(this.session, team, decisions);
        status = counted ? "Resultado registrado no ranking do servidor." : "Você já tinha jogado hoje — partida de treino.";
      } catch (err) {
        console.error(err);
        status = "Não foi possível registrar o resultado.";
      }
      this.alreadyPlayed = true;
    } else if (this.session.mode === "local") {
      status = "Modo local — resultado não registrado.";
    }

    mount(root, resultView({
      date: this.daily.date,
      summary,
      picks: team,
      status,
      leaderboard: this.session.mode === "discord" ? fetchLeaderboard(this.session) : null,
      onReplay: () => this.showDraft(),
    }));
  }
}

async function start() {
  mount(root, messageView("Conectando…"));
  try {
    const session = await connect();
    mount(root, messageView("Carregando o desafio do dia…"));
    const daily = await fetchDaily();
    await new App(session, daily).init();
  } catch (err) {
    console.error(err);
    mount(root, messageView("Algo deu errado", String(err)));
  }
}

start();
