# Daily League

"Wordle" de League of Legends como Discord Activity: todo dia um time inimigo fixo,
você escolhe 1 de 2 campeões por rota, e a partida é simulada com decisões a cada 8 minutos.

## Rodando

```bash
npm install
npm run dev          # baixa o Data Dragon (se preciso) + client :5173 + server :3001
```

- **Fora do Discord:** abra http://localhost:5173 (modo local, sem ranking).
- **Dentro do Discord:**
  1. `cloudflared tunnel --url http://localhost:5173`
  2. Developer Portal → Activities → URL Mappings → `/` = host do túnel (sem `https://`)
  3. Entre num canal de voz e abra a Activity pelo ícone de foguete.

O `.env` precisa de `CLIENT_ID` e `CLIENT_SECRET`.

## Scripts

| Comando | O que faz |
| --- | --- |
| `npm run data` | Baixa nomes (pt_BR) e ícones do Data Dragon |
| `npm run balance -- 30` | Simula as 32 combinações dos próximos 30 dias |
| `npm test` | Garante que o servidor reproduz qualquer partida igual ao cliente |
| `npm run typecheck` | Checagem de tipos |
| `npm run build` + `npm start` | Produção (o servidor entrega o `dist/`) |

## Estrutura

- `shared/champions.ts` — tabela de campeões, rotas e atributos (1–5). **É aqui que se balanceia.**
- `shared/engine.ts` — motor da partida (determinístico: mesma seed + decisões = mesmo jogo).
- `shared/daily.ts` — sorteio do desafio do dia (rejeita dias fáceis/difíceis demais).
- `server/` — OAuth do Discord, desafio do dia, validação de resultado e ranking (`data/results.json`).
- `client/` — interface (TypeScript puro + Vite).
