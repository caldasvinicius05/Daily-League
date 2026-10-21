import generated from "./generated/champions.json";

interface ChampionMeta {
  name: string;
  title: string;
  tags: string[];
}

const META = generated.champions as Record<string, ChampionMeta>;

export const DDRAGON_VERSION: string = generated.version;

export function champName(id: string): string {
  return META[id]?.name ?? id;
}

export function champTitle(id: string): string {
  return META[id]?.title ?? "";
}
