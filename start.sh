#!/bin/bash

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
ok()   { echo -e "${GREEN}✓ $*${NC}"; }
warn() { echo -e "${YELLOW}⚠ $*${NC}"; }
err()  { echo -e "${RED}✗ $*${NC}"; }

if [ "$1" = "stop" ]; then
  pkill -f "node dist/main.js" 2>/dev/null && ok "API to'xtatildi" || warn "API ishlamayotgan edi"
  pkill -f "next-server"       2>/dev/null && ok "Web to'xtatildi" || warn "Web ishlamayotgan edi"
  exit 0
fi

if [ "$1" = "status" ]; then
  curl -sf http://localhost:4000/health > /dev/null 2>&1 && ok "API → http://localhost:4000" || err "API ishlamayapti"
  curl -sf http://localhost:3001        > /dev/null 2>&1 && ok "Web → http://localhost:3001" || err "Web ishlamayapti"
  exit 0
fi

echo "============================================"
echo "  Bilgim ishga tushirilmoqda..."
echo "============================================"

# 1. Docker
echo ""
echo "1. Docker servislar..."
if ! docker ps 2>/dev/null | grep -q "bilgim-postgres"; then
  warn "Docker konteynerlar yo'q. Ishga tushirilmoqda..."
  docker compose -f infra/docker/docker-compose.yml up -d
  echo -n "   PostgreSQL kutilmoqda"
  for i in $(seq 1 20); do
    docker exec bilgim-postgres pg_isready -U bilgim -q 2>/dev/null && break
    echo -n "." && sleep 2
  done
  echo ""
fi
ok "Docker: postgres, redis, minio, mailhog"

# 2. DB
echo ""
echo "2. DB migratsiya..."
STATUS=$(cd "$ROOT/packages/db" && DATABASE_URL="postgresql://bilgim:bilgim_dev@localhost:5433/bilgim" npx prisma migrate status 2>&1)
if echo "$STATUS" | grep -q "up to date"; then
  ok "DB yangilangan"
else
  warn "Migratsiya o'tkazilmoqda..."
  cd "$ROOT/packages/db" && DATABASE_URL="postgresql://bilgim:bilgim_dev@localhost:5433/bilgim" npx prisma migrate deploy 2>&1 | tail -2
  cd "$ROOT"
  ok "Migratsiya bajarildi"
fi

# 3. API build
echo ""
echo "3. API build..."
pkill -f "node dist/main.js" 2>/dev/null; sleep 1
cd "$ROOT/apps/api"
rm -rf dist
npx tsc
if [ ! -f "dist/main.js" ]; then
  err "Build muvaffaqiyatsiz. dist/main.js topilmadi."
  exit 1
fi
ok "Build tayyor"

# 4. API start
echo ""
echo "4. API ishga tushirilmoqda..."
nohup node dist/main.js > /tmp/bilgim-api.log 2>&1 &
API_PID=$!
echo -n "   Kutilmoqda"
for i in $(seq 1 15); do
  sleep 2
  curl -sf http://localhost:4000/health > /dev/null 2>&1 && break
  echo -n "."
done
echo ""
if curl -sf http://localhost:4000/health > /dev/null 2>&1; then
  ok "API tayyor (PID: $API_PID) → http://localhost:4000"
else
  err "API ishga tushmadi. Log: tail -20 /tmp/bilgim-api.log"
  exit 1
fi

# 5. Web start
echo ""
echo "5. Web ishga tushirilmoqda..."
cd "$ROOT/apps/web"
pkill -f "next-server" 2>/dev/null; sleep 1
nohup pnpm dev > /tmp/bilgim-web.log 2>&1 &
WEB_PID=$!
echo -n "   Kutilmoqda"
for i in $(seq 1 20); do
  sleep 2
  curl -sf http://localhost:3001 > /dev/null 2>&1 && break
  echo -n "."
done
echo ""
if curl -sf http://localhost:3001 > /dev/null 2>&1; then
  ok "Web tayyor (PID: $WEB_PID) → http://localhost:3001"
else
  err "Web ishga tushmadi. Log: tail -20 /tmp/bilgim-web.log"
  exit 1
fi

echo ""
echo "============================================"
ok "Loyiha ishga tushdi!"
echo ""
echo "  🌐 Web   → http://localhost:3001"
echo "  🔌 API   → http://localhost:4000"
echo "  📧 Mail  → http://localhost:8025"
echo ""
echo "  To'xtatish : ./start.sh stop"
echo "  Holat      : ./start.sh status"
echo "  API log    : tail -f /tmp/bilgim-api.log"
echo "  Web log    : tail -f /tmp/bilgim-web.log"
echo "============================================"
