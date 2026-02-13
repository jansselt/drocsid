#!/usr/bin/env bash
set -euo pipefail

# Ensure cargo and node are on PATH (they may not be in the runner service env)
for p in "$HOME/.cargo/bin" "$HOME/.nvm/versions/node"/*/bin; do
    [ -d "$p" ] && export PATH="$p:$PATH"
done
# Also load nvm if available (sets up node version)
[ -s "$HOME/.nvm/nvm.sh" ] && source "$HOME/.nvm/nvm.sh"

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DEPLOY_DIR="/opt/drocsid"
ENV_FILE="${DEPLOY_DIR}/.env"
COMPOSE_FILE="${REPO_DIR}/docker/docker-compose.prod.yml"

echo "==> Deploying Drocsid from ${REPO_DIR}"

# ── Validate ─────────────────────────────────────────────
if [ ! -f "$ENV_FILE" ]; then
    echo "ERROR: ${ENV_FILE} not found. Copy deploy/.env.example and fill in values."
    exit 1
fi

# Source env for frontend build vars if not already set
if [ -z "${VITE_API_URL:-}" ] || [ -z "${VITE_WS_URL:-}" ]; then
    # shellcheck disable=SC1090
    set -a; source "$ENV_FILE"; set +a
fi

# ── Infrastructure ───────────────────────────────────────
echo "==> Starting infrastructure services..."
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" up -d

# ── Build Backend ────────────────────────────────────────
echo "==> Building Rust backend..."
cargo build --release --manifest-path "${REPO_DIR}/server/Cargo.toml"

# ── Build Frontend ───────────────────────────────────────
echo "==> Building frontend..."
cd "${REPO_DIR}/app"
npm install --prefer-offline
VITE_API_URL="${VITE_API_URL}" VITE_WS_URL="${VITE_WS_URL}" npm run build
cd "$REPO_DIR"

# ── Deploy ───────────────────────────────────────────────
echo "==> Stopping drocsid-server..."
sudo systemctl stop drocsid-server || true

echo "==> Copying binary and frontend..."
cp "${REPO_DIR}/server/target/release/drocsid-server" "${DEPLOY_DIR}/drocsid-server"
rsync -a --delete "${REPO_DIR}/app/dist/" "${DEPLOY_DIR}/web/"

echo "==> Updating nginx config..."
sudo cp "${REPO_DIR}/deploy/nginx/drocsid.conf" /etc/nginx/sites-available/drocsid
sudo nginx -t

echo "==> Starting drocsid-server..."
sudo systemctl start drocsid-server
sudo systemctl reload nginx

# ── Health Check ─────────────────────────────────────────
echo "==> Waiting for server to start..."
for i in $(seq 1 15); do
    if curl -sf http://127.0.0.1:9847/api/v1/health > /dev/null 2>&1; then
        echo "==> Health check passed!"
        exit 0
    fi
    sleep 2
done

echo "ERROR: Health check failed after 30 seconds"
echo "Check logs: journalctl -u drocsid-server -n 50"
exit 1
