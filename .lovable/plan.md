
## Causa do erro

O `vite.config.ts` importa `@lovable.dev/vite-tanstack-config`, que está em `devDependencies`. O `Dockerfile` da etapa `runner` instala com `npm ci --omit=dev`, então esse pacote some. Em seguida o `CMD` chama `npm run preview`, que executa `vite preview` — e o `vite preview` carrega `vite.config.ts`, exigindo o pacote ausente. Daí o `ERR_MODULE_NOT_FOUND` em loop.

Além disso, há um problema conceitual: este projeto é **TanStack Start rodando como Cloudflare Worker** (`wrangler.jsonc` aponta `main: src/server.ts`, build com `@cloudflare/vite-plugin`). O `vite preview` só serve arquivos estáticos do `dist/` — ele **não** executa SSR nem server functions. Mesmo se o erro do pacote sumisse, a aplicação ficaria quebrada (login, server functions, rotas dinâmicas não funcionariam).

A correção certa é servir o bundle de Worker gerado pelo build usando o `wrangler` (workerd) localmente no Linux.

## O que mudar

### 1. `Dockerfile`
- Manter o stage `builder` como está (gera `dist/`).
- No stage `runner`:
  - Não usar `--omit=dev` (o `wrangler` é dev dep e precisa estar disponível). Alternativa: mover `wrangler` para `dependencies`.
  - Remover a cópia de `vite.config.ts` (não será mais usado em runtime).
  - Copiar `dist/`, `wrangler.jsonc` e (se necessário) `src/server.ts` apenas se o wrangler precisar dele — na verdade o build do `@cloudflare/vite-plugin` já produz o worker final em `dist/`, então o `main` do wrangler precisa apontar para o artefato buildado.
  - `CMD` passa a ser `npx wrangler dev <caminho-do-worker-buildado> --ip 0.0.0.0 --port 3010 --local --var ...` ou usar um `wrangler.jsonc` específico de runtime.

### 2. `wrangler.jsonc` (ou criar `wrangler.runtime.jsonc`)
- Apontar `main` para o worker buildado (provavelmente `dist/server/server.js` ou `dist/_worker.js/index.js` — confirmar inspecionando a saída de `vite build` localmente).
- Manter `compatibility_date` e `nodejs_compat`.

### 3. `package.json`
- Adicionar script `start`: `wrangler dev <built-worker> --ip 0.0.0.0 --port 3010 --local`.
- Mover `wrangler` para `dependencies` **ou** mantê-lo em dev e instalar tudo no runner.

### 4. `.env` em produção
- Variáveis `VITE_*` já são embarcadas no build, ok. Variáveis de runtime (`AI_BASE_URL`, `AI_MODEL`, `SUPABASE_SERVICE_ROLE_KEY`) precisam ser passadas ao wrangler via `--var` ou via `[vars]` no `wrangler.jsonc`. Como o `.env` já é carregado pelo `docker-compose`, posso gerar dinamicamente flags `--var KEY=VALUE` no `CMD` do container (entrypoint script) ou usar `wrangler dev --env-file .env` se a versão suportar.

### 5. `DEPLOY_LINUX.md`
- Atualizar instruções: explicar que agora o runtime é `wrangler` (workerd) servindo o build de produção na porta 3010.
- Adicionar passo "validar logs" e "se erro X, então Y".

## Passos de validação (após implementar)

1. `docker compose build` sem erro.
2. `docker compose up -d` e `docker compose logs -f` mostram `wrangler` escutando em `0.0.0.0:3010`.
3. `curl http://192.168.1.158:3010/` retorna o HTML da home com SSR.
4. Login com Supabase funciona (verifica que `VITE_*` foi embarcado).
5. Importação via IA chama o Ollama em `192.168.1.158:11434` (server function rodando dentro do worker).

## Alternativa mais simples (se você preferir)

Se quiser evitar wrangler no Docker, posso em vez disso:
- manter `vite preview` (só estático, **sem SSR e sem server functions**) — **não recomendo**, login e IA quebram; **ou**
- mudar o build para Node SSR (remover plugin Cloudflare do `vite.config.ts`), o que afeta o deploy padrão do Lovable.

## Pergunta antes de implementar

Confirma que posso seguir com a abordagem **wrangler no Docker** (mantém paridade com o ambiente Lovable e mantém SSR/server functions funcionando)? Se sim, eu implemento.
