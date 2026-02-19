Use 'bd' for task tracking

# AGENTS.md

Instructions for AI agents working on this codebase.

## Project Overview

Drocsid is a self-hosted Discord alternative. Rust backend (Axum), React + TypeScript frontend, PostgreSQL, Redis, MinIO, LiveKit. MIT licensed.

## Repository Structure

```
drocsid/
├── server/          # Rust backend (single crate, not a workspace)
│   └── src/
│       ├── main.rs, state.rs, config.rs, error.rs
│       ├── api/         # REST route handlers (one file per domain)
│       ├── db/          # SQLx runtime queries + pool setup
│       ├── gateway/     # WebSocket connection manager, events, presence
│       ├── services/    # Business logic (auth, permissions)
│       └── types/       # Entities, events, permission bitfields
├── app/             # React frontend (Vite + TypeScript)
│   └── src/
│       ├── api/         # REST client + gateway WebSocket connection
│       ├── stores/      # Zustand state management
│       ├── components/  # React components (layout/, chat/, common/, etc.)
│       └── types.ts     # Mirrors server types (manual sync)
├── migrations/      # PostgreSQL migrations (auto-applied on server start)
├── config/          # TOML configuration
└── docker/          # Docker Compose for infrastructure services
```

## Tech Decisions

| Decision | Choice | Rationale |
|---|---|---|
| SQL queries | Runtime SQLx (not compile-time macros) | No DATABASE_URL needed at build time |
| IDs | UUIDv7 everywhere | Time-sortable, good for message ordering |
| Gateway state | In-memory DashMap (not Redis) | Single instance for now, fast concurrent access |
| CSS | Custom properties, no frameworks | Matches gasts project patterns, full control |
| Type sync | Manual (types.ts mirrors server types) | Simple, no codegen tooling needed |
| Permissions | Bitfield u64 (Discord-style) | Efficient, well-understood model |

## Rust Backend Conventions

### Patterns
- **AppState**: Single struct with `PgPool`, `ConnectionManager`, `Arc<AppConfig>`, `Arc<GatewayState>`, `Option<S3Client>`. Cloned per request (pools are internally Arc'd).
- **Error handling**: `ApiError` enum with `thiserror`, implements `IntoResponse`. Return `Result<impl IntoResponse, ApiError>` from all handlers.
- **Route handlers**: One file per domain in `api/`. Handlers take `State<AppState>` + extractors.
- **Auth**: `AuthUser { user_id: Uuid }` extractor via `FromRequestParts`. JWT Bearer token.
- **Database**: Runtime `sqlx::query!` / `sqlx::query_as!` — never compile-time checked macros.

### Naming
- Modules: `snake_case.rs`
- Types: `PascalCase` (User, Server, ApiError)
- Functions: `snake_case` (create_user, handle_connection)
- Constants: `SCREAMING_SNAKE_CASE`
- JSON wire format: `snake_case` (via serde defaults)

### Error Codes
Follow Discord-style numeric codes: 40001 (Unauthorized), 40003 (Forbidden), 40004 (NotFound), 40000 (InvalidInput), 42901 (RateLimited), 50000 (Internal).

### Gateway Opcodes
| Op | Name | Direction |
|---|---|---|
| 0 | Dispatch | Server → Client |
| 1 | Heartbeat | Both |
| 2 | Identify | Client → Server |
| 3 | PresenceUpdate | Client → Server |
| 10 | Hello | Server → Client |
| 11 | HeartbeatAck | Server → Client |

### Adding a New API Endpoint
1. Add query functions in `db/queries.rs` (or relevant submodule)
2. Add handler in the appropriate `api/*.rs` file
3. Register the route in `api/mod.rs`
4. If it emits real-time events, publish to the gateway
5. Update frontend types.ts if new types are introduced

### Adding a New Gateway Event
1. Add event struct in `types/events.rs`
2. Add event name constant (e.g., `MESSAGE_CREATE`)
3. Dispatch from the relevant API handler via `gateway.broadcast()`
4. Add handler in frontend `stores/serverStore.ts` gateway event switch
5. Add TypeScript type in `types.ts`

## React Frontend Conventions

### Patterns
- **Stores**: Zustand with state + actions in one interface. Use selector functions to prevent re-renders: `useServerStore((s) => s.specificField)`.
- **Components**: Functional with hooks. Props interface at top of file. `useCallback` for event handlers passed as props.
- **API client**: Typed functions in `api/client.ts`. Auto token refresh on 401.
- **Gateway**: Singleton `GatewayConnection` class with auto-reconnect and exponential backoff.

### Naming
- Components: `PascalCase.tsx` (MessageList.tsx, UserPanel.tsx)
- Utilities/stores: `camelCase.ts` (client.ts, serverStore.ts)
- CSS: Co-located with component (`MessageList.tsx` + `MessageList.css`)
- Types/Interfaces: `PascalCase`
- Variables/functions: `camelCase`
- Event handlers: `handleX` or `onX`

### Styling Rules
- CSS custom properties only — no Tailwind, no CSS-in-JS, no component libraries
- All colors must use variables from `global.css` (e.g., `var(--bg-primary)`, `var(--text-muted)`)
- Dark theme is the only theme
- Font families: `--font-sans` (Inter), `--font-mono` (JetBrains Mono)

### Key CSS Variables
```css
--bg-darkest, --bg-base, --bg-primary, --bg-secondary, --bg-tertiary
--bg-hover, --bg-active
--text-primary, --text-secondary, --text-muted
--accent, --accent-hover (blue)
--danger, --danger-hover (red)
--success, --warning (green, yellow)
--border
```

## Configuration

- Backend config: `config/default.toml`
- Environment overrides: `DROCSID__SECTION__KEY` (double underscore separator)
- Frontend env: `VITE_API_URL`, `VITE_WS_URL` (defaults to localhost)
- Optional sections: `[s3]` for file uploads, `[gif]` for Giphy, `[livekit]` for voice/video

## Development

### Backend
```bash
cd server && cargo run              # Run server (migrations auto-apply)
cd server && cargo check            # Fast compile check
RUST_LOG=debug cargo run            # Debug logging
```

### Frontend
```bash
cd app && npm install && npm run dev   # Dev server with HMR
cd app && npx tsc --noEmit             # Type check
cd app && npm run build                # Production build
```

### Git Hooks (new clones)
```bash
cp hooks/* .git/hooks/     # Install commit-msg conventional commit enforcer
```

### Infrastructure
```bash
docker compose -f docker/docker-compose.yml up -d      # Start services
docker compose -f docker/docker-compose.yml down -v     # Reset everything
```

## Commit Messages

**All commits MUST use [Conventional Commits](https://www.conventionalcommits.org/) format.** This is enforced by a git hook and is required for automated versioning via release-please.

Format: `type(optional scope): description`

| Type | When to use |
|------|-------------|
| `feat` | New feature (bumps minor version) |
| `fix` | Bug fix (bumps patch version) |
| `perf` | Performance improvement |
| `refactor` | Code change that neither fixes a bug nor adds a feature |
| `docs` | Documentation only |
| `test` | Adding or updating tests |
| `chore` | Build process, dependencies, CI changes |
| `style` | Formatting, whitespace (no code change) |

For breaking changes, add `!` after the type: `feat!: remove legacy API`

Examples:
```
feat: add noise suppression for voice chat
fix: resolve memory leak in message list scroll handler
refactor(gateway): simplify heartbeat logic
chore: update Tauri dependencies
feat!: change authentication to OAuth2
```

**Do NOT** use freeform messages like "Update stuff" or "WIP". Every commit must have a valid type prefix.

## Things to Watch Out For

- **Types must stay in sync**: When adding/changing a server type in `types/entities.rs` or `types/events.rs`, update `app/src/types.ts` to match.
- **Instance ID**: All major entities have `instance_id`. Always use the local instance for new records. This is for future federation support.
- **Permission checks**: All endpoints that access server resources must check permissions via `services/permissions.rs`.
- **Gateway sequence numbers**: Events dispatched to clients must increment the sequence number. Don't skip or reuse.
- **No UI libraries**: Build UI from scratch with plain HTML elements + CSS custom properties. No Material UI, no Radix, no shadcn.
- **No compile-time SQLx**: We use runtime queries. Don't add `DATABASE_URL` to build or use `sqlx::query!` with compile-time checking.

## Landing the Plane (Session Completion)

**When ending a work session**, you MUST complete ALL steps below. Work is NOT complete until `git push` succeeds.

**MANDATORY WORKFLOW:**

1. **File issues for remaining work** - Create issues for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **PUSH TO REMOTE** - This is MANDATORY:
   ```bash
   git pull --rebase
   bd sync
   git push
   git status  # MUST show "up to date with origin"
   ```
5. **Clean up** - Clear stashes, prune remote branches
6. **Verify** - All changes committed AND pushed
7. **Hand off** - Provide context for next session

**CRITICAL RULES:**
- Work is NOT complete until `git push` succeeds
- NEVER stop before pushing - that leaves work stranded locally
- NEVER say "ready to push when you are" - YOU must push
- If push fails, resolve and retry until it succeeds
