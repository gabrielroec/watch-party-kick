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
BACKEND_PORT=4000

log() { printf "\n\033[1;32m▶ %s\033[0m\n" "$*"; }
warn() { printf "\n\033[1;33m! %s\033[0m\n" "$*"; }
fail() { printf "\n\033[1;31m✗ %s\033[0m\n" "$*"; exit 1; }

log "1) Verificando dependências do sistema"
apt-get update -qq
apt-get install -y -qq git curl build-essential python3 ca-certificates lsof >/dev/null

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

log "3) Instalando dependências (better-sqlite3 já está whitelisted no package.json)"
cd "$APP_DIR"
pnpm install --frozen-lockfile
# Garantia: força recompilação do módulo nativo se algo bloqueou.
pnpm rebuild better-sqlite3 || true

# Sanity check: o .node tem que existir
if ! ls "$APP_DIR"/node_modules/.pnpm/better-sqlite3@*/node_modules/better-sqlite3/build/Release/*.node >/dev/null 2>&1; then
  warn "better-sqlite3 build não foi encontrado. Tentando rebuild explícito..."
  cd "$APP_DIR"/apps/backend
  pnpm rebuild better-sqlite3
  cd "$APP_DIR"
fi

log "4) Buildando @wpk/shared (precisa antes do backend)"
pnpm --filter @wpk/shared build

SHARED_DIST="$APP_DIR/packages/shared/dist/index.js"
if [ ! -f "$SHARED_DIST" ]; then
  fail "Build do @wpk/shared não produziu $SHARED_DIST."
fi
log "@wpk/shared dist OK: $(ls -la "$SHARED_DIST" | awk '{print $5" bytes"}')"

log "4.1) Buildando backend"
pnpm --filter @wpk/backend build

# Sanity: o backend compilado tem que importar @wpk/shared do dist, não .ts
if grep -rq "packages/shared/src" "$APP_DIR/apps/backend/dist/" 2>/dev/null; then
  fail "Backend compilado ainda referencia packages/shared/src — algo errado no resolve."
fi

# Sanity: o symlink do workspace tem que enxergar o dist
SHARED_LINK="$APP_DIR/apps/backend/node_modules/@wpk/shared/dist/index.js"
if [ ! -f "$SHARED_LINK" ]; then
  warn "Symlink workspace não resolve pro dist do @wpk/shared. Reinstalando..."
  cd "$APP_DIR"
  rm -rf apps/backend/node_modules/@wpk
  pnpm install --frozen-lockfile
  if [ ! -f "$SHARED_LINK" ]; then
    fail "@wpk/shared/dist não visível em $SHARED_LINK mesmo após reinstall."
  fi
fi
log "@wpk/shared linkado no backend OK"

log "5) Garantindo storage em $STORAGE_DIR"
mkdir -p "$STORAGE_DIR/recordings"
chmod -R u+rwX "$STORAGE_DIR"

log "6) Configurando .env (auto-descobre LIVEKIT_* se já existir em outro lugar)"
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

# Procura LIVEKIT_* em qualquer .env OU arquivo de service systemd se nosso ENV_FILE ainda não tem
if ! grep -q "^LIVEKIT_URL=" "$ENV_FILE" 2>/dev/null; then
  log "Procurando LIVEKIT_* em qualquer arquivo do sistema..."
  # Procura arquivos que tenham qualquer dos formatos:
  #  - LIVEKIT_URL=...           (.env)
  #  - Environment=LIVEKIT_URL=... (systemd .service)
  SRC_FILE=""
  while IFS= read -r candidate; do
    [ "$candidate" = "$ENV_FILE" ] && continue
    if grep -qE "(^|Environment=)LIVEKIT_URL=" "$candidate" 2>/dev/null; then
      SRC_FILE="$candidate"
      break
    fi
  done < <(grep -rlE "LIVEKIT_URL=" /etc /opt /root /home /var 2>/dev/null | grep -vE "node_modules|.git/|\.log$|/dist/" || true)

  if [ -n "$SRC_FILE" ]; then
    log "Encontrei credenciais em $SRC_FILE — copiando"
    # Extrai os valores cobrindo os dois formatos
    extract() {
      grep -oE "(^|Environment=)$1=[^\"']+" "$SRC_FILE" | head -1 | sed "s|.*$1=||" | sed 's/[" ]*$//'
    }
    LIVEKIT_URL_VAL=$(extract LIVEKIT_URL)
    LIVEKIT_KEY_VAL=$(extract LIVEKIT_API_KEY)
    LIVEKIT_SEC_VAL=$(extract LIVEKIT_API_SECRET)
    [ -n "$LIVEKIT_URL_VAL" ] && set_env LIVEKIT_URL        "$LIVEKIT_URL_VAL"
    [ -n "$LIVEKIT_KEY_VAL" ] && set_env LIVEKIT_API_KEY    "$LIVEKIT_KEY_VAL"
    [ -n "$LIVEKIT_SEC_VAL" ] && set_env LIVEKIT_API_SECRET "$LIVEKIT_SEC_VAL"
  else
    warn "Nenhum .env ou .service com LIVEKIT_URL encontrado no sistema."
  fi
fi

set_env STORAGE_PATH "$STORAGE_DIR"
set_env STREAMER_MANDIOCA_KEY "$STREAMER_KEY"

# Defaults só se ainda não existirem (pra não sobrescrever produção).
grep -q "^PORT="            "$ENV_FILE" || echo "PORT=${BACKEND_PORT}" >> "$ENV_FILE"
grep -q "^ALLOWED_ORIGINS=" "$ENV_FILE" || echo "ALLOWED_ORIGINS=https://watch-party-kick.vercel.app" >> "$ENV_FILE"

# Validação: as 3 keys do LiveKit têm que estar presentes
for key in LIVEKIT_URL LIVEKIT_API_KEY LIVEKIT_API_SECRET; do
  if ! grep -q "^${key}=." "$ENV_FILE"; then
    warn "Faltando ${key} no .env."
    warn "Cole as 3 linhas no arquivo: nano ${ENV_FILE}"
    warn "Adicione (substituindo pelos valores reais):"
    warn "  LIVEKIT_URL=wss://seu-livekit-url"
    warn "  LIVEKIT_API_KEY=APIWPK001"
    warn "  LIVEKIT_API_SECRET=watchpartykicksecret2026..."
    fail "Sem credenciais LIVEKIT_*, backend não sobe."
  fi
done
log ".env validado — LIVEKIT_* presentes"

log "7) Matando qualquer processo legacy na porta ${BACKEND_PORT}"
# Pega PIDs (exceto o nosso service) e mata. Se nada estiver lá, segue.
LEGACY_PIDS=$(lsof -i :${BACKEND_PORT} -t 2>/dev/null | sort -u || true)
for pid in $LEGACY_PIDS; do
  # Skip se for nosso service futuro (raro neste ponto, mas defensivo)
  if ps -p "$pid" -o cmd= 2>/dev/null | grep -q "${APP_DIR}/apps/backend/dist/index.js"; then
    continue
  fi
  warn "Matando PID legacy $pid ($(ps -p "$pid" -o cmd= 2>/dev/null | head -c 80))"
  kill -9 "$pid" || true
done
sleep 1

log "8) Criando/atualizando service systemd"
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

log "9) Restart e verificação real do estado do service"
systemctl restart "${SERVICE_NAME}"
sleep 4

STATE=$(systemctl is-active "${SERVICE_NAME}" 2>/dev/null || echo "unknown")
log "Estado do service: ${STATE}"
if [ "${STATE}" != "active" ]; then
  warn "Service não está active. Logs:"
  tail -40 /var/log/${SERVICE_NAME}.log || true
  systemctl status "${SERVICE_NAME}" --no-pager -l | head -20 || true
  fail "Deploy não terminou — service falhou em ficar 'active'. Veja os logs acima."
fi

log "10) Health check real (no service novo, não no legacy)"
# Probe o /health E um endpoint novo. Os dois precisam responder.
if ! curl -fsS http://localhost:${BACKEND_PORT}/health > /tmp/health.json; then
  fail "/health falhou. Veja /var/log/${SERVICE_NAME}.log"
fi
cat /tmp/health.json; echo

if ! curl -fsS "http://localhost:${BACKEND_PORT}/api/streamers/mandioca/recordings" > /tmp/recs.json; then
  fail "/api/streamers/mandioca/recordings falhou — código novo NÃO subiu."
fi
echo "Lista de recordings (deve ser []): $(cat /tmp/recs.json)"

log "Backend de pé com endpoints novos. ✓"
echo
echo "Próximo passo: testar gravação no app desktop."
