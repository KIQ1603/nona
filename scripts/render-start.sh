#!/usr/bin/env bash
# One container, two processes: the API and the worker (email, Zalo OTP, payment reconciliation).
# Used on Render's free plan, which has no background workers. Run from the repository root.
set -euo pipefail

export API_PORT="${PORT:-10000}"
# the worker calls the API's internal jobs over loopback
export INTERNAL_API_URL="http://127.0.0.1:${API_PORT}"

echo "[start] applying database migrations"
pnpm --filter @nona/database run migrate:deploy

# first admin + a sample customer on a fresh database (only when BOOTSTRAP_* are set; existing accounts are never changed)
if [ -n "${BOOTSTRAP_ADMIN_EMAIL:-}" ] || [ -n "${BOOTSTRAP_USER_EMAIL:-}" ]; then
  echo "[start] making sure the first accounts exist"
  pnpm --filter @nona/database run bootstrap:deploy
fi

node apps/worker/dist/main.js &
WORKER_PID=$!
node apps/api/dist/main.js &
API_PID=$!

stop() { kill "$WORKER_PID" "$API_PID" 2>/dev/null || true; }
trap stop TERM INT

# if either process dies, stop the other and exit so the platform restarts the whole service
while kill -0 "$WORKER_PID" 2>/dev/null && kill -0 "$API_PID" 2>/dev/null; do
  sleep 2
done
echo "[start] a process exited, stopping the service" >&2
stop
wait 2>/dev/null || true
exit 1
