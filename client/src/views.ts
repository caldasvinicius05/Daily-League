import { getChampion } from "../../shared/champions";
import {
  buildShareText, formatClock, summarizeTeam, TOWERS_TO_WIN,
  type DecisionPrompt, type Match, type MatchEvent, type MatchSummary,
} from "../../shared/engine";
import { getMatchup, laneEdge } from "../../shared/matchups";
import { champName } from "../../shared/meta";
import { LANES, LANE_LABEL, type Attributes, type DailyChallenge, type Lane, type Team } from "../../shared/types";
import type { LeaderboardEntry } from "./api";
import { h } from "./dom";

// ------------------------------------------------------------ Componentes

const TRAIT_LABEL: Partial<Record<keyof Attributes, string>> = {
  early: "Early", late: "Escala", engage: "Engage", cc: "Controle", peel: "Proteção",
  burst: "Burst", dps: "DPS", poke: "Poke", tank: "Tanque", mobility: "Mobilidade", split: "Split",
};

/** Os atributos mais altos do campeão viram "chips" para ajudar na escolha. */
function traits(id: string): string[] {
  const attrs = getChampion(id).attrs;
  return (Object.keys(TRAIT_LABEL) as (keyof Attributes)[])
    .filter((k) => attrs[k] >= 4)
    .sort((a, b) => attrs[b] - attrs[a])
    .slice(0, 3)
    .map((k) => TRAIT_LABEL[k]!);
}

function champIcon(id: string, size = "md") {
  return h("img", { class: `icon icon-${size}`, src: `/champions/${id}.png`, alt: champName(id), draggable: false });
}

function champCard(id: string, opts: { selected?: boolean; enemy?: boolean; onClick?: () => void; extra?: Node } = {}) {
  const dmg = getChampion(id).dmg;
  return h(opts.onClick ? "button" : "div", {
    class: `card ${opts.enemy ? "card-enemy" : ""} ${opts.selected ? "card-selected" : ""}`,
    onClick: opts.onClick,
  },
    champIcon(id),
    h("div", { class: "card-name" }, champName(id)),
    h("div", { class: "chips" },
      h("span", { class: `chip chip-${dmg.toLowerCase()}` }, dmg === "MIX" ? "Misto" : dmg),
      traits(id).map((t) => h("span", { class: "chip" }, t)),
    ),
    opts.extra,
  );
}

/** Como o campeão se sai contra o adversário direto (dados reais quando existem). */
function matchupBadge(lane: Lane, id: string, opponent: string) {
  const edge = laneEdge(lane, id, opponent);
  const data = getMatchup(lane, id, opponent);
  const [cls, label] = edge > 0.6 ? ["good", "Rota favorável"]
    : edge < -0.6 ? ["bad", "Rota difícil"]
    : ["even", "Rota equilibrada"];
  // A vantagem de rota vem do ouro aos 14 min; a vitória na partida é informação extra
  // (ex.: Malphite perde a rota para Aatrox, mas escala e vence metade dos jogos).
  const lines = !data
    ? ["estimado pelos atributos"]
    : [
        ...(data.gold14 !== null ? [`${data.gold14 > 0 ? "+" : ""}${data.gold14} de ouro aos 14'`] : []),
        `${Math.round(data.winrate * 100)}% de vitórias · ${data.games} jogos`,
      ];
  return h("div", { class: `matchup matchup-${cls}` }, h("strong", {}, label), lines.map((l) => h("span", {}, l)));
}

// ------------------------------------------------------------ Draft

const METRICS: [string, keyof ReturnType<typeof summarizeTeam>][] = [
  ["Início de jogo", "early"],
  ["Fim de jogo", "late"],
  ["Engage", "engage"],
  ["Controle", "cc"],
  ["Poke", "poke"],
  ["Proteção", "peel"],
  ["Linha de frente", "frontline"],
];

function comparison(picks: Partial<Team>, enemy: Team) {
  const ally = summarizeTeam(LANES.flatMap((l) => (picks[l] ? [picks[l]!] : [])));
  const foe = summarizeTeam(LANES.map((l) => enemy[l]));
  const bar = (v: number, cls: string) =>
    h("div", { class: "bar" }, h("div", { class: `bar-fill ${cls}`, style: `width:${(v / 5) * 100}%` }));
  const apLabel = (s: number) => `${Math.round(s * 100)}% AP`;

  return h("section", { class: "panel" },
    h("h2", {}, "Comparação de composição"),
    h("div", { class: "legend" },
      h("span", { class: "dot dot-ally" }), "Seu time",
      h("span", { class: "dot dot-enemy" }), "Inimigo",
    ),
    h("div", { class: "metrics" },
      METRICS.map(([label, key]) => h("div", { class: "metric" },
        h("span", { class: "metric-label" }, label),
        h("div", { class: "metric-bars" }, bar(ally[key], "fill-ally"), bar(foe[key], "fill-enemy")),
      )),
      h("div", { class: "metric" },
        h("span", { class: "metric-label" }, "Tipo de dano"),
        h("span", { class: "metric-text" }, `${apLabel(ally.apShare)} · inimigo ${apLabel(foe.apShare)}`),
      ),
    ),
  );
}

export function draftView(
  daily: DailyChallenge,
  banner: string | null,
  onStart: (team: Team) => void,
): HTMLElement {
  const picks: Partial<Team> = {};
  const root = h("div", { class: "screen" });

  const render = () => {
    const complete = LANES.every((l) => picks[l]);
    root.replaceChildren(
      h("header", { class: "header" },
        h("h1", {}, "Daily League"),
        h("span", { class: "muted" }, `Desafio de ${formatDate(daily.date)}`),
      ),
      ...(banner ? [h("div", { class: "banner" }, banner)] : []),
      h("p", { class: "muted" }, "Escolha um campeão por rota para enfrentar o time inimigo do dia."),
      h("div", { class: "lanes" },
        LANES.map((lane) => h("div", { class: "lane" },
          h("div", { class: "lane-title" }, LANE_LABEL[lane]),
          champCard(daily.enemy[lane], { enemy: true }),
          h("div", { class: "vs" }, "vs"),
          daily.options[lane].map((id) => champCard(id, {
            selected: picks[lane] === id,
            onClick: () => { picks[lane] = id; render(); },
            extra: matchupBadge(lane, id, daily.enemy[lane]),
          })),
        )),
      ),
      comparison(picks, daily.enemy),
      h("div", { class: "actions" },
        h("button", {
          class: "btn btn-primary",
          disabled: !complete,
          onClick: () => complete && onStart(picks as Team),
        }, complete ? "Iniciar partida" : `Escolha mais ${LANES.filter((l) => !picks[l]).length} campeão(ões)`),
      ),
    );
  };
  render();
  return root;
}

// ------------------------------------------------------------ Partida

export function matchView(match: Match, onFinish: () => void): HTMLElement {
  let fast = false;
  let timer: number | undefined;

  const score = h("div", { class: "scoreboard" });
  const log = h("ol", { class: "log" });
  const decision = h("div", { class: "decision hidden" });
  const speedBtn = h("button", { class: "btn btn-small", onClick: () => {
    fast = !fast;
    speedBtn.textContent = fast ? "Velocidade: rápida" : "Velocidade: normal";
  } }, "Velocidade: normal");
  const finishBtn = h("button", { class: "btn btn-primary hidden", onClick: onFinish }, "Ver resultado");

  const teamsRow = (team: Team, cls: string) =>
    h("div", { class: `team-row ${cls}` }, LANES.map((l) => champIcon(team[l], "sm")));

  const renderScore = () => {
    const { ally, enemy } = match.state;
    const gold = ally.gold - enemy.gold;
    score.replaceChildren(
      h("div", { class: "score-side" }, h("span", { class: "label" }, "Seu time"), teamsRow(match.allyTeam, "ally"),
        h("span", { class: "kills ally" }, ally.kills)),
      h("div", { class: "score-mid" },
        h("div", { class: "clock" }, formatClock(match.state.time)),
        h("div", { class: `gold ${gold >= 0 ? "ally" : "enemy"}` }, `${gold >= 0 ? "+" : ""}${(gold / 1000).toFixed(1)}k ouro`),
        h("div", { class: "stat" }, `🏰 ${ally.towers}/${TOWERS_TO_WIN} · ${enemy.towers}/${TOWERS_TO_WIN}`),
        h("div", { class: "stat" }, `🐉 ${ally.dragons} · ${enemy.dragons}  👾 ${ally.barons} · ${enemy.barons}`),
      ),
      h("div", { class: "score-side right" }, h("span", { class: "label" }, "Inimigo"), teamsRow(match.enemyTeam, "enemy"),
        h("span", { class: "kills enemy" }, enemy.kills)),
    );
  };

  const append = (events: MatchEvent[]) => {
    for (const e of events) {
      log.append(h("li", { class: `event event-${e.side}` }, h("span", { class: "minute" }, `${e.minute}'`), e.text));
    }
    log.scrollTop = log.scrollHeight;
  };

  const showDecision = (prompt: DecisionPrompt) => {
    decision.classList.remove("hidden");
    decision.replaceChildren(
      h("h2", {}, prompt.title),
      h("div", { class: "options" },
        prompt.options.map((o) => h("button", {
          class: "option",
          onClick: () => {
            decision.classList.add("hidden");
            append(match.decide(o.id));
            renderScore();
            schedule();
          },
        },
          h("div", { class: "option-head" },
            h("strong", {}, o.label),
            h("span", { class: `risk risk-${o.risk.toLowerCase()}` }, `Risco ${o.risk.toLowerCase()}`),
          ),
          h("p", {}, o.description),
        )),
      ),
    );
  };

  const tick = () => {
    append(match.advance());
    renderScore();
    if (match.state.pending) showDecision(match.state.pending);
    else schedule();
  };

  const schedule = () => {
    if (match.state.winner) {
      finishBtn.classList.remove("hidden");
      speedBtn.classList.add("hidden");
      return;
    }
    // Cada advance() são 30 s de jogo: ~2 min de jogo a cada 1,1 s no modo normal.
    timer = window.setTimeout(tick, fast ? 60 : 275);
  };

  renderScore();
  timer = window.setTimeout(tick, 600);
  void timer;

  return h("div", { class: "screen screen-match" },
    score,
    log,
    decision,
    h("div", { class: "actions" }, speedBtn, finishBtn),
  );
}

// ------------------------------------------------------------ Resultado

export function resultView(opts: {
  date: string;
  summary: MatchSummary;
  picks: Team;
  status: string;
  leaderboard: Promise<LeaderboardEntry[]> | null;
  onReplay: () => void;
}): HTMLElement {
  const { summary: s } = opts;
  const share = buildShareText(opts.date, s);
  const copyBtn = h("button", { class: "btn btn-small" }, "Copiar resultado");
  const shareBox = h("pre", { class: "share" }, share);
  copyBtn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(share);
      copyBtn.textContent = "Copiado!";
    } catch {
      // O iframe do Discord pode bloquear a área de transferência: seleciona o texto.
      const range = document.createRange();
      range.selectNodeContents(shareBox);
      getSelection()?.removeAllRanges();
      getSelection()?.addRange(range);
      copyBtn.textContent = "Selecionado — use Ctrl+C";
    }
  });

  const board = h("section", { class: "panel" }, h("h2", {}, "Ranking do servidor hoje"));
  if (opts.leaderboard) {
    board.append(h("p", { class: "muted" }, "Carregando…"));
    opts.leaderboard.then((rows) => {
      board.replaceChildren(h("h2", {}, "Ranking do servidor hoje"),
        rows.length
          ? h("ol", { class: "board" }, rows.map((r) => h("li", {},
              h("span", {}, r.username),
              h("span", { class: r.won ? "ally" : "enemy" }, `${r.won ? "Vitória" : "Derrota"} · ${r.minute} min · ${r.kills}/${r.deaths}`),
            )))
          : h("p", { class: "muted" }, "Ninguém jogou ainda."));
    });
  } else {
    board.append(h("p", { class: "muted" }, "Disponível quando o jogo é aberto pelo Discord."));
  }

  return h("div", { class: "screen" },
    h("div", { class: `result-title ${s.won ? "ally" : "enemy"}` }, s.won ? "🏆 Vitória" : "💀 Derrota"),
    h("p", { class: "muted center" }, opts.status),
    h("div", { class: "team-row center" }, LANES.map((l: Lane) => champIcon(opts.picks[l], "sm"))),
    h("div", { class: "stats" },
      stat("Duração", `${s.minute} min`),
      stat("Abates", `${s.kills} x ${s.deaths}`),
      stat("Torres", `${s.towers}/${TOWERS_TO_WIN}`),
      stat("Dragões", String(s.dragons)),
      stat("Barões", String(s.barons)),
    ),
    h("section", { class: "panel" },
      h("h2", {}, "Compartilhe"),
      shareBox,
      copyBtn,
    ),
    board,
    h("div", { class: "actions" }, h("button", { class: "btn", onClick: opts.onReplay }, "Treinar de novo (não conta no ranking)")),
  );
}

function stat(label: string, value: string) {
  return h("div", { class: "stat-box" }, h("span", { class: "muted" }, label), h("strong", {}, value));
}

// ------------------------------------------------------------ Utilitários

export function messageView(title: string, detail?: string): HTMLElement {
  return h("div", { class: "screen center message" }, h("h1", {}, title), detail ? h("p", { class: "muted" }, detail) : null);
}

function formatDate(date: string) {
  const [y, m, d] = date.split("-");
  return `${d}/${m}/${y}`;
}
