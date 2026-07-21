#!/usr/bin/env bash
# Run the EduBridge dev stack without the Expo mobile app.
# Mobile is excluded because Expo requires network access to api.expo.dev
# which is unavailable in this environment.
set -euo pipefail
cd "$(dirname "$0")/.."
exec pnpm exec turbo run dev --parallel --continue --filter='!@edubridge/mobile'
