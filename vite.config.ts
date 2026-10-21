import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  // O .env fica na raiz do projeto; só o CLIENT_ID vai para o frontend (o secret nunca).
  const env = loadEnv(mode, process.cwd(), "");

  return {
    root: "client",
    define: {
      __DISCORD_CLIENT_ID__: JSON.stringify(env.CLIENT_ID ?? ""),
    },
    server: {
      port: 5173,
      // Permite acesso pelo túnel do Cloudflare (URL Mapping "/" do Discord).
      allowedHosts: [".trycloudflare.com"],
      proxy: {
        "/api": "http://localhost:3001",
      },
    },
    build: {
      outDir: "../dist",
      emptyOutDir: true,
    },
  };
});
