use chrono::{DateTime, Utc};
use sqlx::PgPool;
use uuid::Uuid;

use crate::types::entities::{
    Attachment, AuditAction, AuditLogEntry, Ban, Channel, ChannelOverride, ChannelType, DmMember,
    Invite, Message, Reaction, ReadState, Relationship, RelationshipType, RegistrationCode, Role,
    SearchResult, Server, ServerMember, Session, ThreadMetadata, User, Webhook,
};

// ── Instance ───────────────────────────────────────────

pub async fn ensure_local_instance(pool: &PgPool, domain: &str) -> Result<Uuid, sqlx::Error> {
    let row: (Uuid,) = sqlx::query_as(
        r#"
        INSERT INTO instances (domain, is_local)
        VALUES ($1, true)
        ON CONFLICT (domain) DO UPDATE SET domain = $1
        RETURNING id
        "#,
    )
    .bind(domain)
    .fetch_one(pool)
    .await?;

    Ok(row.0)
}

// ── Users ──────────────────────────────────────────────

pub async fn create_user(
    pool: &PgPool,
    id: Uuid,
    instance_id: Uuid,
    username: &str,
    email: &str,
    password_hash: &str,
) -> Result<User, sqlx::Error> {
    sqlx::query_as::<_, User>(
        r#"
        INSERT INTO users (id, instance_id, username, email, password_hash)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id, instance_id, username, display_name, email, password_hash,
                  avatar_url, bio, status, custom_status, theme_preference, is_admin, bot, created_at, updated_at
        "#,
    )
    .bind(id)
    .bind(instance_id)
    .bind(username)
    .bind(email)
    .bind(password_hash)
    .fetch_one(pool)
    .await
}

pub async fn get_user_by_id(pool: &PgPool, id: Uuid) -> Result<Option<User>, sqlx::Error> {
    sqlx::query_as::<_, User>(
        r#"
        SELECT id, instance_id, username, display_name, email, password_hash,
               avatar_url, bio, status, custom_status, theme_preference, is_admin, bot, created_at, updated_at
        FROM users WHERE id = $1
        "#,
    )
    .bind(id)
    .fetch_optional(pool)
    .await
}

pub async fn get_user_by_email(pool: &PgPool, email: &str) -> Result<Option<User>, sqlx::Error> {
    sqlx::query_as::<_, User>(
        r#"
        SELECT id, instance_id, username, display_name, email, password_hash,
               avatar_url, bio, status, custom_status, theme_preference, is_admin, bot, created_at, updated_at
        FROM users WHERE email = $1
        "#,
    )
    .bind(email)
    .fetch_optional(pool)
    .await
}

pub async fn delete_user(pool: &PgPool, user_id: Uuid) -> Result<(), sqlx::Error> {
    sqlx::query("DELETE FROM users WHERE id = $1")
        .bind(user_id)
        .execute(pool)
        .await?;
    Ok(())
}

// ── Sessions ───────────────────────────────────────────

pub async fn create_session(
    pool: &PgPool,
    id: Uuid,
    user_id: Uuid,
    token_hash: &str,
    device_info: Option<&str>,
    expires_at: DateTime<Utc>,
) -> Result<Session, sqlx::Error> {
    sqlx::query_as::<_, Session>(
        r#"
        INSERT INTO sessions (id, user_id, token_hash, device_info, expires_at)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id, user_id, token_hash, device_info, expires_at, created_at
        "#,
    )
    .bind(id)
    .bind(user_id)
    .bind(token_hash)
    .bind(device_info)
    .bind(expires_at)
    .fetch_one(pool)
    .await
}

pub async fn get_session_by_token_hash(
    pool: &PgPool,
    token_hash: &str,
) -> Result<Option<Session>, sqlx::Error> {
    sqlx::query_as::<_, Session>(
        r#"
        SELECT id, user_id, token_hash, device_info, expires_at, created_at
        FROM sessions
        WHERE token_hash = $1 AND expires_at > now()
        "#,
    )
    .bind(token_hash)
    .fetch_optional(pool)
    .await
}

pub async fn delete_session(pool: &PgPool, id: Uuid) -> Result<(), sqlx::Error> {
    sqlx::query("DELETE FROM sessions WHERE id = $1")
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

// ── Servers ────────────────────────────────────────────

pub async fn create_server(
    pool: &PgPool,
    id: Uuid,
    instance_id: Uuid,
    name: &str,
    description: Option<&str>,
    owner_id: Uuid,
) -> Result<Server, sqlx::Error> {
    sqlx::query_as::<_, Server>(
        r#"
        INSERT INTO servers (id, instance_id, name, description, owner_id)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id, instance_id, name, description, icon_url, owner_id,
                  default_channel_id, created_at, updated_at
        "#,
    )
    .bind(id)
    .bind(instance_id)
    .bind(name)
    .bind(description)
    .bind(owner_id)
    .fetch_one(pool)
    .await
}

pub async fn get_server_by_id(pool: &PgPool, id: Uuid) -> Result<Option<Server>, sqlx::Error> {
    sqlx::query_as::<_, Server>(
        r#"
        SELECT id, instance_id, name, description, icon_url, owner_id,
               default_channel_id, created_at, updated_at
        FROM servers WHERE id = $1
        "#,
    )
    .bind(id)
    .fetch_optional(pool)
    .await
}

pub async fn get_user_servers(pool: &PgPool, user_id: Uuid) -> Result<Vec<Server>, sqlx::Error> {
    sqlx::query_as::<_, Server>(
        r#"
        SELECT s.id, s.instance_id, s.name, s.description, s.icon_url, s.owner_id,
               s.default_channel_id, s.created_at, s.updated_at
        FROM servers s
        INNER JOIN server_members sm ON s.id = sm.server_id
        WHERE sm.user_id = $1
        ORDER BY sm.joined_at
        "#,
    )
    .bind(user_id)
    .fetch_all(pool)
    .await
}

pub async fn update_server_default_channel(
    pool: &PgPool,
    server_id: Uuid,
    channel_id: Uuid,
) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE servers SET default_channel_id = $1 WHERE id = $2")
        .bind(channel_id)
        .bind(server_id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn delete_server(pool: &PgPool, id: Uuid) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE servers SET default_channel_id = NULL WHERE id = $1")
        .bind(id)
        .execute(pool)
        .await?;
    sqlx::query("DELETE FROM servers WHERE id = $1")
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

// ── Server Members ─────────────────────────────────────

pub async fn add_server_member(
    pool: &PgPool,
    server_id: Uuid,
    user_id: Uuid,
) -> Result<ServerMember, sqlx::Error> {
    sqlx::query_as::<_, ServerMember>(
        r#"
        INSERT INTO server_members (server_id, user_id)
        VALUES ($1, $2)
        RETURNING server_id, user_id, nickname, joined_at
        "#,
    )
    .bind(server_id)
    .bind(user_id)
    .fetch_one(pool)
    .await
}

pub async fn get_server_member(
    pool: &PgPool,
    server_id: Uuid,
    user_id: Uuid,
) -> Result<Option<ServerMember>, sqlx::Error> {
    sqlx::query_as::<_, ServerMember>(
        r#"
        SELECT server_id, user_id, nickname, joined_at
        FROM server_members
        WHERE server_id = $1 AND user_id = $2
        "#,
    )
    .bind(server_id)
    .bind(user_id)
    .fetch_optional(pool)
    .await
}

pub async fn get_server_members(
    pool: &PgPool,
    server_id: Uuid,
) -> Result<Vec<ServerMember>, sqlx::Error> {
    sqlx::query_as::<_, ServerMember>(
        r#"
        SELECT server_id, user_id, nickname, joined_at
        FROM server_members
        WHERE server_id = $1
        ORDER BY joined_at
        "#,
    )
    .bind(server_id)
    .fetch_all(pool)
    .await
}

pub async fn remove_server_member(
    pool: &PgPool,
    server_id: Uuid,
    user_id: Uuid,
) -> Result<(), sqlx::Error> {
    sqlx::query("DELETE FROM server_members WHERE server_id = $1 AND user_id = $2")
        .bind(server_id)
        .bind(user_id)
        .execute(pool)
        .await?;
    Ok(())
}

// ── Channels ───────────────────────────────────────────

pub async fn create_channel(
    pool: &PgPool,
    id: Uuid,
    instance_id: Uuid,
    server_id: Option<Uuid>,
    channel_type: ChannelType,
    name: Option<&str>,
    topic: Option<&str>,
    parent_id: Option<Uuid>,
    position: i32,
) -> Result<Channel, sqlx::Error> {
    sqlx::query_as::<_, Channel>(
        r#"
        INSERT INTO channels (id, instance_id, server_id, channel_type, name, topic, parent_id, position)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING id, instance_id, server_id, parent_id, channel_type, name, topic, position,
                  created_at, updated_at, last_message_id
        "#,
    )
    .bind(id)
    .bind(instance_id)
    .bind(server_id)
    .bind(channel_type)
    .bind(name)
    .bind(topic)
    .bind(parent_id)
    .bind(position)
    .fetch_one(pool)
    .await
}

pub async fn get_server_channels(
    pool: &PgPool,
    server_id: Uuid,
) -> Result<Vec<Channel>, sqlx::Error> {
    sqlx::query_as::<_, Channel>(
        r#"
        SELECT id, instance_id, server_id, parent_id, channel_type, name, topic, position,
               created_at, updated_at, last_message_id
        FROM channels
        WHERE server_id = $1
        ORDER BY position
        "#,
    )
    .bind(server_id)
    .fetch_all(pool)
    .await
}

pub async fn get_channel_by_id(pool: &PgPool, id: Uuid) -> Result<Option<Channel>, sqlx::Error> {
    sqlx::query_as::<_, Channel>(
        r#"
        SELECT id, instance_id, server_id, parent_id, channel_type, name, topic, position,
               created_at, updated_at, last_message_id
        FROM channels WHERE id = $1
        "#,
    )
    .bind(id)
    .fetch_optional(pool)
    .await
}

pub async fn update_channel(
    pool: &PgPool,
    id: Uuid,
    name: Option<&str>,
    topic: Option<&str>,
) -> Result<Channel, sqlx::Error> {
    sqlx::query_as::<_, Channel>(
        r#"
        UPDATE channels
        SET name = COALESCE($2, name),
            topic = COALESCE($3, topic),
            updated_at = now()
        WHERE id = $1
        RETURNING id, instance_id, server_id, parent_id, channel_type, name, topic, position,
                  created_at, updated_at, last_message_id
        "#,
    )
    .bind(id)
    .bind(name)
    .bind(topic)
    .fetch_one(pool)
    .await
}

pub async fn delete_channel(pool: &PgPool, id: Uuid) -> Result<(), sqlx::Error> {
    sqlx::query("DELETE FROM channels WHERE id = $1")
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

// ── Messages ───────────────────────────────────────────

pub async fn create_message(
    pool: &PgPool,
    id: Uuid,
    instance_id: Uuid,
    channel_id: Uuid,
    author_id: Uuid,
    content: &str,
    reply_to_id: Option<Uuid>,
) -> Result<Message, sqlx::Error> {
    sqlx::query_as::<_, Message>(
        r#"
        INSERT INTO messages (id, instance_id, channel_id, author_id, content, reply_to_id)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id, instance_id, channel_id, author_id, content, reply_to_id,
                  edited_at, pinned, created_at
        "#,
    )
    .bind(id)
    .bind(instance_id)
    .bind(channel_id)
    .bind(author_id)
    .bind(content)
    .bind(reply_to_id)
    .fetch_one(pool)
    .await
}

pub async fn get_messages(
    pool: &PgPool,
    channel_id: Uuid,
    before: Option<Uuid>,
    after: Option<Uuid>,
    limit: i64,
) -> Result<Vec<Message>, sqlx::Error> {
    if let Some(before_id) = before {
        sqlx::query_as::<_, Message>(
            r#"
            SELECT id, instance_id, channel_id, author_id, content, reply_to_id,
                   edited_at, pinned, created_at
            FROM messages
            WHERE channel_id = $1 AND id < $2
            ORDER BY id DESC
            LIMIT $3
            "#,
        )
        .bind(channel_id)
        .bind(before_id)
        .bind(limit)
        .fetch_all(pool)
        .await
    } else if let Some(after_id) = after {
        sqlx::query_as::<_, Message>(
            r#"
            SELECT id, instance_id, channel_id, author_id, content, reply_to_id,
                   edited_at, pinned, created_at
            FROM messages
            WHERE channel_id = $1 AND id > $2
            ORDER BY id ASC
            LIMIT $3
            "#,
        )
        .bind(channel_id)
        .bind(after_id)
        .bind(limit)
        .fetch_all(pool)
        .await
    } else {
        sqlx::query_as::<_, Message>(
            r#"
            SELECT id, instance_id, channel_id, author_id, content, reply_to_id,
                   edited_at, pinned, created_at
            FROM messages
            WHERE channel_id = $1
            ORDER BY id DESC
            LIMIT $2
            "#,
        )
        .bind(channel_id)
        .bind(limit)
        .fetch_all(pool)
        .await
    }
}

// ── Roles ──────────────────────────────────────────────

pub async fn create_role(
    pool: &PgPool,
    id: Uuid,
    server_id: Uuid,
    name: &str,
    permissions: i64,
    is_default: bool,
    position: i32,
) -> Result<Role, sqlx::Error> {
    sqlx::query_as::<_, Role>(
        r#"
        INSERT INTO roles (id, server_id, name, permissions, is_default, position)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id, server_id, name, color, hoist, position, permissions,
                  mentionable, is_default, created_at
        "#,
    )
    .bind(id)
    .bind(server_id)
    .bind(name)
    .bind(permissions)
    .bind(is_default)
    .bind(position)
    .fetch_one(pool)
    .await
}

pub async fn get_role_by_id(pool: &PgPool, id: Uuid) -> Result<Option<Role>, sqlx::Error> {
    sqlx::query_as::<_, Role>(
        r#"
        SELECT id, server_id, name, color, hoist, position, permissions,
               mentionable, is_default, created_at
        FROM roles WHERE id = $1
        "#,
    )
    .bind(id)
    .fetch_optional(pool)
    .await
}

pub async fn get_server_roles(pool: &PgPool, server_id: Uuid) -> Result<Vec<Role>, sqlx::Error> {
    sqlx::query_as::<_, Role>(
        r#"
        SELECT id, server_id, name, color, hoist, position, permissions,
               mentionable, is_default, created_at
        FROM roles
        WHERE server_id = $1
        ORDER BY position
        "#,
    )
    .bind(server_id)
    .fetch_all(pool)
    .await
}

pub async fn update_role(
    pool: &PgPool,
    id: Uuid,
    name: Option<&str>,
    color: Option<i32>,
    hoist: Option<bool>,
    position: Option<i32>,
    permissions: Option<i64>,
    mentionable: Option<bool>,
) -> Result<Role, sqlx::Error> {
    sqlx::query_as::<_, Role>(
        r#"
        UPDATE roles SET
            name = COALESCE($2, name),
            color = COALESCE($3, color),
            hoist = COALESCE($4, hoist),
            position = COALESCE($5, position),
            permissions = COALESCE($6, permissions),
            mentionable = COALESCE($7, mentionable)
        WHERE id = $1
        RETURNING id, server_id, name, color, hoist, position, permissions,
                  mentionable, is_default, created_at
        "#,
    )
    .bind(id)
    .bind(name)
    .bind(color)
    .bind(hoist)
    .bind(position)
    .bind(permissions)
    .bind(mentionable)
    .fetch_one(pool)
    .await
}

pub async fn delete_role(pool: &PgPool, id: Uuid) -> Result<(), sqlx::Error> {
    sqlx::query("DELETE FROM roles WHERE id = $1")
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn get_next_role_position(pool: &PgPool, server_id: Uuid) -> Result<i32, sqlx::Error> {
    let row: (Option<i32>,) = sqlx::query_as(
        "SELECT MAX(position) FROM roles WHERE server_id = $1",
    )
    .bind(server_id)
    .fetch_one(pool)
    .await?;
    Ok(row.0.unwrap_or(0) + 1)
}

// ── Member Roles ──────────────────────────────────────

pub async fn assign_member_role(
    pool: &PgPool,
    server_id: Uuid,
    user_id: Uuid,
    role_id: Uuid,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"
        INSERT INTO member_roles (server_id, user_id, role_id)
        VALUES ($1, $2, $3)
        ON CONFLICT DO NOTHING
        "#,
    )
    .bind(server_id)
    .bind(user_id)
    .bind(role_id)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn remove_member_role(
    pool: &PgPool,
    server_id: Uuid,
    user_id: Uuid,
    role_id: Uuid,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "DELETE FROM member_roles WHERE server_id = $1 AND user_id = $2 AND role_id = $3",
    )
    .bind(server_id)
    .bind(user_id)
    .bind(role_id)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn get_member_role_ids(
    pool: &PgPool,
    server_id: Uuid,
    user_id: Uuid,
) -> Result<Vec<Uuid>, sqlx::Error> {
    let rows: Vec<(Uuid,)> = sqlx::query_as(
        "SELECT role_id FROM member_roles WHERE server_id = $1 AND user_id = $2",
    )
    .bind(server_id)
    .bind(user_id)
    .fetch_all(pool)
    .await?;
    Ok(rows.into_iter().map(|r| r.0).collect())
}

pub async fn get_member_roles(
    pool: &PgPool,
    server_id: Uuid,
    user_id: Uuid,
) -> Result<Vec<Role>, sqlx::Error> {
    sqlx::query_as::<_, Role>(
        r#"
        SELECT r.id, r.server_id, r.name, r.color, r.hoist, r.position, r.permissions,
               r.mentionable, r.is_default, r.created_at
        FROM roles r
        INNER JOIN member_roles mr ON r.id = mr.role_id
        WHERE mr.server_id = $1 AND mr.user_id = $2
        ORDER BY r.position
        "#,
    )
    .bind(server_id)
    .bind(user_id)
    .fetch_all(pool)
    .await
}

// ── Channel Overrides ─────────────────────────────────

pub async fn get_channel_overrides(
    pool: &PgPool,
    channel_id: Uuid,
) -> Result<Vec<ChannelOverride>, sqlx::Error> {
    sqlx::query_as::<_, ChannelOverride>(
        r#"
        SELECT id, channel_id, target_type, target_id, allow, deny
        FROM channel_overrides
        WHERE channel_id = $1
        "#,
    )
    .bind(channel_id)
    .fetch_all(pool)
    .await
}

pub async fn set_channel_override(
    pool: &PgPool,
    id: Uuid,
    channel_id: Uuid,
    target_type: &str,
    target_id: Uuid,
    allow: i64,
    deny: i64,
) -> Result<ChannelOverride, sqlx::Error> {
    sqlx::query_as::<_, ChannelOverride>(
        r#"
        INSERT INTO channel_overrides (id, channel_id, target_type, target_id, allow, deny)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (channel_id, target_type, target_id)
        DO UPDATE SET allow = $5, deny = $6
        RETURNING id, channel_id, target_type, target_id, allow, deny
        "#,
    )
    .bind(id)
    .bind(channel_id)
    .bind(target_type)
    .bind(target_id)
    .bind(allow)
    .bind(deny)
    .fetch_one(pool)
    .await
}

pub async fn delete_channel_override(
    pool: &PgPool,
    channel_id: Uuid,
    target_type: &str,
    target_id: Uuid,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"
        DELETE FROM channel_overrides
        WHERE channel_id = $1 AND target_type = $2 AND target_id = $3
        "#,
    )
    .bind(channel_id)
    .bind(target_type)
    .bind(target_id)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn get_default_role(
    pool: &PgPool,
    server_id: Uuid,
) -> Result<Option<Role>, sqlx::Error> {
    sqlx::query_as::<_, Role>(
        r#"
        SELECT id, server_id, name, color, hoist, position, permissions,
               mentionable, is_default, created_at
        FROM roles
        WHERE server_id = $1 AND is_default = true
        "#,
    )
    .bind(server_id)
    .fetch_optional(pool)
    .await
}

// ── Message Edit/Delete ───────────────────────────────

pub async fn update_message_content(
    pool: &PgPool,
    message_id: Uuid,
    content: &str,
) -> Result<Message, sqlx::Error> {
    sqlx::query_as::<_, Message>(
        r#"
        UPDATE messages SET content = $2, edited_at = now()
        WHERE id = $1
        RETURNING id, instance_id, channel_id, author_id, content, reply_to_id,
                  edited_at, pinned, created_at
        "#,
    )
    .bind(message_id)
    .bind(content)
    .fetch_one(pool)
    .await
}

pub async fn delete_message(pool: &PgPool, message_id: Uuid) -> Result<(), sqlx::Error> {
    sqlx::query("DELETE FROM messages WHERE id = $1")
        .bind(message_id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn delete_channel_messages(pool: &PgPool, channel_id: Uuid) -> Result<u64, sqlx::Error> {
    let result = sqlx::query("DELETE FROM messages WHERE channel_id = $1")
        .bind(channel_id)
        .execute(pool)
        .await?;
    Ok(result.rows_affected())
}

pub async fn get_message_by_id(
    pool: &PgPool,
    message_id: Uuid,
) -> Result<Option<Message>, sqlx::Error> {
    sqlx::query_as::<_, Message>(
        r#"
        SELECT id, instance_id, channel_id, author_id, content, reply_to_id,
               edited_at, pinned, created_at
        FROM messages WHERE id = $1
        "#,
    )
    .bind(message_id)
    .fetch_optional(pool)
    .await
}

pub async fn set_message_pinned(
    pool: &PgPool,
    message_id: Uuid,
    pinned: bool,
) -> Result<Message, sqlx::Error> {
    sqlx::query_as::<_, Message>(
        r#"
        UPDATE messages SET pinned = $2
        WHERE id = $1
        RETURNING id, instance_id, channel_id, author_id, content, reply_to_id,
                  edited_at, pinned, created_at
        "#,
    )
    .bind(message_id)
    .bind(pinned)
    .fetch_one(pool)
    .await
}

pub async fn get_pinned_messages(
    pool: &PgPool,
    channel_id: Uuid,
) -> Result<Vec<Message>, sqlx::Error> {
    sqlx::query_as::<_, Message>(
        r#"
        SELECT id, instance_id, channel_id, author_id, content, reply_to_id,
               edited_at, pinned, created_at
        FROM messages
        WHERE channel_id = $1 AND pinned = true
        ORDER BY created_at DESC
        "#,
    )
    .bind(channel_id)
    .fetch_all(pool)
    .await
}

// ── Attachments ───────────────────────────────────────

pub async fn create_attachment(
    pool: &PgPool,
    id: Uuid,
    message_id: Uuid,
    filename: &str,
    content_type: &str,
    size_bytes: i64,
    url: &str,
    width: Option<i32>,
    height: Option<i32>,
) -> Result<Attachment, sqlx::Error> {
    sqlx::query_as::<_, Attachment>(
        r#"
        INSERT INTO attachments (id, message_id, filename, content_type, size_bytes, url, width, height)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING id, message_id, filename, content_type, size_bytes, url, width, height, created_at
        "#,
    )
    .bind(id)
    .bind(message_id)
    .bind(filename)
    .bind(content_type)
    .bind(size_bytes)
    .bind(url)
    .bind(width)
    .bind(height)
    .fetch_one(pool)
    .await
}

pub async fn get_message_attachments(
    pool: &PgPool,
    message_id: Uuid,
) -> Result<Vec<Attachment>, sqlx::Error> {
    sqlx::query_as::<_, Attachment>(
        r#"
        SELECT id, message_id, filename, content_type, size_bytes, url, width, height, created_at
        FROM attachments
        WHERE message_id = $1
        ORDER BY created_at
        "#,
    )
    .bind(message_id)
    .fetch_all(pool)
    .await
}

// ── Reactions ─────────────────────────────────────────

pub async fn add_reaction(
    pool: &PgPool,
    message_id: Uuid,
    user_id: Uuid,
    emoji_name: &str,
    emoji_id: Option<Uuid>,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"
        INSERT INTO reactions (message_id, user_id, emoji_name, emoji_id)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT DO NOTHING
        "#,
    )
    .bind(message_id)
    .bind(user_id)
    .bind(emoji_name)
    .bind(emoji_id)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn remove_reaction(
    pool: &PgPool,
    message_id: Uuid,
    user_id: Uuid,
    emoji_name: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "DELETE FROM reactions WHERE message_id = $1 AND user_id = $2 AND emoji_name = $3",
    )
    .bind(message_id)
    .bind(user_id)
    .bind(emoji_name)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn get_message_reactions(
    pool: &PgPool,
    message_id: Uuid,
) -> Result<Vec<Reaction>, sqlx::Error> {
    sqlx::query_as::<_, Reaction>(
        r#"
        SELECT message_id, user_id, emoji_name, emoji_id, created_at
        FROM reactions
        WHERE message_id = $1
        ORDER BY created_at
        "#,
    )
    .bind(message_id)
    .fetch_all(pool)
    .await
}

pub async fn get_reactions_for_messages(
    pool: &PgPool,
    message_ids: &[Uuid],
) -> Result<Vec<Reaction>, sqlx::Error> {
    if message_ids.is_empty() {
        return Ok(Vec::new());
    }
    sqlx::query_as::<_, Reaction>(
        r#"
        SELECT message_id, user_id, emoji_name, emoji_id, created_at
        FROM reactions
        WHERE message_id = ANY($1)
        ORDER BY created_at
        "#,
    )
    .bind(message_ids)
    .fetch_all(pool)
    .await
}

// ── Relationships ────────────────────────────────────

pub async fn create_relationship(
    pool: &PgPool,
    user_id: Uuid,
    target_id: Uuid,
    rel_type: RelationshipType,
) -> Result<Relationship, sqlx::Error> {
    sqlx::query_as::<_, Relationship>(
        r#"
        INSERT INTO relationships (user_id, target_id, rel_type)
        VALUES ($1, $2, $3)
        ON CONFLICT (user_id, target_id) DO UPDATE SET rel_type = $3
        RETURNING user_id, target_id, rel_type, created_at
        "#,
    )
    .bind(user_id)
    .bind(target_id)
    .bind(rel_type)
    .fetch_one(pool)
    .await
}

pub async fn get_relationship(
    pool: &PgPool,
    user_id: Uuid,
    target_id: Uuid,
) -> Result<Option<Relationship>, sqlx::Error> {
    sqlx::query_as::<_, Relationship>(
        r#"
        SELECT user_id, target_id, rel_type, created_at
        FROM relationships
        WHERE user_id = $1 AND target_id = $2
        "#,
    )
    .bind(user_id)
    .bind(target_id)
    .fetch_optional(pool)
    .await
}

pub async fn delete_relationship(
    pool: &PgPool,
    user_id: Uuid,
    target_id: Uuid,
) -> Result<(), sqlx::Error> {
    sqlx::query("DELETE FROM relationships WHERE user_id = $1 AND target_id = $2")
        .bind(user_id)
        .bind(target_id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn get_user_relationships(
    pool: &PgPool,
    user_id: Uuid,
) -> Result<Vec<Relationship>, sqlx::Error> {
    sqlx::query_as::<_, Relationship>(
        r#"
        SELECT user_id, target_id, rel_type, created_at
        FROM relationships
        WHERE user_id = $1
        ORDER BY created_at DESC
        "#,
    )
    .bind(user_id)
    .fetch_all(pool)
    .await
}

pub async fn get_user_by_username(
    pool: &PgPool,
    username: &str,
) -> Result<Option<User>, sqlx::Error> {
    sqlx::query_as::<_, User>(
        r#"
        SELECT id, instance_id, username, display_name, email, password_hash,
               avatar_url, bio, status, custom_status, theme_preference, is_admin, bot, created_at, updated_at
        FROM users WHERE username = $1
        "#,
    )
    .bind(username)
    .fetch_optional(pool)
    .await
}

pub async fn search_users_by_username(
    pool: &PgPool,
    query: &str,
    limit: i64,
) -> Result<Vec<User>, sqlx::Error> {
    let pattern = format!("{}%", query);
    sqlx::query_as::<_, User>(
        r#"
        SELECT id, instance_id, username, display_name, email, password_hash,
               avatar_url, bio, status, custom_status, theme_preference, is_admin, bot, created_at, updated_at
        FROM users WHERE username ILIKE $1
        ORDER BY username
        LIMIT $2
        "#,
    )
    .bind(&pattern)
    .bind(limit)
    .fetch_all(pool)
    .await
}

// ── DM Channels ──────────────────────────────────────

pub async fn add_dm_member(
    pool: &PgPool,
    channel_id: Uuid,
    user_id: Uuid,
) -> Result<DmMember, sqlx::Error> {
    sqlx::query_as::<_, DmMember>(
        r#"
        INSERT INTO dm_members (channel_id, user_id)
        VALUES ($1, $2)
        ON CONFLICT (channel_id, user_id) DO UPDATE SET closed = FALSE
        RETURNING channel_id, user_id
        "#,
    )
    .bind(channel_id)
    .bind(user_id)
    .fetch_one(pool)
    .await
}

pub async fn get_dm_channels(
    pool: &PgPool,
    user_id: Uuid,
) -> Result<Vec<Channel>, sqlx::Error> {
    sqlx::query_as::<_, Channel>(
        r#"
        SELECT c.id, c.instance_id, c.server_id, c.parent_id, c.channel_type,
               c.name, c.topic, c.position, c.created_at, c.updated_at, c.last_message_id
        FROM channels c
        INNER JOIN dm_members dm ON c.id = dm.channel_id
        WHERE dm.user_id = $1 AND c.channel_type IN ('dm', 'groupdm') AND dm.closed = FALSE
        ORDER BY c.updated_at DESC
        "#,
    )
    .bind(user_id)
    .fetch_all(pool)
    .await
}

pub async fn get_dm_members(
    pool: &PgPool,
    channel_id: Uuid,
) -> Result<Vec<User>, sqlx::Error> {
    sqlx::query_as::<_, User>(
        r#"
        SELECT u.id, u.instance_id, u.username, u.display_name, u.email, u.password_hash,
               u.avatar_url, u.bio, u.status, u.custom_status, u.theme_preference, u.is_admin, u.bot, u.created_at, u.updated_at
        FROM users u
        INNER JOIN dm_members dm ON u.id = dm.user_id
        WHERE dm.channel_id = $1
        "#,
    )
    .bind(channel_id)
    .fetch_all(pool)
    .await
}

pub async fn find_existing_dm(
    pool: &PgPool,
    user_a: Uuid,
    user_b: Uuid,
) -> Result<Option<Channel>, sqlx::Error> {
    sqlx::query_as::<_, Channel>(
        r#"
        SELECT c.id, c.instance_id, c.server_id, c.parent_id, c.channel_type,
               c.name, c.topic, c.position, c.created_at, c.updated_at, c.last_message_id
        FROM channels c
        WHERE c.channel_type = 'dm'
          AND c.id IN (
              SELECT dm1.channel_id FROM dm_members dm1
              INNER JOIN dm_members dm2 ON dm1.channel_id = dm2.channel_id
              WHERE dm1.user_id = $1 AND dm2.user_id = $2
          )
        LIMIT 1
        "#,
    )
    .bind(user_a)
    .bind(user_b)
    .fetch_optional(pool)
    .await
}

pub async fn close_dm(pool: &PgPool, channel_id: Uuid, user_id: Uuid) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE dm_members SET closed = TRUE WHERE channel_id = $1 AND user_id = $2")
        .bind(channel_id)
        .bind(user_id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn reopen_dm_for_members(pool: &PgPool, channel_id: Uuid) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE dm_members SET closed = FALSE WHERE channel_id = $1")
        .bind(channel_id)
        .execute(pool)
        .await?;
    Ok(())
}

// ── Threads ──────────────────────────────────────────

pub async fn create_thread_metadata(
    pool: &PgPool,
    channel_id: Uuid,
    parent_channel_id: Uuid,
    starter_message_id: Option<Uuid>,
) -> Result<ThreadMetadata, sqlx::Error> {
    sqlx::query_as::<_, ThreadMetadata>(
        r#"
        INSERT INTO thread_metadata (channel_id, parent_channel_id, starter_message_id)
        VALUES ($1, $2, $3)
        RETURNING channel_id, parent_channel_id, starter_message_id, archived, locked, message_count, created_at
        "#,
    )
    .bind(channel_id)
    .bind(parent_channel_id)
    .bind(starter_message_id)
    .fetch_one(pool)
    .await
}

pub async fn get_thread_metadata(
    pool: &PgPool,
    channel_id: Uuid,
) -> Result<Option<ThreadMetadata>, sqlx::Error> {
    sqlx::query_as::<_, ThreadMetadata>(
        r#"
        SELECT channel_id, parent_channel_id, starter_message_id, archived, locked, message_count, created_at
        FROM thread_metadata WHERE channel_id = $1
        "#,
    )
    .bind(channel_id)
    .fetch_optional(pool)
    .await
}

pub async fn get_channel_threads(
    pool: &PgPool,
    parent_channel_id: Uuid,
) -> Result<Vec<Channel>, sqlx::Error> {
    sqlx::query_as::<_, Channel>(
        r#"
        SELECT c.id, c.instance_id, c.server_id, c.parent_id, c.channel_type,
               c.name, c.topic, c.position, c.created_at, c.updated_at, c.last_message_id
        FROM channels c
        INNER JOIN thread_metadata tm ON c.id = tm.channel_id
        WHERE tm.parent_channel_id = $1 AND tm.archived = false
        ORDER BY c.created_at DESC
        "#,
    )
    .bind(parent_channel_id)
    .fetch_all(pool)
    .await
}

pub async fn increment_thread_message_count(
    pool: &PgPool,
    channel_id: Uuid,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "UPDATE thread_metadata SET message_count = message_count + 1 WHERE channel_id = $1",
    )
    .bind(channel_id)
    .execute(pool)
    .await?;
    Ok(())
}

// ── Search ───────────────────────────────────────────

pub async fn search_messages(
    pool: &PgPool,
    query: &str,
    channel_id: Option<Uuid>,
    server_id: Option<Uuid>,
    limit: i32,
    offset: i32,
) -> Result<Vec<SearchResult>, sqlx::Error> {
    sqlx::query_as::<_, SearchResult>(
        "SELECT * FROM search_messages($1, $2, $3, $4, $5)",
    )
    .bind(query)
    .bind(channel_id)
    .bind(server_id)
    .bind(limit)
    .bind(offset)
    .fetch_all(pool)
    .await
}

// ── Invites ─────────────────────────────────────────────

pub async fn create_invite(
    pool: &PgPool,
    id: Uuid,
    server_id: Uuid,
    channel_id: Option<Uuid>,
    creator_id: Uuid,
    code: &str,
    max_uses: Option<i32>,
    expires_at: Option<DateTime<Utc>>,
) -> Result<Invite, sqlx::Error> {
    sqlx::query_as::<_, Invite>(
        r#"
        INSERT INTO invites (id, server_id, channel_id, creator_id, code, max_uses, expires_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING id, server_id, channel_id, creator_id, code, max_uses, uses, expires_at, created_at
        "#,
    )
    .bind(id)
    .bind(server_id)
    .bind(channel_id)
    .bind(creator_id)
    .bind(code)
    .bind(max_uses)
    .bind(expires_at)
    .fetch_one(pool)
    .await
}

pub async fn get_invite_by_code(pool: &PgPool, code: &str) -> Result<Option<Invite>, sqlx::Error> {
    sqlx::query_as::<_, Invite>(
        r#"
        SELECT id, server_id, channel_id, creator_id, code, max_uses, uses, expires_at, created_at
        FROM invites WHERE code = $1
        "#,
    )
    .bind(code)
    .fetch_optional(pool)
    .await
}

pub async fn get_server_invites(
    pool: &PgPool,
    server_id: Uuid,
) -> Result<Vec<Invite>, sqlx::Error> {
    sqlx::query_as::<_, Invite>(
        r#"
        SELECT id, server_id, channel_id, creator_id, code, max_uses, uses, expires_at, created_at
        FROM invites WHERE server_id = $1
        ORDER BY created_at DESC
        "#,
    )
    .bind(server_id)
    .fetch_all(pool)
    .await
}

pub async fn increment_invite_uses(pool: &PgPool, code: &str) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE invites SET uses = uses + 1 WHERE code = $1")
        .bind(code)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn delete_invite(pool: &PgPool, code: &str) -> Result<(), sqlx::Error> {
    sqlx::query("DELETE FROM invites WHERE code = $1")
        .bind(code)
        .execute(pool)
        .await?;
    Ok(())
}

// ── Bans ────────────────────────────────────────────────

pub async fn create_ban(
    pool: &PgPool,
    server_id: Uuid,
    user_id: Uuid,
    moderator_id: Uuid,
    reason: Option<&str>,
) -> Result<Ban, sqlx::Error> {
    sqlx::query_as::<_, Ban>(
        r#"
        INSERT INTO bans (server_id, user_id, moderator_id, reason)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (server_id, user_id) DO UPDATE SET reason = $4, moderator_id = $3
        RETURNING server_id, user_id, moderator_id, reason, created_at
        "#,
    )
    .bind(server_id)
    .bind(user_id)
    .bind(moderator_id)
    .bind(reason)
    .fetch_one(pool)
    .await
}

pub async fn get_ban(
    pool: &PgPool,
    server_id: Uuid,
    user_id: Uuid,
) -> Result<Option<Ban>, sqlx::Error> {
    sqlx::query_as::<_, Ban>(
        r#"
        SELECT server_id, user_id, moderator_id, reason, created_at
        FROM bans WHERE server_id = $1 AND user_id = $2
        "#,
    )
    .bind(server_id)
    .bind(user_id)
    .fetch_optional(pool)
    .await
}

pub async fn get_server_bans(pool: &PgPool, server_id: Uuid) -> Result<Vec<Ban>, sqlx::Error> {
    sqlx::query_as::<_, Ban>(
        r#"
        SELECT server_id, user_id, moderator_id, reason, created_at
        FROM bans WHERE server_id = $1
        ORDER BY created_at DESC
        "#,
    )
    .bind(server_id)
    .fetch_all(pool)
    .await
}

pub async fn delete_ban(pool: &PgPool, server_id: Uuid, user_id: Uuid) -> Result<(), sqlx::Error> {
    sqlx::query("DELETE FROM bans WHERE server_id = $1 AND user_id = $2")
        .bind(server_id)
        .bind(user_id)
        .execute(pool)
        .await?;
    Ok(())
}

// ── Audit Log ───────────────────────────────────────────

pub async fn create_audit_log(
    pool: &PgPool,
    server_id: Uuid,
    user_id: Uuid,
    action: AuditAction,
    target_id: Option<Uuid>,
    reason: Option<&str>,
    changes: Option<serde_json::Value>,
) -> Result<AuditLogEntry, sqlx::Error> {
    sqlx::query_as::<_, AuditLogEntry>(
        r#"
        INSERT INTO audit_log (server_id, user_id, action, target_id, reason, changes)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id, server_id, user_id, action, target_id, reason, changes, created_at
        "#,
    )
    .bind(server_id)
    .bind(user_id)
    .bind(action)
    .bind(target_id)
    .bind(reason)
    .bind(changes)
    .fetch_one(pool)
    .await
}

pub async fn get_audit_log(
    pool: &PgPool,
    server_id: Uuid,
    action: Option<AuditAction>,
    user_id: Option<Uuid>,
    before: Option<Uuid>,
    limit: i64,
) -> Result<Vec<AuditLogEntry>, sqlx::Error> {
    // Build query dynamically based on filters
    let mut sql = String::from(
        "SELECT id, server_id, user_id, action, target_id, reason, changes, created_at \
         FROM audit_log WHERE server_id = $1",
    );
    let mut param_idx = 2u32;

    if action.is_some() {
        sql.push_str(&format!(" AND action = ${param_idx}"));
        param_idx += 1;
    }
    if user_id.is_some() {
        sql.push_str(&format!(" AND user_id = ${param_idx}"));
        param_idx += 1;
    }
    if before.is_some() {
        sql.push_str(&format!(
            " AND created_at < (SELECT created_at FROM audit_log WHERE id = ${param_idx})"
        ));
        param_idx += 1;
    }
    sql.push_str(&format!(" ORDER BY created_at DESC LIMIT ${param_idx}"));

    let mut query = sqlx::query_as::<_, AuditLogEntry>(&sql).bind(server_id);
    if let Some(a) = action {
        query = query.bind(a);
    }
    if let Some(uid) = user_id {
        query = query.bind(uid);
    }
    if let Some(b) = before {
        query = query.bind(b);
    }
    query = query.bind(limit);

    query.fetch_all(pool).await
}

// ── Webhooks ────────────────────────────────────────────

pub async fn create_webhook(
    pool: &PgPool,
    id: Uuid,
    server_id: Uuid,
    channel_id: Uuid,
    creator_id: Uuid,
    name: &str,
    token: &str,
) -> Result<Webhook, sqlx::Error> {
    sqlx::query_as::<_, Webhook>(
        r#"
        INSERT INTO webhooks (id, server_id, channel_id, creator_id, name, token)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id, server_id, channel_id, creator_id, name, avatar_url, token, created_at
        "#,
    )
    .bind(id)
    .bind(server_id)
    .bind(channel_id)
    .bind(creator_id)
    .bind(name)
    .bind(token)
    .fetch_one(pool)
    .await
}

pub async fn get_webhook_by_id(
    pool: &PgPool,
    id: Uuid,
) -> Result<Option<Webhook>, sqlx::Error> {
    sqlx::query_as::<_, Webhook>(
        r#"
        SELECT id, server_id, channel_id, creator_id, name, avatar_url, token, created_at
        FROM webhooks WHERE id = $1
        "#,
    )
    .bind(id)
    .fetch_optional(pool)
    .await
}

pub async fn get_webhook_by_token(
    pool: &PgPool,
    token: &str,
) -> Result<Option<Webhook>, sqlx::Error> {
    sqlx::query_as::<_, Webhook>(
        r#"
        SELECT id, server_id, channel_id, creator_id, name, avatar_url, token, created_at
        FROM webhooks WHERE token = $1
        "#,
    )
    .bind(token)
    .fetch_optional(pool)
    .await
}

pub async fn get_channel_webhooks(
    pool: &PgPool,
    channel_id: Uuid,
) -> Result<Vec<Webhook>, sqlx::Error> {
    sqlx::query_as::<_, Webhook>(
        r#"
        SELECT id, server_id, channel_id, creator_id, name, avatar_url, token, created_at
        FROM webhooks WHERE channel_id = $1
        ORDER BY created_at DESC
        "#,
    )
    .bind(channel_id)
    .fetch_all(pool)
    .await
}

pub async fn update_webhook(
    pool: &PgPool,
    id: Uuid,
    name: Option<&str>,
    channel_id: Option<Uuid>,
) -> Result<Webhook, sqlx::Error> {
    sqlx::query_as::<_, Webhook>(
        r#"
        UPDATE webhooks
        SET name = COALESCE($2, name),
            channel_id = COALESCE($3, channel_id)
        WHERE id = $1
        RETURNING id, server_id, channel_id, creator_id, name, avatar_url, token, created_at
        "#,
    )
    .bind(id)
    .bind(name)
    .bind(channel_id)
    .fetch_one(pool)
    .await
}

pub async fn delete_webhook(pool: &PgPool, id: Uuid) -> Result<(), sqlx::Error> {
    sqlx::query("DELETE FROM webhooks WHERE id = $1")
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

// ── User Status ─────────────────────────────────────────

pub async fn update_user_status(
    pool: &PgPool,
    user_id: Uuid,
    status: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE users SET status = $2, updated_at = now() WHERE id = $1")
        .bind(user_id)
        .bind(status)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn update_user_custom_status(
    pool: &PgPool,
    user_id: Uuid,
    custom_status: Option<&str>,
) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE users SET custom_status = $2, updated_at = now() WHERE id = $1")
        .bind(user_id)
        .bind(custom_status)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn update_user_profile(
    pool: &PgPool,
    user_id: Uuid,
    display_name: Option<&str>,
    bio: Option<&str>,
    avatar_url: Option<&str>,
    theme_preference: Option<&str>,
) -> Result<User, sqlx::Error> {
    sqlx::query_as::<_, User>(
        r#"
        UPDATE users SET
            display_name = COALESCE($2, display_name),
            bio = COALESCE($3, bio),
            avatar_url = COALESCE($4, avatar_url),
            theme_preference = COALESCE($5, theme_preference),
            updated_at = now()
        WHERE id = $1
        RETURNING id, instance_id, username, display_name, email, password_hash,
                  avatar_url, bio, status, custom_status, theme_preference, is_admin, bot, created_at, updated_at
        "#,
    )
    .bind(user_id)
    .bind(display_name)
    .bind(bio)
    .bind(avatar_url)
    .bind(theme_preference)
    .fetch_one(pool)
    .await
}

pub async fn update_server(
    pool: &PgPool,
    server_id: Uuid,
    name: Option<&str>,
    description: Option<&str>,
    icon_url: Option<&str>,
) -> Result<Server, sqlx::Error> {
    sqlx::query_as::<_, Server>(
        r#"
        UPDATE servers SET
            name = COALESCE($2, name),
            description = COALESCE($3, description),
            icon_url = COALESCE($4, icon_url),
            updated_at = now()
        WHERE id = $1
        RETURNING id, instance_id, name, description, icon_url, owner_id,
                  default_channel_id, created_at, updated_at
        "#,
    )
    .bind(server_id)
    .bind(name)
    .bind(description)
    .bind(icon_url)
    .fetch_one(pool)
    .await
}

// ── Registration Codes ──────────────────────────────────

pub async fn count_users(pool: &PgPool) -> Result<i64, sqlx::Error> {
    let row: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM users")
        .fetch_one(pool)
        .await?;
    Ok(row.0)
}

pub async fn set_user_admin(pool: &PgPool, user_id: Uuid, is_admin: bool) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE users SET is_admin = $2 WHERE id = $1")
        .bind(user_id)
        .bind(is_admin)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn create_registration_code(
    pool: &PgPool,
    id: Uuid,
    creator_id: Uuid,
    code: &str,
    max_uses: Option<i32>,
    expires_at: Option<DateTime<Utc>>,
) -> Result<RegistrationCode, sqlx::Error> {
    sqlx::query_as::<_, RegistrationCode>(
        r#"
        INSERT INTO registration_codes (id, creator_id, code, max_uses, expires_at)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id, code, creator_id, max_uses, uses, expires_at, created_at
        "#,
    )
    .bind(id)
    .bind(creator_id)
    .bind(code)
    .bind(max_uses)
    .bind(expires_at)
    .fetch_one(pool)
    .await
}

pub async fn get_registration_code_by_code(
    pool: &PgPool,
    code: &str,
) -> Result<Option<RegistrationCode>, sqlx::Error> {
    sqlx::query_as::<_, RegistrationCode>(
        r#"
        SELECT id, code, creator_id, max_uses, uses, expires_at, created_at
        FROM registration_codes WHERE code = $1
        "#,
    )
    .bind(code)
    .fetch_optional(pool)
    .await
}

pub async fn get_all_registration_codes(pool: &PgPool) -> Result<Vec<RegistrationCode>, sqlx::Error> {
    sqlx::query_as::<_, RegistrationCode>(
        r#"
        SELECT id, code, creator_id, max_uses, uses, expires_at, created_at
        FROM registration_codes
        ORDER BY created_at DESC
        "#,
    )
    .fetch_all(pool)
    .await
}

pub async fn increment_registration_code_uses(pool: &PgPool, code: &str) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE registration_codes SET uses = uses + 1 WHERE code = $1")
        .bind(code)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn delete_registration_code(pool: &PgPool, code: &str) -> Result<(), sqlx::Error> {
    sqlx::query("DELETE FROM registration_codes WHERE code = $1")
        .bind(code)
        .execute(pool)
        .await?;
    Ok(())
}

// ── Read States ──────────────────────────────────────────

pub async fn get_user_read_states(
    pool: &PgPool,
    user_id: Uuid,
) -> Result<Vec<ReadState>, sqlx::Error> {
    sqlx::query_as::<_, ReadState>(
        r#"
        SELECT channel_id, last_read_message_id, mention_count
        FROM read_states
        WHERE user_id = $1
        "#,
    )
    .bind(user_id)
    .fetch_all(pool)
    .await
}

pub async fn ack_channel(
    pool: &PgPool,
    user_id: Uuid,
    channel_id: Uuid,
    message_id: Uuid,
) -> Result<ReadState, sqlx::Error> {
    sqlx::query_as::<_, ReadState>(
        r#"
        INSERT INTO read_states (user_id, channel_id, last_read_message_id, mention_count, updated_at)
        VALUES ($1, $2, $3, 0, now())
        ON CONFLICT (user_id, channel_id) DO UPDATE SET
            last_read_message_id = GREATEST(read_states.last_read_message_id, $3),
            mention_count = 0,
            updated_at = now()
        RETURNING channel_id, last_read_message_id, mention_count
        "#,
    )
    .bind(user_id)
    .bind(channel_id)
    .bind(message_id)
    .fetch_one(pool)
    .await
}

pub async fn increment_mention_counts(
    pool: &PgPool,
    channel_id: Uuid,
    user_ids: &[Uuid],
) -> Result<(), sqlx::Error> {
    if user_ids.is_empty() {
        return Ok(());
    }
    sqlx::query(
        r#"
        INSERT INTO read_states (user_id, channel_id, mention_count, updated_at)
        SELECT unnest($1::uuid[]), $2, 1, now()
        ON CONFLICT (user_id, channel_id) DO UPDATE SET
            mention_count = read_states.mention_count + 1,
            updated_at = now()
        "#,
    )
    .bind(user_ids)
    .bind(channel_id)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn update_channel_last_message(
    pool: &PgPool,
    channel_id: Uuid,
    message_id: Uuid,
) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE channels SET last_message_id = $2 WHERE id = $1")
        .bind(channel_id)
        .bind(message_id)
        .execute(pool)
        .await?;
    Ok(())
}

// ── Notification Preferences ──────────────────────────

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, sqlx::FromRow)]
pub struct NotificationPreference {
    pub target_id: Uuid,
    pub target_type: String,
    pub notification_level: String,
    pub muted: bool,
}

pub async fn get_notification_preferences(
    pool: &PgPool,
    user_id: Uuid,
) -> Result<Vec<NotificationPreference>, sqlx::Error> {
    sqlx::query_as::<_, NotificationPreference>(
        "SELECT target_id, target_type, notification_level, muted FROM notification_preferences WHERE user_id = $1",
    )
    .bind(user_id)
    .fetch_all(pool)
    .await
}

pub async fn upsert_notification_preference(
    pool: &PgPool,
    user_id: Uuid,
    target_id: Uuid,
    target_type: &str,
    notification_level: &str,
    muted: bool,
) -> Result<NotificationPreference, sqlx::Error> {
    sqlx::query_as::<_, NotificationPreference>(
        r#"
        INSERT INTO notification_preferences (user_id, target_id, target_type, notification_level, muted, updated_at)
        VALUES ($1, $2, $3, $4, $5, now())
        ON CONFLICT (user_id, target_id) DO UPDATE SET
            notification_level = $4,
            muted = $5,
            updated_at = now()
        RETURNING target_id, target_type, notification_level, muted
        "#,
    )
    .bind(user_id)
    .bind(target_id)
    .bind(target_type)
    .bind(notification_level)
    .bind(muted)
    .fetch_one(pool)
    .await
}

// ── Password Reset Tokens ─────────────────────────────

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct PasswordResetToken {
    pub id: Uuid,
    pub user_id: Uuid,
    pub token_hash: String,
    pub expires_at: DateTime<Utc>,
    pub created_at: DateTime<Utc>,
}

pub async fn create_password_reset_token(
    pool: &PgPool,
    id: Uuid,
    user_id: Uuid,
    token_hash: &str,
    expires_at: DateTime<Utc>,
) -> Result<PasswordResetToken, sqlx::Error> {
    sqlx::query_as::<_, PasswordResetToken>(
        r#"
        INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at)
        VALUES ($1, $2, $3, $4)
        RETURNING id, user_id, token_hash, expires_at, created_at
        "#,
    )
    .bind(id)
    .bind(user_id)
    .bind(token_hash)
    .bind(expires_at)
    .fetch_one(pool)
    .await
}

pub async fn get_password_reset_token_by_hash(
    pool: &PgPool,
    token_hash: &str,
) -> Result<Option<PasswordResetToken>, sqlx::Error> {
    sqlx::query_as::<_, PasswordResetToken>(
        r#"
        SELECT id, user_id, token_hash, expires_at, created_at
        FROM password_reset_tokens
        WHERE token_hash = $1 AND expires_at > now()
        "#,
    )
    .bind(token_hash)
    .fetch_optional(pool)
    .await
}

pub async fn delete_password_reset_token(
    pool: &PgPool,
    id: Uuid,
) -> Result<(), sqlx::Error> {
    sqlx::query("DELETE FROM password_reset_tokens WHERE id = $1")
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn delete_user_password_reset_tokens(
    pool: &PgPool,
    user_id: Uuid,
) -> Result<(), sqlx::Error> {
    sqlx::query("DELETE FROM password_reset_tokens WHERE user_id = $1")
        .bind(user_id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn update_user_password_hash(
    pool: &PgPool,
    user_id: Uuid,
    password_hash: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE users SET password_hash = $2, updated_at = now() WHERE id = $1")
        .bind(user_id)
        .bind(password_hash)
        .execute(pool)
        .await?;
    Ok(())
}
