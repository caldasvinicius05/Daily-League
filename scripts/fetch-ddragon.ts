/**
 * Baixa do Riot Data Dragon os nomes (pt_BR) e ícones dos campeões usados no jogo.
 *   - shared/generated/champions.json  -> nomes, títulos e tags
 *   - client/public/champions/{id}.png -> ícones servidos pelo próprio app
 * Servir os ícones localmente evita depender de URL Mapping extra dentro do iframe do Discord.
 */
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { CHAMPIONS } from "../shared/champions";

const DDRAGON = "https://ddragon.leagueoflegends.com";
const JSON_PATH = new URL("../shared/generated/champions.json", import.meta.url);
const ICON_DIR = new URL("../client/public/champions/", import.meta.url);

interface Generated {
  version: string;
  champions: Record<string, { name: string; title: string; tags: string[] }>;
}

async function readExisting(): Promise<Generated | null> {
  try {
    return JSON.parse(await readFile(JSON_PATH, "utf8")) as Generated;
  } catch {
    return null;
  }
}

function iconsComplete(): boolean {
  return CHAMPIONS.every((c) => existsSync(new URL(`${c.id}.png`, ICON_DIR)));
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ao buscar ${url}`);
  return (await res.json()) as T;
}

async function main() {
  const existing = await readExisting();

  let version: string;
  try {
    [version] = await getJson<string[]>(`${DDRAGON}/api/versions.json`);
  } catch (err) {
    if (existing) {
      console.warn(`[ddragon] Sem conexão; usando dados do patch ${existing.version}.`);
      return;
    }
    throw err;
  }

  const complete = existing?.version === version
    && CHAMPIONS.every((c) => existing.champions[c.id])
    && iconsComplete();
  if (complete) {
    console.log(`[ddragon] Dados do patch ${version} já estão atualizados.`);
    return;
  }

  console.log(`[ddragon] Baixando patch ${version}...`);
  const data = await getJson<{ data: Record<string, { name: string; title: string; tags: string[] }> }>(
    `${DDRAGON}/cdn/${version}/data/pt_BR/champion.json`,
  );

  await mkdir(new URL("../shared/generated/", import.meta.url), { recursive: true });
  await mkdir(ICON_DIR, { recursive: true });

  const out: Generated = { version, champions: {} };
  const missing: string[] = [];
  const found = CHAMPIONS.filter((c) => {
    const champ = data.data[c.id];
    if (!champ) missing.push(c.id);
    else out.champions[c.id] = { name: champ.name, title: champ.title, tags: champ.tags };
    return Boolean(champ);
  });

  // Baixa os ícones em lotes para não abrir dezenas de conexões ao mesmo tempo.
  for (let i = 0; i < found.length; i += 10) {
    await Promise.all(found.slice(i, i + 10).map(async (c) => {
      const res = await fetch(`${DDRAGON}/cdn/${version}/img/champion/${c.id}.png`);
      if (!res.ok) throw new Error(`Falha no ícone de ${c.id}: ${res.status}`);
      await writeFile(new URL(`${c.id}.png`, ICON_DIR), Buffer.from(await res.arrayBuffer()));
    }));
  }

  await writeFile(JSON_PATH, JSON.stringify(out, null, 2));
  console.log(`[ddragon] ${found.length} campeões salvos.`);
  if (missing.length) {
    console.warn(`[ddragon] Ids não encontrados no Data Dragon (corrija em shared/champions.ts): ${missing.join(", ")}`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("[ddragon]", err);
  process.exit(1);
});
