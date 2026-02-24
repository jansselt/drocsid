# Drocsid Bot & Webhook Documentation

This guide covers everything you need to know about building bots and integrations for Drocsid using the webhook system.

---

## Table of Contents

1. [Overview](#overview)
2. [Concepts](#concepts)
3. [Quick Start](#quick-start)
4. [Webhook API Reference](#webhook-api-reference)
5. [Gateway (WebSocket) API Reference](#gateway-websocket-api-reference)
6. [Bot User Accounts](#bot-user-accounts)
7. [Permissions](#permissions)
8. [Message Format](#message-format)
9. [Rate Limits & Constraints](#rate-limits--constraints)
10. [Example Bots](#example-bots)
11. [Future Roadmap](#future-roadmap)

---

## Overview

Drocsid supports two types of bot integrations:

| Type | Auth | Capabilities | Use Case |
|------|------|-------------|----------|
| **Webhook** | Token in URL (no session) | Send messages to a specific channel | CI/CD notifications, alerts, simple integrations |
| **Bot User** | Session token (same as users) | Full API access — messages, reactions, channels, presence | Interactive bots, moderation, games |

**Webhooks** are the simplest integration — create one in a channel, POST to the URL, and a message appears. No WebSocket connection needed.

**Bot User Accounts** have `bot: true` on their user record and authenticate the same way regular users do (session token via `/auth/login`). They can connect to the gateway WebSocket and receive real-time events.

---

## Concepts

### Webhooks

A webhook is a channel-scoped integration that allows external services to send messages. Each webhook has:

- **ID** — Unique UUID
- **Name** — Display name shown as the message author (1-80 characters)
- **Token** — 68-character secret used to authenticate execution requests
- **Channel** — The channel messages are posted to
- **Server** — The server the channel belongs to
- **Creator** — The user who created the webhook (messages are attributed to this user internally)
- **Avatar URL** — Optional default avatar for the webhook

### Bot Users

A bot user is a regular user account with the `bot` flag set to `true`. Bot messages display with a `BOT` tag in the UI. Bot users:

- Authenticate via `/auth/login` with email/password
- Connect to the WebSocket gateway to receive events
- Can call any API endpoint a regular user can
- Are shown with a bot badge in the member list

---

## Quick Start

### Webhook Quick Start

**1. Create a webhook** (requires `MANAGE_WEBHOOKS` permission):

```bash
curl -X POST https://your-drocsid.com/api/v1/channels/{channel_id}/webhooks \
  -H "Authorization: Bearer {your_session_token}" \
  -H "Content-Type: application/json" \
  -d '{"name": "My Bot"}'
```

Response:
```json
{
  "id": "018e1a2b-3c4d-7000-8000-000000000001",
  "server_id": "018e1a2b-0000-7000-8000-000000000001",
  "channel_id": "018e1a2b-1111-7000-8000-000000000001",
  "creator_id": "018e1a2b-2222-7000-8000-000000000001",
  "name": "My Bot",
  "avatar_url": null,
  "token": "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-ABCD",
  "created_at": "2026-02-13T12:00:00Z"
}
```

**2. Send a message** (no auth header needed — token is in the URL):

```bash
curl -X POST https://your-drocsid.com/api/v1/webhooks/{webhook_id}/{token} \
  -H "Content-Type: application/json" \
  -d '{"content": "Hello from my bot!"}'
```

That's it. The message appears in the channel with the webhook's name and avatar, tagged as a bot.

**3. Customize the message author** (optional):

```bash
curl -X POST https://your-drocsid.com/api/v1/webhooks/{webhook_id}/{token} \
  -H "Content-Type: application/json" \
  -d '{
    "content": "Build #42 passed!",
    "username": "CI Pipeline",
    "avatar_url": "https://example.com/ci-icon.png"
  }'
```

The `username` and `avatar_url` fields override the webhook defaults for that single message.

### Bot User Quick Start

**1. Create the bot account** (currently done via direct database insert or registration):

```sql
INSERT INTO users (id, instance_id, username, email, password_hash, bot)
VALUES (gen_random_uuid(), '{instance_id}', 'my-bot', 'bot@example.com', '{bcrypt_hash}', true);
```

Or register normally via `/auth/register` and update the `bot` flag:

```sql
UPDATE users SET bot = true WHERE username = 'my-bot';
```

**2. Authenticate:**

```bash
curl -X POST https://your-drocsid.com/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email": "bot@example.com", "password": "bot-password"}'
```

Response:
```json
{
  "token": "session-token-here",
  "user": {
    "id": "...",
    "username": "my-bot",
    "bot": true,
    ...
  }
}
```

**3. Connect to the WebSocket gateway:**

```
wss://your-drocsid.com/gateway
```

Send an IDENTIFY payload:
```json
{
  "op": "identify",
  "d": {
    "token": "session-token-here"
  }
}
```

You'll receive a READY event with servers, channels, relationships, etc. From there, listen for events like `MESSAGE_CREATE` and call REST API endpoints as needed.

**4. Send a message:**

```bash
curl -X POST https://your-drocsid.com/api/v1/channels/{channel_id}/messages \
  -H "Authorization: Bearer {session_token}" \
  -H "Content-Type: application/json" \
  -d '{"content": "Hello! I am a bot."}'
```

---

## Webhook API Reference

All webhook management endpoints require authentication and the `MANAGE_WEBHOOKS` permission on the channel.

### Create Webhook

```
POST /api/v1/channels/{channel_id}/webhooks
```

**Request Body:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Display name (1-80 characters) |

**Response:** `200 OK` — Full webhook object including `token`

> **Important:** Save the token from the response. It cannot be retrieved again — only the webhook creator sees it at creation time.

### List Channel Webhooks

```
GET /api/v1/channels/{channel_id}/webhooks
```

**Response:** `200 OK` — Array of webhook objects

### Update Webhook

```
PATCH /api/v1/channels/{channel_id}/webhooks/{webhook_id}
```

**Request Body:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | No | New display name |
| `channel_id` | UUID | No | Move webhook to a different channel |

**Response:** `200 OK` — Updated webhook object

### Delete Webhook

```
DELETE /api/v1/channels/{channel_id}/webhooks/{webhook_id}
```

**Response:** `204 No Content`

### Execute Webhook

```
POST /api/v1/webhooks/{webhook_id}/{token}
```

**No authentication header required** — the token in the URL is the credential.

**Request Body:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `content` | string | Yes | Message text (1-4000 characters) |
| `username` | string | No | Override the webhook display name for this message |
| `avatar_url` | string | No | Override the webhook avatar for this message |

**Response:** `204 No Content`

The message is broadcast to all connected clients via the WebSocket gateway as a `MESSAGE_CREATE` event with `author.bot = true`.

---

## Gateway (WebSocket) API Reference

Bot users connect to the gateway the same way regular users do. This section covers the gateway protocol.

### Connecting

```
wss://your-drocsid.com/gateway
```

### Handshake Flow

1. **Client connects** via WebSocket
2. **Server sends** `HELLO` with heartbeat interval:
   ```json
   {"op": "hello", "d": {"heartbeat_interval": 41250}}
   ```
3. **Client sends** `IDENTIFY`:
   ```json
   {"op": "identify", "d": {"token": "your-session-token"}}
   ```
4. **Server sends** `READY` with initial state:
   ```json
   {
     "op": "dispatch",
     "t": "READY",
     "d": {
       "user": { ... },
       "servers": [ ... ],
       "channels": [ ... ],
       "relationships": [ ... ],
       "presences": [ ... ],
       "dm_channels": [ ... ]
     }
   }
   ```

### Heartbeating

Send a heartbeat every `heartbeat_interval` milliseconds (default 41250ms):

```json
{"op": "heartbeat"}
```

Server responds with:
```json
{"op": "heartbeat_ack"}
```

If you miss heartbeats, the server will disconnect you.

### Key Events for Bots

| Event | Description |
|-------|-------------|
| `MESSAGE_CREATE` | A message was sent in a channel |
| `MESSAGE_UPDATE` | A message was edited |
| `MESSAGE_DELETE` | A message was deleted |
| `SERVER_MEMBER_ADD` | A user joined a server |
| `SERVER_MEMBER_REMOVE` | A user left/was removed from a server |
| `PRESENCE_UPDATE` | A user's online status changed |
| `CHANNEL_CREATE` | A new channel was created |
| `CHANNEL_UPDATE` | A channel was modified |
| `CHANNEL_DELETE` | A channel was deleted |
| `RELATIONSHIP_UPDATE` | A friend request or relationship changed |
| `VOICE_STATE_UPDATE` | A user joined/left/muted in voice |
| `TYPING_START` | A user started typing |

### Event Payload Format

All dispatch events follow this structure:

```json
{
  "op": "dispatch",
  "t": "MESSAGE_CREATE",
  "d": {
    "message": {
      "id": "...",
      "channel_id": "...",
      "author_id": "...",
      "content": "Hello!",
      "created_at": "2026-02-13T12:00:00Z",
      ...
    },
    "author": {
      "id": "...",
      "username": "someone",
      "bot": false,
      ...
    }
  }
}
```

---

## Bot User Accounts

### User Object

Bot users have the same schema as regular users with `bot: true`:

```json
{
  "id": "018e1a2b-...",
  "username": "my-bot",
  "display_name": "My Cool Bot",
  "avatar_url": "https://...",
  "bio": "I do cool things",
  "status": "online",
  "custom_status": null,
  "bot": true
}
```

### Capabilities

Bot users can do everything a regular user can via the REST API:

- **Messages:** Send, edit, delete messages in channels they have access to
- **Reactions:** Add and remove reactions
- **Channels:** Read channel info, list messages, search
- **Servers:** Join via invite, view members, view roles
- **Presence:** Appear online when connected to the gateway
- **Voice:** Join voice channels (if applicable)
- **DMs:** Send and receive direct messages
- **Threads:** Create and participate in threads
- **File uploads:** Upload attachments via presigned URLs

### REST API Endpoints

Bot users use the same endpoints as regular users. Here are the most useful ones:

#### Messages

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/channels/{id}/messages` | List messages (supports `?limit=` and `?before=`) |
| POST | `/channels/{id}/messages` | Send a message |
| PATCH | `/channels/{id}/messages/{msg_id}` | Edit a message |
| DELETE | `/channels/{id}/messages/{msg_id}` | Delete a message |

#### Reactions

| Method | Endpoint | Description |
|--------|----------|-------------|
| PUT | `/channels/{id}/messages/{msg_id}/reactions/{emoji}` | Add a reaction |
| DELETE | `/channels/{id}/messages/{msg_id}/reactions/{emoji}` | Remove your reaction |

#### Channels

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/channels/{id}` | Get channel info |
| GET | `/channels/{id}/pins` | Get pinned messages |

#### Servers

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/servers/{id}` | Get server info |
| GET | `/servers/{id}/members` | List server members |

#### Users

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/users/@me` | Get your own user info |
| PATCH | `/users/@me` | Update display name, bio, avatar, status |

All requests require the `Authorization: Bearer {token}` header.

---

## Permissions

### Webhook Permissions

| Permission | Bit | Description |
|-----------|-----|-------------|
| `MANAGE_WEBHOOKS` | `1 << 29` | Create, list, edit, and delete webhooks in a channel |

This permission is checked against the user's roles and any channel-specific overrides. Server owners always have all permissions.

### Bot User Permissions

Bot users are subject to the same permission system as regular users. Their effective permissions are calculated from:

1. **Server-level roles** assigned to the bot
2. **Channel-level overrides** for those roles
3. **Server ownership** (if the bot somehow owns the server)

When adding a bot to a server, assign it a role with the permissions it needs. Common permission sets:

**Read-only bot:**
- `VIEW_CHANNELS` (1 << 10)
- `READ_MESSAGE_HISTORY` (1 << 16)

**Messaging bot:**
- All of the above, plus:
- `SEND_MESSAGES` (1 << 11)
- `EMBED_LINKS` (1 << 14)
- `ATTACH_FILES` (1 << 15)
- `ADD_REACTIONS` (1 << 6)

**Moderation bot:**
- All of the above, plus:
- `KICK_MEMBERS` (1 << 1)
- `BAN_MEMBERS` (1 << 2)
- `MANAGE_MESSAGES` (1 << 13)
- `MANAGE_CHANNELS` (1 << 4)

**Full permission bits reference:**

```
ADMINISTRATOR       = 1 << 0
KICK_MEMBERS        = 1 << 1
BAN_MEMBERS         = 1 << 2
MANAGE_SERVER       = 1 << 3
MANAGE_CHANNELS     = 1 << 4
MANAGE_ROLES        = 1 << 28
ADD_REACTIONS       = 1 << 6
VIEW_AUDIT_LOG      = 1 << 7
PRIORITY_SPEAKER    = 1 << 8
STREAM              = 1 << 9
VIEW_CHANNELS       = 1 << 10
SEND_MESSAGES       = 1 << 11
SEND_TTS            = 1 << 12
MANAGE_MESSAGES     = 1 << 13
EMBED_LINKS         = 1 << 14
ATTACH_FILES        = 1 << 15
READ_MESSAGE_HISTORY = 1 << 16
MENTION_EVERYONE    = 1 << 17
USE_EXTERNAL_EMOJIS = 1 << 18
CONNECT             = 1 << 20
SPEAK               = 1 << 21
MUTE_MEMBERS        = 1 << 22
DEAFEN_MEMBERS      = 1 << 23
MOVE_MEMBERS        = 1 << 24
CHANGE_NICKNAME     = 1 << 26
MANAGE_NICKNAMES    = 1 << 27
MANAGE_WEBHOOKS     = 1 << 29
MANAGE_EXPRESSIONS  = 1 << 30
CREATE_INSTANT_INVITE = 1 << 31
```

---

## Message Format

### Text Content

Messages support plain text up to 4000 characters. Content is rendered as-is in the client.

### Mentions

Mention users in message content with `<@user_id>`:

```json
{"content": "Hey <@018e1a2b-...>, check this out!"}
```

### Attachments

Bot users can send attachments via the presigned URL upload flow:

1. **Request an upload URL:**
   ```
   POST /channels/{channel_id}/upload-url
   {"filename": "image.png", "content_type": "image/png", "size_bytes": 12345}
   ```

2. **Upload the file** to the returned presigned URL via PUT

3. **Send the message** with the attachment path:
   ```
   POST /channels/{channel_id}/messages
   {"content": "Here's a file", "attachment_ids": ["returned-attachment-id"]}
   ```

Webhook-executed messages do not currently support attachments.

---

## Rate Limits & Constraints

| Constraint | Value |
|-----------|-------|
| Message content length | 1-4000 characters |
| Webhook name length | 1-80 characters |
| Webhook token length | 68 characters (auto-generated) |
| Max file upload size | 25 MB |

> **Note:** There are currently no enforced rate limits on webhook execution or API calls. Implement client-side throttling to be a good citizen.

---

## Example Bots

### Python: Simple Webhook Notification Bot

```python
"""Send a message to a Drocsid channel via webhook."""
import requests

WEBHOOK_URL = "https://your-drocsid.com/api/v1/webhooks/{webhook_id}/{token}"

def send_message(content: str, username: str | None = None):
    payload = {"content": content}
    if username:
        payload["username"] = username
    resp = requests.post(WEBHOOK_URL, json=payload)
    resp.raise_for_status()

# Usage
send_message("Deployment successful! v2.1.0 is live.", username="Deploy Bot")
```

### Python: Interactive Bot User with WebSocket

```python
"""A bot that responds to !ping with Pong!"""
import asyncio
import json
import aiohttp

API_BASE = "https://your-drocsid.com/api/v1"
GATEWAY_URL = "wss://your-drocsid.com/gateway"
EMAIL = "bot@example.com"
PASSWORD = "bot-password"

async def main():
    async with aiohttp.ClientSession() as session:
        # 1. Login
        async with session.post(f"{API_BASE}/auth/login", json={
            "email": EMAIL, "password": PASSWORD
        }) as resp:
            data = await resp.json()
            token = data["token"]
            bot_user_id = data["user"]["id"]

        headers = {"Authorization": f"Bearer {token}"}

        # 2. Connect to gateway
        async with session.ws_connect(GATEWAY_URL) as ws:
            # Wait for HELLO
            hello = await ws.receive_json()
            heartbeat_interval = hello["d"]["heartbeat_interval"] / 1000

            # Send IDENTIFY
            await ws.send_json({"op": "identify", "d": {"token": token}})

            # Wait for READY
            ready = await ws.receive_json()
            print(f"Bot is ready! Connected to {len(ready['d']['servers'])} servers")

            # Start heartbeat task
            async def heartbeat():
                while True:
                    await asyncio.sleep(heartbeat_interval)
                    await ws.send_json({"op": "heartbeat"})

            asyncio.create_task(heartbeat())

            # 3. Listen for events
            async for msg in ws:
                if msg.type == aiohttp.WSMsgType.TEXT:
                    event = json.loads(msg.data)

                    if event.get("t") == "MESSAGE_CREATE":
                        message = event["d"]["message"]
                        author = event["d"]["author"]

                        # Don't respond to ourselves
                        if author["id"] == bot_user_id:
                            continue

                        # Respond to !ping
                        if message["content"].strip() == "!ping":
                            async with session.post(
                                f"{API_BASE}/channels/{message['channel_id']}/messages",
                                headers=headers,
                                json={"content": "Pong!"}
                            ) as resp:
                                pass

asyncio.run(main())
```

### Node.js: Webhook Bot

```javascript
/** Send a message to a Drocsid channel via webhook. */
const WEBHOOK_URL = 'https://your-drocsid.com/api/v1/webhooks/{webhook_id}/{token}';

async function sendMessage(content, username) {
  const body = { content };
  if (username) body.username = username;

  const resp = await fetch(WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!resp.ok) throw new Error(`Webhook failed: ${resp.status}`);
}

// Usage
await sendMessage('Build #42 passed!', 'CI Bot');
```

### Node.js: Interactive Bot User

```javascript
/** A bot that responds to !hello */
import WebSocket from 'ws';

const API_BASE = 'https://your-drocsid.com/api/v1';
const GATEWAY_URL = 'wss://your-drocsid.com/gateway';

async function main() {
  // 1. Login
  const loginResp = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'bot@example.com', password: 'bot-password' }),
  });
  const { token, user } = await loginResp.json();
  const botId = user.id;

  // 2. Connect to gateway
  const ws = new WebSocket(GATEWAY_URL);

  ws.on('message', async (raw) => {
    const event = JSON.parse(raw);

    if (event.op === 'hello') {
      // Send identify
      ws.send(JSON.stringify({ op: 'identify', d: { token } }));

      // Start heartbeat
      setInterval(() => {
        ws.send(JSON.stringify({ op: 'heartbeat' }));
      }, event.d.heartbeat_interval);
    }

    if (event.t === 'READY') {
      console.log(`Bot ready! ${event.d.servers.length} servers`);
    }

    if (event.t === 'MESSAGE_CREATE') {
      const { message, author } = event.d;

      if (author.id === botId) return; // ignore self

      if (message.content.trim() === '!hello') {
        await fetch(`${API_BASE}/channels/${message.channel_id}/messages`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ content: `Hello, ${author.username}!` }),
        });
      }
    }
  });
}

main();
```

### Bash: One-liner Webhook

```bash
# Send a quick message from the command line
curl -s -X POST "https://your-drocsid.com/api/v1/webhooks/WEBHOOK_ID/WEBHOOK_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"content": "Server restarted successfully"}'
```

### GitHub Actions: Deploy Notification

```yaml
# .github/workflows/deploy.yml
- name: Notify Drocsid
  if: success()
  run: |
    curl -s -X POST "${{ secrets.DROCSID_WEBHOOK_URL }}" \
      -H "Content-Type: application/json" \
      -d "{
        \"content\": \"Deployed **${{ github.repository }}** to production (commit ${{ github.sha }})\",
        \"username\": \"GitHub Actions\"
      }"
```

---

## Audit Logging

All webhook management operations are recorded in the server's audit log:

| Action | When |
|--------|------|
| `webhook_create` | A webhook is created |
| `webhook_update` | A webhook's name or channel is changed |
| `webhook_delete` | A webhook is deleted |

Audit logs can be viewed by users with the `VIEW_AUDIT_LOG` permission via the server settings UI or the API:

```
GET /api/v1/servers/{server_id}/audit-log
```

---

## Security Considerations

- **Treat webhook tokens like passwords.** Anyone with the token can post messages to your channel. If a token is compromised, delete the webhook and create a new one.
- **Webhook execution requires no authentication** beyond the token in the URL. Do not expose webhook URLs in public repositories or client-side code.
- **Bot user passwords** should be strong and unique. Consider using environment variables for credentials.
- **Bot users are subject to the same permission system** as regular users. Follow the principle of least privilege — only grant the permissions your bot actually needs.

---

## Frontend Webhook Management

Server administrators can manage webhooks through the Drocsid UI:

1. Navigate to **Server Settings** (gear icon next to server name)
2. Select the channel you want to configure
3. **Webhooks** section allows creating, viewing, and deleting webhooks
4. The webhook token is shown only at creation time — copy it immediately

Requires the `MANAGE_WEBHOOKS` permission.

---

## Future Roadmap

The following bot features are planned or under consideration:

- **Slash commands** — Register custom commands that appear in the message input autocomplete
- **Bot application registry** — Create and manage bot applications through a developer portal
- **OAuth2 bot authorization** — Add bots to servers via an authorization flow instead of manual setup
- **Interaction events** — Button clicks, select menus, and modal submissions
- **Message components** — Buttons, dropdowns, and action rows in bot messages
- **Embeds** — Rich message embeds with fields, thumbnails, and colors
- **Rate limiting** — Per-webhook and per-bot rate limits to prevent abuse
- **Bot-specific API endpoints** — Dedicated endpoints for bot management without direct DB access
