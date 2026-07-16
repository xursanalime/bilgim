#!/usr/bin/env bash
# Verify the middleware refreshes an expired access token instead of
# bouncing the user to /login.
set -euo pipefail
API=http://localhost:4000/api/v1
WEB=http://localhost:3000
PASS="Passw0rd!@#"
EMAIL="session.test@example.com"

curl -s -X POST "$API/auth/register" -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"username\":\"session_test\",\"password\":\"$PASS\",\"fullName\":\"Session Test\",\"role\":\"TEACHER\"}" >/dev/null || true

LOGIN=$(curl -s -X POST "$API/auth/login" -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\"}")
ACCESS=$(echo "$LOGIN" | python3 -c "import sys,json;print(json.load(sys.stdin)['accessToken'])")
REFRESH=$(echo "$LOGIN" | python3 -c "import sys,json;print(json.load(sys.stdin)['refreshToken'])")

echo "Got tokens (access len=${#ACCESS}, refresh len=${#REFRESH})"

# 1) Valid access token cookie → dashboard should NOT redirect to login.
echo -n "Valid token → /uz/dashboard: "
code=$(curl -s -o /dev/null -w "%{http_code}" -H "Cookie: bilgim_access_token=$ACCESS; bilgim_refresh_token=$REFRESH" "$WEB/uz/dashboard")
echo "HTTP $code"

# 2) Expired/garbage access token but valid refresh → middleware should
#    refresh and serve the page (200), NOT redirect to login (307).
EXPIRED="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ4Iiwicm9sZSI6IlRFQUNIRVIiLCJleHAiOjF9.x"
echo -n "Expired token + refresh → /uz/dashboard: "
HDRS=$(curl -s -D - -o /dev/null -H "Cookie: bilgim_access_token=$EXPIRED; bilgim_refresh_token=$REFRESH" "$WEB/uz/dashboard")
echo "$HDRS" | head -1
echo "$HDRS" | grep -i "location:" || echo "  (no redirect — session refreshed)"
echo "$HDRS" | grep -i "set-cookie: bilgim_access_token" >/dev/null && echo "  ✓ new access cookie set by middleware" || echo "  ✗ no refreshed cookie"

echo "EMAIL=$EMAIL"
