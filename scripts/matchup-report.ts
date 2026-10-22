/**
 * Relatório do impacto dos matchups reais: quantos pares têm dados, quantas vezes os
 * dados mudam o favorito previsto pelos atributos e o tamanho típico da vantagem.
 *
 *   npx tsx scripts/matchup-report.ts
 */
import { championsForLane } from "../shared/champions";
import { attributeLaneScore, getMatchup, laneEdge, MATCHUP_PATCHES } from "../shared/matchups";
import { LANES } from "../shared/types";

console.log(`Matchups dos patches ${MATCHUP_PATCHES.join(", ")}`);
for (const lane of LANES) {
  const ids = championsForLane(lane).map((c) => c.id);
  let pairs = 0;
  let withData = 0;
  let flips = 0;
  const edges: number[] = [];
  for (const a of ids) {
    for (const b of ids) {
      if (a >= b) continue;
      pairs++;
      const edge = laneEdge(lane, a, b);
      edges.push(Math.abs(edge));
      if (!getMatchup(lane, a, b)) continue;
      withData++;
      const attr = attributeLaneScore(a) - attributeLaneScore(b);
      if (Math.abs(attr) > 0.3 && Math.sign(attr) !== Math.sign(edge)) flips++;
    }
  }
  edges.sort((x, y) => x - y);
  console.log(
    `${lane.padEnd(8)} dados em ${withData}/${pairs} pares · favorito invertido pelos dados em ${flips}`
    + ` · |vantagem| mediana ${edges[edges.length >> 1].toFixed(2)}, máx ${edges.at(-1)!.toFixed(2)}`,
  );
}
