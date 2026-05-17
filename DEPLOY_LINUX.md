# Deploy Linux (Docker) - dsccontas

Este projeto foi ajustado para rodar em servidor Linux via Docker na porta **3010**.

## Deploy em um comando (recomendado)

Depois de clonar o projeto, rode:

```bash
chmod +x deploy.sh
./deploy.sh
```

O script faz automaticamente:
- validação de `git`, `docker` e `docker compose`
- criação do `.env` a partir de `.env.example` (se necessário)
- validação do `docker-compose.yml`
- `git pull --ff-only`
- `docker compose up -d --build`
- exibição de status e logs

## Pré-requisitos no servidor

- Git
- Docker Engine + Docker Compose plugin

## 1) Clonar o repositório

```bash
git clone https://github.com/dschomelab-commits/dsccontas.git
cd dsccontas
```

## 2) Configurar variáveis de ambiente

Copie o template:

```bash
cp .env.example .env
```

Edite o `.env` com os valores reais, principalmente:

- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`
- `VITE_SUPABASE_PROJECT_ID`
- `AI_BASE_URL` (ex: `http://192.168.1.158:11434/v1`)
- `AI_MODEL`

> `HOST=0.0.0.0` e `PORT=3010` já estão preparados para acesso externo.

## 3) Subir com Docker

```bash
docker compose up -d --build
```

> Importante: o app é um TanStack Start compilado para **Cloudflare Worker**.
> O container faz `npm run build` e em seguida serve o worker resultante
> (`dist/server/`) usando `wrangler dev` (workerd) na porta 3010. Não use
> `vite preview` — ele não executa SSR nem server functions e o login/IA
> ficariam quebrados.

## 4) Verificar saúde da aplicação

```bash
docker compose ps
docker compose logs -f dsccontas
```

## 5) Acesso

- Na rede local: `http://192.168.1.158:3010`

## Atualização após novo pull

```bash
git pull
docker compose up -d --build
```
