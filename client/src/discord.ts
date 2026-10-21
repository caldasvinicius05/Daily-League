import { DiscordSDK } from "@discord/embedded-app-sdk";

export interface Session {
  mode: "discord" | "local";
  user: { id: string; username: string };
  guildId: string | null;
  accessToken: string | null;
}

/**
 * Dentro do Discord, a URL tem ?frame_id=...; fora dele (localhost no navegador)
 * entramos em "modo local" para testar o jogo sem autenticação.
 */
export async function connect(): Promise<Session> {
  const params = new URLSearchParams(location.search);
  if (!params.has("frame_id")) {
    return { mode: "local", user: { id: "local", username: "Modo local" }, guildId: null, accessToken: null };
  }

  const sdk = new DiscordSDK(__DISCORD_CLIENT_ID__);
  await sdk.ready();

  const { code } = await sdk.commands.authorize({
    client_id: __DISCORD_CLIENT_ID__,
    response_type: "code",
    state: "",
    prompt: "none",
    scope: ["identify"],
  });

  const res = await fetch("/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code }),
  });
  if (!res.ok) throw new Error("Falha ao trocar o código OAuth");
  const { access_token } = (await res.json()) as { access_token: string };

  const auth = await sdk.commands.authenticate({ access_token });
  if (!auth) throw new Error("Falha na autenticação com o Discord");

  return {
    mode: "discord",
    user: { id: auth.user.id, username: auth.user.global_name ?? auth.user.username },
    guildId: sdk.guildId,
    accessToken: access_token,
  };
}
