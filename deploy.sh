#!/usr/bin/env bash
set -euo pipefail

APP_NAME="dsccontas"
APP_PORT="3010"

log() {
  echo "[deploy] $1"
}

error_exit() {
  echo "[deploy][erro] $1" >&2
  exit 1
}

require_cmd() {
  local cmd="$1"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    error_exit "Comando obrigatório não encontrado: $cmd"
  fi
}

log "Validando pré-requisitos..."
require_cmd git
require_cmd docker

if ! docker compose version >/dev/null 2>&1; then
  error_exit "Docker Compose plugin não encontrado. Instale e tente novamente."
fi

if [ ! -f ".env" ]; then
  if [ -f ".env.example" ]; then
    cp .env.example .env
    log "Arquivo .env não existia. Criei a partir do .env.example."
    log "IMPORTANTE: revise o .env antes de continuar em produção."
  else
    error_exit "Arquivo .env não encontrado e .env.example também não existe."
  fi
fi

log "Validando docker-compose.yml..."
docker compose config >/dev/null

log "Atualizando código local..."
git pull --ff-only || log "git pull não aplicado (verifique branch/remoto). Seguindo com os arquivos atuais."

log "Buildando e subindo containers..."
docker compose up -d --build

log "Status dos serviços:"
docker compose ps

log "Últimos logs do serviço $APP_NAME:"
docker compose logs --tail=80 "$APP_NAME" || true

log "Deploy concluído. Acesse: http://192.168.1.158:${APP_PORT}"
