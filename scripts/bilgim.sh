#!/usr/bin/env bash
# Launches the full Bilgim (EduBridge) dev stack with one command: `bilgim`.
#
# No Docker is required — Postgres and Redis are run as plain local
# processes with data kept in infra/local/ (gitignored) so repeat runs
# are fast (no re-init, no re-seed). Safe to Ctrl+C: the API/web dev
# servers stop, Postgres and Redis are left running for the next launch.
# Run `bilgim stop` to also stop Postgres/Redis.
set -euo pipefail

ROOT="$(cd "$(dirname "$(readlink -f "$0")")/.." && pwd)"
cd "$ROOT"

LOCAL_DIR="$ROOT/infra/local"
PGDATA="$LOCAL_DIR/pgdata"
PGSOCK="/tmp/bilgim_pgsock"
PGPORT="5433"
REDIS_DIR="$LOCAL_DIR/redisdata"
REDIS_PORT="6380"
REDIS_PASSWORD="edubridge_dev"
LOG_DIR="$LOCAL_DIR/logs"
LIVEKIT_BIN="$LOCAL_DIR/bin/livekit-server"
LIVEKIT_PORT="7880"
LIVEKIT_PID_FILE="$LOCAL_DIR/livekit.pid"

PG_BIN="$(dirname "$(find /usr/lib/postgresql/*/bin/pg_ctl 2>/dev/null | sort -V | tail -1)")"
if [ -z "$PG_BIN" ]; then
  echo "error: postgresql server binaries not found (looked in /usr/lib/postgresql/*/bin)" >&2
  exit 1
fi

mkdir -p "$LOCAL_DIR" "$REDIS_DIR" "$LOG_DIR" "$PGSOCK"

stop_stack() {
  echo "==> Stopping Postgres, Redis and LiveKit..."
  "$PG_BIN/pg_ctl" -D "$PGDATA" stop -m fast >/dev/null 2>&1 || true
  redis-cli -h 127.0.0.1 -p "$REDIS_PORT" -a "$REDIS_PASSWORD" shutdown nosave >/dev/null 2>&1 || true
  if [ -f "$LIVEKIT_PID_FILE" ]; then
    kill "$(cat "$LIVEKIT_PID_FILE")" >/dev/null 2>&1 || true
    rm -f "$LIVEKIT_PID_FILE"
  fi
  echo "Stopped."
}

if [ "${1:-}" = "stop" ]; then
  stop_stack
  exit 0
fi

# ---- Postgres ----
if ! "$PG_BIN/pg_ctl" -D "$PGDATA" status >/dev/null 2>&1; then
  if [ ! -s "$PGDATA/PG_VERSION" ]; then
    echo "==> Initializing Postgres data directory..."
    "$PG_BIN/initdb" -D "$PGDATA" -U edubridge --auth=trust >/dev/null
  fi
  echo "==> Starting Postgres on port $PGPORT..."
  "$PG_BIN/pg_ctl" -D "$PGDATA" -l "$LOG_DIR/postgres.log" \
    -o "-p $PGPORT -k $PGSOCK -c listen_addresses=localhost" start >/dev/null
else
  echo "==> Postgres already running."
fi

for _ in $(seq 1 30); do
  "$PG_BIN/pg_isready" -h 127.0.0.1 -p "$PGPORT" >/dev/null 2>&1 && break
  sleep 0.5
done

psql -h 127.0.0.1 -p "$PGPORT" -U edubridge -d postgres -c \
  "ALTER USER edubridge WITH PASSWORD '${REDIS_PASSWORD}';" >/dev/null 2>&1 || true
if ! psql -h 127.0.0.1 -p "$PGPORT" -U edubridge -d postgres -tAc \
  "SELECT 1 FROM pg_database WHERE datname='edubridge'" | grep -q 1; then
  psql -h 127.0.0.1 -p "$PGPORT" -U edubridge -d postgres -c "CREATE DATABASE edubridge OWNER edubridge;" >/dev/null
fi
psql -h 127.0.0.1 -p "$PGPORT" -U edubridge -d edubridge -c \
  "CREATE EXTENSION IF NOT EXISTS pgcrypto; CREATE EXTENSION IF NOT EXISTS pg_trgm; CREATE EXTENSION IF NOT EXISTS citext;" >/dev/null

# ---- Redis ----
if ! redis-cli -h 127.0.0.1 -p "$REDIS_PORT" -a "$REDIS_PASSWORD" ping >/dev/null 2>&1; then
  echo "==> Starting Redis on port $REDIS_PORT..."
  redis-server --port "$REDIS_PORT" --requirepass "$REDIS_PASSWORD" --daemonize yes \
    --dir "$REDIS_DIR" --appendonly yes --logfile "$LOG_DIR/redis.log" --bind 127.0.0.1
else
  echo "==> Redis already running."
fi

# ---- LiveKit (WebRTC SFU for live classes) ----
if ! curl -s -o /dev/null -m 2 "http://127.0.0.1:${LIVEKIT_PORT}/" 2>/dev/null; then
  if [ ! -x "$LIVEKIT_BIN" ]; then
    echo "==> Downloading livekit-server..."
    mkdir -p "$LOCAL_DIR/bin"
    LIVEKIT_VERSION="1.13.4"
    curl -sSL -o /tmp/livekit-server.tar.gz \
      "https://github.com/livekit/livekit/releases/download/v${LIVEKIT_VERSION}/livekit_${LIVEKIT_VERSION}_linux_amd64.tar.gz"
    tar -xzf /tmp/livekit-server.tar.gz -C "$LOCAL_DIR/bin" livekit-server
    chmod +x "$LIVEKIT_BIN"
    rm -f /tmp/livekit-server.tar.gz
  fi
  echo "==> Starting LiveKit on port $LIVEKIT_PORT..."
  nohup "$LIVEKIT_BIN" --dev --bind 127.0.0.1 >"$LOG_DIR/livekit.log" 2>&1 &
  echo $! > "$LIVEKIT_PID_FILE"
  for _ in $(seq 1 30); do
    curl -s -o /dev/null -m 1 "http://127.0.0.1:${LIVEKIT_PORT}/" 2>/dev/null && break
    sleep 0.5
  done
else
  echo "==> LiveKit already running."
fi

# ---- .env ----
if [ ! -f "$ROOT/.env" ]; then
  echo "==> Creating .env..."
  cp "$ROOT/.env.example" "$ROOT/.env"
  JWT_SECRET="$(openssl rand -hex 32)"
  MASTER_KEY="$(openssl rand -base64 32)"
  sed -i \
    -e "s#^DATABASE_URL=.*#DATABASE_URL=\"postgresql://edubridge:${REDIS_PASSWORD}@localhost:${PGPORT}/edubridge?schema=public\"#" \
    -e "s#^DATABASE_READ_REPLICA_URL=.*#DATABASE_READ_REPLICA_URL=\"postgresql://edubridge:${REDIS_PASSWORD}@localhost:${PGPORT}/edubridge?schema=public\"#" \
    -e "s#^JWT_SECRET=.*#JWT_SECRET=\"${JWT_SECRET}\"#" \
    -e "s#^MASTER_ENCRYPTION_KEY=.*#MASTER_ENCRYPTION_KEY=\"${MASTER_KEY}\"#" \
    "$ROOT/.env"
fi

set -a
# shellcheck disable=SC1091
source "$ROOT/.env"
set +a

# ---- Dependencies ----
if [ ! -d "$ROOT/node_modules" ]; then
  echo "==> Installing dependencies (pnpm install)..."
  pnpm install
fi

# ---- Prisma ----
echo "==> Applying Prisma schema..."
pnpm --filter @edubridge/db prisma:generate >/dev/null
(cd "$ROOT/packages/db" && npx prisma migrate deploy) >/dev/null

if [ ! -f "$LOCAL_DIR/.seeded" ]; then
  echo "==> Seeding database..."
  pnpm --filter @edubridge/db prisma:seed
  touch "$LOCAL_DIR/.seeded"
fi

# If a previous `bilgim` run is already up and healthy, don't touch it —
# just point at it. This avoids the EADDRINUSE race where a second
# invocation kills the old app's child processes (dist/main, next dev)
# but the parent watcher (nest start --watch's supervisor) immediately
# respawns one, racing the new instance for the same port.
if curl -s -o /dev/null -m 2 "http://localhost:${API_PORT:-4000}/health" 2>/dev/null \
  && curl -s -o /dev/null -m 2 "http://localhost:${WEB_PORT:-3000}/" 2>/dev/null; then
  echo ""
  echo "Bilgim allaqachon ishlab turibdi:"
  echo "   API:   http://localhost:${API_PORT:-4000}"
  echo "   Web:   http://localhost:${WEB_PORT:-3000}"
  echo "   (Qayta ishga tushirish uchun avval 'bilgim stop' so'ng 'bilgim')"
  exit 0
fi

# Stale tsconfig.tsbuildinfo can make `nest start --watch` silently skip
# emitting to dist/ — clear it.
find "$ROOT/apps" "$ROOT/packages" -maxdepth 1 -name "tsconfig.tsbuildinfo" -delete 2>/dev/null || true

# Force-free the app ports so a half-dead process from a crashed/killed
# previous run can't cause EADDRINUSE. Killing by port (not by command
# pattern) also catches the watcher supervisors themselves, not just
# their leaf children — pattern-based pkill left the supervisor alive
# to respawn a child mid-race.
fuser -k "${API_PORT:-4000}/tcp" 2>/dev/null || true
fuser -k "${WEB_PORT:-3000}/tcp" 2>/dev/null || true
pkill -9 -f "nest.js start" 2>/dev/null || true
pkill -9 -f "dist/main" 2>/dev/null || true
pkill -9 -f "next dev -p ${WEB_PORT:-3000}" 2>/dev/null || true
sleep 1

echo ""
echo "Bilgim ishga tushmoqda..."
echo "   API:   http://localhost:${API_PORT:-4000}"
echo "   Web:   http://localhost:${WEB_PORT:-3000}"
echo "   Admin: admin@edubridge.uz / Admin123!@#"
echo "   (Ctrl+C to stop the app; 'bilgim stop' also stops Postgres/Redis)"
echo ""

exec pnpm exec turbo run dev --env-mode=loose --parallel --continue --filter='!@edubridge/mobile'
