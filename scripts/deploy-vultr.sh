#!/bin/bash
# Deploy do backend Watch Party Kick no VPS Vultr.
# Cole este script inteiro no "View Console" do painel da Vultr.
# Idempotente: pode rodar várias vezes sem quebrar.

set -e
set -u

REPO_URL="https://github.com/gabrielroec/watch-party-kick.git"
APP_DIR="/opt/watch-party-kick"
STORAGE_DIR="/var/wpk"
STREAMER_KEY="mandioca-mvp-key-change-me"
SERVICE_NAME="wpk-backend"

log() { printf "\n\033[1;32m▶ %s\033[0m\n" "$*"; }
warn() { printf "\n\033[1;33m! %s\033[0m\n" "$*"; }

log "1) Verificando dependências do sistema"
apt-get update -qq
apt-get install -y -qq git curl build-essential python3 ca-certificates >/dev/null

if ! command -v node >/dev/null || [ "$(node -v | cut -dv -f2 | cut -d. -f1)" -lt 20 ]; then
  log "Instalando Node.js 20.x"
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi
node -v
command -v pnpm >/dev/null || npm i -g pnpm@10 >/dev/null
pnpm -v

log "2) Clonando ou atualizando repo"
if [ -d "$APP_DIR/.git" ]; then
  cd "$APP_DIR"
  git fetch origin
  git reset --hard origin/main
else
  rm -rf "$APP_DIR"
  git clone "$REPO_URL" "$APP_DIR"
  cd "$APP_DIR"
fi
git log -1 --oneline

log "3) Instalando dependências (better-sqlite3 compila nativo aqui)"
pnpm install --frozen-lockfile

log "4) Buildando backend"
pnpm --filter @wpk/backend build

log "5) Garantindo storage em $STORAGE_DIR"
mkdir -p "$STORAGE_DIR/recordings"
chmod -R u+rwX "$STORAGE_DIR"

log "6) Atualizando .env (preserva LIVEKIT_*)"
ENV_FILE="$APP_DIR/apps/backend/.env"
touch "$ENV_FILE"

set_env() {
  local key="$1" val="$2"
  if grep -q "^${key}=" "$ENV_FILE"; then
    sed -i "s|^${key}=.*|${key}=${val}|" "$ENV_FILE"
  else
    printf "%s=%s\n" "$key" "$val" >> "$ENV_FILE"
  fi
}

set_env STORAGE_PATH "$STORAGE_DIR"
set_env STREAMER_MANDIOCA_KEY "$STREAMER_KEY"

# Defaults só se ainda não existirem (pra não sobrescrever produção).
grep -q "^PORT="            "$ENV_FILE" || echo "PORT=4000" >> "$ENV_FILE"
grep -q "^ALLOWED_ORIGINS=" "$ENV_FILE" || echo "ALLOWED_ORIGINS=https://watch-party-kick.vercel.app" >> "$ENV_FILE"

log "7) Criando/atualizando service systemd"
cat > "/etc/systemd/system/${SERVICE_NAME}.service" <<EOF
[Unit]
Description=Watch Party Kick backend
After=network.target

[Service]
Type=simple
WorkingDirectory=${APP_DIR}/apps/backend
EnvironmentFile=${APP_DIR}/apps/backend/.env
ExecStart=/usr/bin/node ${APP_DIR}/apps/backend/dist/index.js
Restart=always
RestartSec=3
StandardOutput=append:/var/log/${SERVICE_NAME}.log
StandardError=append:/var/log/${SERVICE_NAME}.log

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable "${SERVICE_NAME}" >/dev/null

log "8) Restart"
systemctl restart "${SERVICE_NAME}"
sleep 3
systemctl status "${SERVICE_NAME}" --no-pager -l | head -15 || true

log "9) Health check"
sleep 2
if curl -fsS http://localhost:4000/health > /tmp/health.json; then
  cat /tmp/health.json; echo
  log "Backend de pé. Endpoints novos: /api/recordings/* e /api/streamers/mandioca/recordings"
else
  warn "Health falhou. Logs:"
  tail -30 /var/log/${SERVICE_NAME}.log
  exit 1
fi
