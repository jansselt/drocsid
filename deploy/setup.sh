#!/usr/bin/env bash
#
# One-time setup for Drocsid production server.
# Run as root or with sudo.
#
set -euo pipefail

DEPLOY_DIR="/opt/drocsid"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# When run with sudo, user-installed tools (cargo, node) aren't on root's PATH.
# Inherit the invoking user's PATH so we can find them.
if [ -n "${SUDO_USER:-}" ]; then
    REAL_HOME=$(getent passwd "$SUDO_USER" | cut -d: -f6)
    for p in "$REAL_HOME/.cargo/bin" "$REAL_HOME/.nvm/versions/node"/*/bin; do
        [ -d "$p" ] && export PATH="$p:$PATH"
    done
fi

echo "==> Drocsid Server Setup"
echo ""

# ── Check prerequisites ──────────────────────────────────
MISSING=()
for cmd in docker cargo node npm nginx curl rsync; do
    if ! command -v "$cmd" &> /dev/null; then
        MISSING+=("$cmd")
    fi
done
if [ ${#MISSING[@]} -gt 0 ]; then
    echo "ERROR: Missing commands: ${MISSING[*]}"
    echo ""
    echo "Required software:"
    echo "  - Docker + Docker Compose  (docker.com)"
    echo "  - Rust toolchain           (rustup.rs)"
    echo "  - Node.js >= 18 + npm      (nvm)"
    echo "  - nginx                     (apt install nginx)"
    echo "  - curl, rsync              (apt install curl rsync)"
    exit 1
fi
echo "  All prerequisites found."

# ── Create system user ───────────────────────────────────
if ! id drocsid &>/dev/null; then
    echo "==> Creating 'drocsid' system user..."
    sudo useradd --system --shell /usr/sbin/nologin --home-dir "$DEPLOY_DIR" drocsid
else
    echo "  User 'drocsid' already exists."
fi

# ── Create directories ───────────────────────────────────
echo "==> Creating ${DEPLOY_DIR}..."
sudo mkdir -p "${DEPLOY_DIR}/web"
sudo chown -R "${RUNNER_USER}:${RUNNER_USER}" "$DEPLOY_DIR"

# ── Copy .env template ───────────────────────────────────
if [ ! -f "${DEPLOY_DIR}/.env" ]; then
    sudo cp "${SCRIPT_DIR}/.env.example" "${DEPLOY_DIR}/.env"
    sudo chown "${RUNNER_USER}:${RUNNER_USER}" "${DEPLOY_DIR}/.env"
    sudo chmod 600 "${DEPLOY_DIR}/.env"
    echo "  Copied .env.example to ${DEPLOY_DIR}/.env"
    echo "  >>> EDIT ${DEPLOY_DIR}/.env WITH REAL VALUES <<<"
else
    echo "  ${DEPLOY_DIR}/.env already exists, skipping."
fi

# ── Install systemd service ──────────────────────────────
echo "==> Installing systemd service..."
sudo cp "${SCRIPT_DIR}/drocsid-server.service" /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable drocsid-server
echo "  Service installed and enabled."

# ── Install nginx config ─────────────────────────────────
echo "==> Installing nginx configuration..."
sudo cp "${SCRIPT_DIR}/nginx/drocsid.conf" /etc/nginx/sites-available/drocsid
if [ ! -L /etc/nginx/sites-enabled/drocsid ]; then
    sudo ln -s /etc/nginx/sites-available/drocsid /etc/nginx/sites-enabled/drocsid
fi
# Remove default site if it exists
if [ -L /etc/nginx/sites-enabled/default ]; then
    sudo rm /etc/nginx/sites-enabled/default
fi
sudo nginx -t && sudo systemctl reload nginx
echo "  Nginx configured."

# ── Configure sudoers for deploy user ────────────────────
RUNNER_USER="${SUDO_USER:-$(whoami)}"
SUDOERS_FILE="/etc/sudoers.d/drocsid-deploy"
echo "==> Configuring passwordless sudo for '${RUNNER_USER}'..."
sudo tee "$SUDOERS_FILE" > /dev/null <<EOF
# Allow the GitHub Actions runner user to manage Drocsid services
${RUNNER_USER} ALL=(ALL) NOPASSWD: /usr/bin/systemctl stop drocsid-server
${RUNNER_USER} ALL=(ALL) NOPASSWD: /usr/bin/systemctl start drocsid-server
${RUNNER_USER} ALL=(ALL) NOPASSWD: /usr/bin/systemctl restart drocsid-server
${RUNNER_USER} ALL=(ALL) NOPASSWD: /usr/bin/systemctl reload nginx
${RUNNER_USER} ALL=(ALL) NOPASSWD: /usr/bin/tee /etc/nginx/sites-available/drocsid
${RUNNER_USER} ALL=(ALL) NOPASSWD: /usr/sbin/nginx -t
EOF
sudo chmod 440 "$SUDOERS_FILE"
echo "  Sudoers configured for: ${RUNNER_USER}"

# ── Summary ──────────────────────────────────────────────
echo ""
echo "========================================="
echo "  Setup complete!"
echo "========================================="
echo ""
echo "Next steps:"
echo ""
echo "  1. Edit /opt/drocsid/.env with real passwords and secrets"
echo "     Generate secrets: openssl rand -hex 32"
echo ""
echo "  2. Install a GitHub Actions self-hosted runner:"
echo "     Go to your repo -> Settings -> Actions -> Runners -> New self-hosted runner"
echo "     Follow the instructions to install and configure it."
echo "     Then enable it as a service: ./svc.sh install && ./svc.sh start"
echo ""
echo "  3. Set GitHub repo secrets (Settings -> Secrets -> Actions):"
echo "     VITE_API_URL = https://your-tunnel-domain/api/v1"
echo "     VITE_WS_URL  = wss://your-tunnel-domain"
echo ""
echo "  4. Configure your Cloudflare Tunnel to point to localhost:80"
echo ""
echo "  5. Push to main to trigger the first deployment!"
echo ""
