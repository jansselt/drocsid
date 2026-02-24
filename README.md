# Drocsid

> **This project was built with AI assistance (Claude, Anthropic).** You are free to use, study, and modify this software for any noncommercial purpose. **No one may sell, commercialize, or profit from this software or any derivative of it.** See [LICENSE](LICENSE) for full terms.

A self-hosted Discord alternative built with Rust and React. Designed for communities that want full control over their communication platform.

## Why This Exists

Discord's new age verification system was the last straw for us. As adults, we have privacy concerns with handing over government IDs and biometric data just to chat with friends. This project is not intended to circumvent any legal requirements — it's simply an alternative for people who want more control over their data. So we built our own.

This project was built primarily with AI assistance by people with day jobs. We're not a company, we're not trying to build a product — we just wanted to move our community off Discord as quickly as possible.

We'll keep updating things as we can, but this is a side project and always will be. If you want to submit ideas as issues, we're happy to look at them and implement what makes sense. If someone out there wants to take this and build something better — please do. We'll probably be your first adopters. The only goal here is to make leaving Discord easier for everyone.

> **Use at your own risk.** This is a work in progress built by hobbyists, not security professionals. It has not been audited, pen-tested, or hardened for production use. There will be bugs. There will be missing features. Do not use this for anything where security or uptime actually matters. If you self-host this, you are solely responsible for your instance, your users' data, and compliance with any applicable laws (GDPR, etc.). We make no guarantees about data security, availability, or fitness for any purpose — see the [LICENSE](LICENSE) for the full disclaimer.

## Features

- **Real-time messaging** with WebSocket gateway (message grouping, editing, deletion, pins)
- **Servers & channels** with text and voice channel types
- **Permission system** with role-based bitfield permissions and per-channel overrides
- **Voice & video** calls via LiveKit (mute, deafen, screen share)
- **File uploads** via S3-compatible storage (MinIO)
- **Reactions** with quick emoji picker
- **Markdown** rendering in messages
- **Direct messages** and group DMs
- **Friend system** with requests, blocks
- **Threads** branching off messages
- **Full-text search** powered by PostgreSQL tsvector
- **Invites** with configurable expiry and usage limits
- **Bans & kicks** with audit log
- **Webhooks** for external integrations
- **GIF search** via Giphy (bring your own API key)
- **Password reset** via email (Resend API)
- **Desktop app** via Tauri v2 with system tray and native notifications
- **User presence** (online/idle/dnd/offline) with automatic idle detection
- **Member sidebar** grouped by hoisted roles with status indicators
- **Quick switcher** (Ctrl+K) to jump between servers, channels, and DMs
- **Virtualized message list** for smooth scrolling with large histories

## Architecture

```
drocsid/
├── server/          # Rust backend (Axum + Tokio)
│   └── src/
│       ├── api/     # REST route handlers
│       ├── db/      # SQLx queries + migrations
│       ├── gateway/ # WebSocket connection manager
│       ├── services/# Auth, permissions
│       └── types/   # Entities, events, permissions
├── app/             # React frontend (Vite + TypeScript)
│   ├── src/
│   │   ├── api/     # REST client + gateway connection
│   │   ├── stores/  # Zustand state management
│   │   └── components/
│   └── src-tauri/   # Tauri v2 desktop app (Rust)
├── migrations/      # PostgreSQL migrations
├── config/          # TOML configuration
└── docker/          # Docker Compose for infrastructure
```

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | Rust, Axum 0.8, Tokio |
| Database | PostgreSQL 17 (SQLx) |
| Cache/PubSub | Redis 7 |
| Voice/Video | LiveKit |
| File Storage | MinIO (S3-compatible) |
| Frontend | React 19, TypeScript, Vite |
| State | Zustand |
| Styling | CSS custom properties (no frameworks) |
| Virtualization | react-virtuoso |

## Prerequisites

- **Rust** (stable, 2024 edition) — [install via rustup](https://rustup.rs/)
- **Node.js** >= 18 and **npm** (or **pnpm**) — [install via nvm](https://github.com/nvm-sh/nvm) or your package manager
- **Docker** and **Docker Compose** — for PostgreSQL, Redis, MinIO, and LiveKit

Verify your setup:

```bash
rustc --version   # 1.82+ recommended
node --version    # 18+
docker --version
docker compose version
```

## Getting Started

### 1. Clone the repo

```bash
git clone git@github.com:jansselt/drocsid.git
cd drocsid
```

### 2. Start infrastructure services

This spins up PostgreSQL, Redis, MinIO (object storage), and LiveKit (voice/video):

```bash
docker compose -f docker/docker-compose.yml up -d
```

Verify everything is healthy:

```bash
docker compose -f docker/docker-compose.yml ps
```

You should see all services running. The MinIO init container will create the uploads bucket and exit — that's normal.

**Service ports:**

| Service | Port | Purpose |
|---|---|---|
| PostgreSQL | 5432 | Database |
| Redis | 6379 | Cache |
| MinIO API | 9000 | File uploads |
| MinIO Console | 9001 | Storage admin UI |
| LiveKit | 7880 | Voice/video signaling (WebSocket) |
| LiveKit | 7881 | TURN/TCP media relay |
| LiveKit | 7882/udp | WebRTC media transport |

### 3. Build and run the backend

```bash
cd server
cargo build
cargo run
```

On first run, the server will automatically apply all database migrations from the `migrations/` directory.

The server starts on **http://localhost:8080** by default.

You should see output like:

```
INFO Starting Drocsid server
INFO Database connected and migrations applied
INFO Redis connected
WARN S3 not configured — file uploads disabled
INFO Server listening addr=0.0.0.0:8080
```

The S3 warning is expected if you haven't configured the `[s3]` section yet (see [Configuration](#configuration) below).

### 4. Install frontend dependencies and start the dev server

In a separate terminal:

```bash
cd app
npm install
npm run dev
```

The frontend starts on **http://localhost:5174**.

### 5. Use the app

1. Open **http://localhost:5174** in your browser
2. Register a new account
3. Create a server
4. Start chatting

To test with multiple users, open a second browser or incognito window and register another account.

## Configuration

The backend loads configuration from `config/default.toml` with optional local overrides in `config/local.toml` (gitignored) and environment variable overrides using the `DROCSID__` prefix (double underscore as separator).

### config/default.toml

```toml
[server]
host = "0.0.0.0"
port = 8080

[database]
url = "postgres://drocsid:drocsid@localhost:5432/drocsid"
max_connections = 20

[redis]
url = "redis://localhost:6379"

[auth]
jwt_secret = "change-me-in-production"
access_token_ttl_secs = 900        # 15 minutes
refresh_token_ttl_secs = 2592000   # 30 days

[instance]
domain = "localhost:8080"
name = "Drocsid Dev"

[livekit]
url = "ws://localhost:7880"
public_url = "ws://localhost:7880"
api_key = "devkey"
api_secret = "devsecret"
```

### Local overrides (`config/local.toml`)

To customize settings without modifying tracked files, create `config/local.toml` with just the sections you need — it overrides `default.toml` and is gitignored:

```toml
[gif]
provider = "giphy"
api_key = "your-giphy-api-key"

[email]
resend_api_key = "re_your_api_key_here"
from_address = "YourApp <noreply@yourdomain.com>"
```

### External access and voice

If you're exposing Drocsid externally (e.g., via Cloudflare Tunnel), note that voice/video requires direct UDP access. The HTTP API and WebSocket gateway work fine through a tunnel, but LiveKit needs ports forwarded on your router:

| Port | Protocol | Purpose |
|---|---|---|
| 7880 | TCP | LiveKit signaling (WebSocket) |
| 7881 | TCP | TURN relay fallback |
| 7882 | UDP | WebRTC media transport |

Point a separate subdomain (e.g., `voice.yourdomain.com`) at your public IP and update the config:

```toml
[livekit]
url = "ws://localhost:7880"
public_url = "wss://voice.yourdomain.com:7880"
```

The `url` is internal (server-to-LiveKit), `public_url` is what clients connect to.

### Optional: File uploads (S3/MinIO)

Add this section to enable file uploads:

```toml
[s3]
endpoint = "http://localhost:9000"
region = "us-east-1"
bucket = "drocsid-uploads"
access_key = "minioadmin"
secret_key = "minioadmin"
public_url = "http://localhost:9000/drocsid-uploads"
```

### Optional: Email (password reset)

Password reset emails are sent via [Resend](https://resend.com/). To enable:

1. Create an account at [resend.com](https://resend.com/)
2. Add and verify your domain at [resend.com/domains](https://resend.com/domains) (Resend will provide DNS records to add — if you use Cloudflare, it can auto-configure them)
3. Get your API key from [resend.com/api-keys](https://resend.com/api-keys)
4. Add the config:

```toml
[email]
resend_api_key = "re_your_api_key_here"
from_address = "YourApp <noreply@yourdomain.com>"
reset_token_ttl_secs = 1800  # optional, default 30 minutes
```

Or via environment variables:

```bash
DROCSID__EMAIL__RESEND_API_KEY=re_your_api_key_here
DROCSID__EMAIL__FROM_ADDRESS="YourApp <noreply@yourdomain.com>"
```

The `from_address` domain must match a verified domain in Resend. Without this configuration, the password reset feature is disabled and the endpoint returns a 500 error.

### Optional: GIF integration

Get a free API key from [Giphy Developers](https://developers.giphy.com/) and add it:

```toml
[gif]
provider = "giphy"
api_key = "your-giphy-api-key"
rating = "pg-13"
```

### Environment variable overrides

Any config value can be overridden via environment variables:

```bash
DROCSID__AUTH__JWT_SECRET=my-secret cargo run
DROCSID__DATABASE__URL=postgres://user:pass@host:5432/db cargo run
```

### Frontend environment variables

The frontend connects to the backend via two environment variables (with sensible defaults):

| Variable | Default | Purpose |
|---|---|---|
| `VITE_API_URL` | `http://localhost:8080/api/v1` | REST API base URL |
| `VITE_WS_URL` | `ws://localhost:8080` | WebSocket gateway URL |

To override, create `app/.env.local`:

```
VITE_API_URL=http://your-server:8080/api/v1
VITE_WS_URL=ws://your-server:8080
```

## Desktop App (Tauri)

Drocsid includes a Tauri v2 desktop application that wraps the web frontend with system tray support and native notifications.

### Building locally

```bash
cd app
npm install
npm run tauri -- build
```

The built packages will be in `app/src-tauri/target/release/bundle/`:
- `rpm/Drocsid-*.x86_64.rpm` (Fedora/RHEL)
- `deb/Drocsid_*_amd64.deb` (Debian/Ubuntu)

Install with your package manager:

```bash
# Fedora/RHEL
sudo dnf install app/src-tauri/target/release/bundle/rpm/Drocsid-*.x86_64.rpm

# Debian/Ubuntu
sudo dpkg -i app/src-tauri/target/release/bundle/deb/Drocsid_*_amd64.deb
```

### System dependencies (Linux)

Building Tauri on Linux requires these development libraries:

```bash
# Debian/Ubuntu
sudo apt-get install -y libgtk-3-dev libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf pkg-config

# Fedora
sudo dnf install gtk3-devel webkit2gtk4.1-devel libappindicator-gtk3-devel librsvg2-devel patchelf pkg-config
```

### CI/CD

The `build-desktop.yml` workflow automatically builds the desktop app:

- **Every push to `main`**: creates/updates a rolling `latest` prerelease on GitHub Releases
- **Version tags** (e.g., `git tag v0.1.0 && git push --tags`): creates a proper versioned release

Users can download the latest RPM or deb from the [Releases](../../releases) page.

**Self-hosted runner setup**: The runner machine needs the system dependencies listed above installed manually (the workflow verifies they're present but does not install them).

## Development

### Backend

```bash
cd server

# Run with auto-reload (install cargo-watch first: cargo install cargo-watch)
cargo watch -x run

# Run with debug logging
RUST_LOG=debug cargo run

# Check for compile errors without building
cargo check
```

### Frontend

```bash
cd app

# Dev server with HMR
npm run dev

# Type check
npx tsc --noEmit

# Lint
npm run lint

# Production build
npm run build
```

### Database

Migrations are applied automatically on server startup. Migration files are in `migrations/` and run in filename order.

To connect to the database directly:

```bash
docker exec -it drocsid-postgres-1 psql -U drocsid
```

### Resetting everything

To wipe all data and start fresh:

```bash
docker compose -f docker/docker-compose.yml down -v
docker compose -f docker/docker-compose.yml up -d
```

The `-v` flag removes the persistent volumes (database, redis, file storage).

## Project Structure

### Backend modules

| Module | Purpose |
|---|---|
| `api/auth.rs` | Register, login, token refresh |
| `api/servers.rs` | Server CRUD, members, channels |
| `api/channels.rs` | Messages, typing, pins, attachments |
| `api/roles.rs` | Role CRUD, member role assignment, channel overrides |
| `api/bans.rs` | Bans, kicks, audit log |
| `api/invites.rs` | Invite creation, resolution, usage |
| `api/webhooks.rs` | Webhook CRUD and execution |
| `api/voice.rs` | LiveKit token generation |
| `api/gif.rs` | Giphy search proxy |
| `api/dms.rs` | Direct messages and group DMs |
| `api/relationships.rs` | Friend requests, blocks |
| `api/search.rs` | Full-text message search |
| `gateway/` | WebSocket connection lifecycle, event dispatch, presence, voice state |
| `services/auth.rs` | JWT generation/validation, password hashing, password reset |
| `services/email.rs` | Transactional email via Resend API |
| `services/permissions.rs` | Bitfield permission computation with channel overrides |
| `types/` | All shared types: entities, events, permission flags |

### Frontend stores

| Store | Purpose |
|---|---|
| `authStore` | JWT tokens, current user, login/register/logout |
| `serverStore` | Everything else: servers, channels, messages, members, presence, voice, DMs, relationships, threads, search, typing indicators, gateway event handlers |

### Key keyboard shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl+K` / `Cmd+K` | Open quick switcher |
| `Enter` | Send message |
| `Shift+Enter` | New line in message |
| `Escape` | Cancel editing / close modals |
| `Arrow keys` | Navigate quick switcher results |

## License

[PolyForm Noncommercial 1.0.0](LICENSE) — free to use, modify, and share for any noncommercial purpose. Commercial use is not permitted.
