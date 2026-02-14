use std::sync::LazyLock;

use axum::extract::{Path, Query, State};
use axum::response::IntoResponse;
use axum::routing::{get, put};
use axum::{Json, Router};
use chrono::Utc;
use regex::Regex;
use uuid::Uuid;

use crate::api::auth::AuthUser;
use crate::db::queries;
use crate::error::ApiError;
use crate::services::permissions as perm_service;
use crate::state::AppState;
use crate::types::entities::{
    AckMessageRequest, AuditAction, ChannelType, CreateThreadRequest, EditMessageRequest,
    MessageQuery, PublicUser, ReactionGroup, SendMessageRequest, SetChannelOverrideRequest,
    UpdateChannelRequest, UploadUrlResponse,
};
use crate::types::events::{
    ChannelOverrideUpdateEvent, MessageAckEvent, MessageCreateEvent, MessageDeleteEvent,
    MessagePinEvent, MessageUpdateEvent, ReactionAddEvent, ReactionRemoveEvent,
    ThreadCreateEvent, TypingStartEvent,
};
use crate::types::permissions::Permissions;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route(
            "/{channel_id}",
            get(get_channel)
                .patch(update_channel)
                .delete(delete_channel),
        )
        .route(
            "/{channel_id}/messages",
            get(get_messages).post(send_message),
        )
        .route(
            "/{channel_id}/messages/{message_id}",
            axum::routing::patch(edit_message).delete(delete_message),
        )
        .route(
            "/{channel_id}/messages/{message_id}/reactions/{emoji}",
            put(add_reaction).delete(remove_reaction),
        )
        .route(
            "/{channel_id}/messages/{message_id}/pin",
            put(pin_message).delete(unpin_message),
        )
        .route("/{channel_id}/pins", get(get_pinned_messages))
        .route("/{channel_id}/upload", axum::routing::post(request_upload))
        .route(
            "/{channel_id}/overrides/{target_type}/{target_id}",
            put(set_override).delete(delete_override),
        )
        .route("/{channel_id}/overrides", get(list_overrides))
        .route(
            "/{channel_id}/threads",
            get(list_threads).post(create_thread),
        )
        .route("/{channel_id}/typing", axum::routing::post(typing_start))
        .route("/{channel_id}/ack", put(ack_message))
}

/// Helper: resolve channel and verify VIEW_CHANNEL permission.
/// Returns (channel, server_id, owner_id) — server_id/owner_id are None for DMs.
async fn resolve_channel_with_perm(
    state: &AppState,
    channel_id: Uuid,
    user_id: Uuid,
    required: Permissions,
) -> Result<
    (
        crate::types::entities::Channel,
        Option<Uuid>,
        Option<Uuid>,
    ),
    ApiError,
> {
    let channel = queries::get_channel_by_id(&state.db, channel_id)
        .await?
        .ok_or(ApiError::NotFound("Channel"))?;

    if let Some(server_id) = channel.server_id {
        let server = queries::get_server_by_id(&state.db, server_id)
            .await?
            .ok_or(ApiError::NotFound("Server"))?;

        queries::get_server_member(&state.db, server_id, user_id)
            .await?
            .ok_or(ApiError::NotFound("Channel"))?;

        if !perm_service::has_channel_permission(
            &state.db,
            server_id,
            channel_id,
            user_id,
            server.owner_id,
            required,
        )
        .await?
        {
            return Err(ApiError::Forbidden);
        }

        Ok((channel, Some(server_id), Some(server.owner_id)))
    } else {
        // DM/GroupDM — verify user is a member
        let members = queries::get_dm_members(&state.db, channel_id).await?;
        if !members.iter().any(|m| m.id == user_id) {
            return Err(ApiError::NotFound("Channel"));
        }
        Ok((channel, None, None))
    }
}

async fn get_channel(
    State(state): State<AppState>,
    user: AuthUser,
    Path(channel_id): Path<Uuid>,
) -> Result<impl IntoResponse, ApiError> {
    let (channel, _, _) =
        resolve_channel_with_perm(&state, channel_id, user.user_id, Permissions::VIEW_CHANNEL)
            .await?;
    Ok(Json(channel))
}

async fn update_channel(
    State(state): State<AppState>,
    user: AuthUser,
    Path(channel_id): Path<Uuid>,
    Json(body): Json<UpdateChannelRequest>,
) -> Result<impl IntoResponse, ApiError> {
    let (channel, server_id, _) =
        resolve_channel_with_perm(&state, channel_id, user.user_id, Permissions::MANAGE_CHANNELS)
            .await?;

    let server_id = server_id.ok_or(ApiError::InvalidInput(
        "Cannot update DM channels".into(),
    ))?;

    if let Some(ref name) = body.name {
        if name.is_empty() || name.len() > 100 {
            return Err(ApiError::InvalidInput(
                "Channel name must be 1-100 characters".into(),
            ));
        }
    }

    let updated = queries::update_channel(
        &state.db,
        channel_id,
        body.name.as_deref(),
        body.topic.as_deref(),
    )
    .await?;

    let _ = queries::create_audit_log(
        &state.db,
        server_id,
        user.user_id,
        AuditAction::ChannelUpdate,
        Some(channel_id),
        None,
        Some(serde_json::json!({ "name": updated.name, "topic": updated.topic })),
    )
    .await;

    state
        .gateway
        .broadcast_to_server(server_id, "CHANNEL_UPDATE", &updated, None);

    Ok(Json(updated))
}

async fn delete_channel(
    State(state): State<AppState>,
    user: AuthUser,
    Path(channel_id): Path<Uuid>,
) -> Result<impl IntoResponse, ApiError> {
    let (channel, server_id, _) =
        resolve_channel_with_perm(&state, channel_id, user.user_id, Permissions::MANAGE_CHANNELS)
            .await?;

    let server_id = server_id.ok_or(ApiError::InvalidInput(
        "Cannot delete DM channels".into(),
    ))?;

    queries::delete_channel(&state.db, channel_id).await?;

    let _ = queries::create_audit_log(
        &state.db,
        server_id,
        user.user_id,
        AuditAction::ChannelDelete,
        Some(channel_id),
        None,
        Some(serde_json::json!({ "name": channel.name })),
    )
    .await;

    state.gateway.broadcast_to_server(
        server_id,
        "CHANNEL_DELETE",
        &serde_json::json!({ "id": channel_id, "server_id": server_id }),
        None,
    );

    Ok(axum::http::StatusCode::NO_CONTENT)
}

async fn get_messages(
    State(state): State<AppState>,
    user: AuthUser,
    Path(channel_id): Path<Uuid>,
    Query(query): Query<MessageQuery>,
) -> Result<impl IntoResponse, ApiError> {
    resolve_channel_with_perm(
        &state,
        channel_id,
        user.user_id,
        Permissions::VIEW_CHANNEL | Permissions::READ_MESSAGE_HISTORY,
    )
    .await?;

    let limit = query.limit.unwrap_or(50).min(100);
    let messages =
        queries::get_messages(&state.db, channel_id, query.before, query.after, limit).await?;

    // Batch-load reactions for all messages
    let message_ids: Vec<Uuid> = messages.iter().map(|m| m.id).collect();
    let all_reactions =
        queries::get_reactions_for_messages(&state.db, &message_ids).await?;

    // Build reaction groups per message
    let mut reaction_map: std::collections::HashMap<Uuid, Vec<ReactionGroup>> =
        std::collections::HashMap::new();
    for reaction in &all_reactions {
        let groups = reaction_map.entry(reaction.message_id).or_default();
        if let Some(group) = groups.iter_mut().find(|g| g.emoji_name == reaction.emoji_name) {
            group.count += 1;
            if reaction.user_id == user.user_id {
                group.me = true;
            }
        } else {
            groups.push(ReactionGroup {
                emoji_name: reaction.emoji_name.clone(),
                emoji_id: reaction.emoji_id,
                count: 1,
                me: reaction.user_id == user.user_id,
            });
        }
    }

    let result: Vec<serde_json::Value> = messages
        .iter()
        .map(|msg| {
            let mut val = serde_json::to_value(msg).unwrap();
            val.as_object_mut().unwrap().insert(
                "reactions".to_string(),
                serde_json::to_value(
                    reaction_map.get(&msg.id).unwrap_or(&Vec::new()),
                )
                .unwrap(),
            );
            val
        })
        .collect();

    Ok(Json(result))
}

async fn send_message(
    State(state): State<AppState>,
    user: AuthUser,
    Path(channel_id): Path<Uuid>,
    Json(body): Json<SendMessageRequest>,
) -> Result<impl IntoResponse, ApiError> {
    if body.content.is_empty() || body.content.len() > 4000 {
        return Err(ApiError::InvalidInput(
            "Message must be 1-4000 characters".into(),
        ));
    }

    let (channel, _, _) = resolve_channel_with_perm(
        &state,
        channel_id,
        user.user_id,
        Permissions::VIEW_CHANNEL | Permissions::SEND_MESSAGES,
    )
    .await?;

    let instance_id =
        queries::ensure_local_instance(&state.db, &state.config.instance.domain).await?;

    let message_id = Uuid::now_v7();
    let message = queries::create_message(
        &state.db,
        message_id,
        instance_id,
        channel_id,
        user.user_id,
        &body.content,
        body.reply_to_id,
    )
    .await?;

    // Update the channel's last_message_id for unread tracking
    let _ = queries::update_channel_last_message(&state.db, channel_id, message_id).await;

    // Parse mentions and increment mention counts
    let mentioned_user_ids = parse_mentions(
        &state.db,
        &body.content,
        user.user_id,
        channel.server_id,
    )
    .await;
    if !mentioned_user_ids.is_empty() {
        let _ = queries::increment_mention_counts(&state.db, channel_id, &mentioned_user_ids).await;
    }

    let author = queries::get_user_by_id(&state.db, user.user_id)
        .await?
        .ok_or(ApiError::NotFound("User"))?;

    let event = MessageCreateEvent {
        message: message.clone(),
        author: PublicUser::from(author),
    };

    if let Some(sid) = channel.server_id {
        state
            .gateway
            .broadcast_to_server(sid, "MESSAGE_CREATE", &event, None);
    } else {
        // DM/GroupDM — reopen for any members who closed it, then dispatch
        queries::reopen_dm_for_members(&state.db, channel_id).await?;
        let members = queries::get_dm_members(&state.db, channel_id).await?;
        let recipients: Vec<PublicUser> = members.iter().map(|m| PublicUser::from(m.clone())).collect();
        let dm_event = crate::types::events::DmChannelCreateEvent {
            channel: channel.clone(),
            recipients,
        };
        for member in &members {
            state
                .gateway
                .dispatch_to_user(member.id, "DM_CHANNEL_CREATE", &dm_event);
            state
                .gateway
                .dispatch_to_user(member.id, "MESSAGE_CREATE", &event);
        }
    }

    Ok(Json(message))
}

// ── Message Edit / Delete ────────────────────────────

async fn edit_message(
    State(state): State<AppState>,
    user: AuthUser,
    Path((channel_id, message_id)): Path<(Uuid, Uuid)>,
    Json(body): Json<EditMessageRequest>,
) -> Result<impl IntoResponse, ApiError> {
    if body.content.is_empty() || body.content.len() > 4000 {
        return Err(ApiError::InvalidInput(
            "Message must be 1-4000 characters".into(),
        ));
    }

    let (channel, _, _) =
        resolve_channel_with_perm(&state, channel_id, user.user_id, Permissions::VIEW_CHANNEL)
            .await?;

    let message = queries::get_message_by_id(&state.db, message_id)
        .await?
        .ok_or(ApiError::NotFound("Message"))?;

    if message.channel_id != channel_id {
        return Err(ApiError::NotFound("Message"));
    }

    // Only the author can edit their own message
    if message.author_id != user.user_id {
        return Err(ApiError::Forbidden);
    }

    let updated = queries::update_message_content(&state.db, message_id, &body.content).await?;
    let attachments = queries::get_message_attachments(&state.db, message_id).await?;
    let reactions = build_reaction_groups(&state, message_id, user.user_id).await?;

    let event = MessageUpdateEvent {
        message: updated.clone(),
        attachments: attachments.clone(),
        reactions: reactions.clone(),
    };

    if let Some(sid) = channel.server_id {
        state
            .gateway
            .broadcast_to_server(sid, "MESSAGE_UPDATE", &event, None);
    } else {
        let members = queries::get_dm_members(&state.db, channel_id).await?;
        for member in &members {
            state
                .gateway
                .dispatch_to_user(member.id, "MESSAGE_UPDATE", &event);
        }
    }

    Ok(Json(event))
}

async fn delete_message(
    State(state): State<AppState>,
    user: AuthUser,
    Path((channel_id, message_id)): Path<(Uuid, Uuid)>,
) -> Result<impl IntoResponse, ApiError> {
    let (channel, server_id, owner_id) =
        resolve_channel_with_perm(&state, channel_id, user.user_id, Permissions::VIEW_CHANNEL)
            .await?;

    let message = queries::get_message_by_id(&state.db, message_id)
        .await?
        .ok_or(ApiError::NotFound("Message"))?;

    if message.channel_id != channel_id {
        return Err(ApiError::NotFound("Message"));
    }

    // Author can delete own messages; MANAGE_MESSAGES can delete any
    if message.author_id != user.user_id {
        if let (Some(sid), Some(oid)) = (server_id, owner_id) {
            if !perm_service::has_channel_permission(
                &state.db,
                sid,
                channel_id,
                user.user_id,
                oid,
                Permissions::MANAGE_MESSAGES,
            )
            .await?
            {
                return Err(ApiError::Forbidden);
            }
        } else {
            return Err(ApiError::Forbidden);
        }
    }

    queries::delete_message(&state.db, message_id).await?;

    let event = MessageDeleteEvent {
        id: message_id,
        channel_id,
        server_id: channel.server_id,
    };

    if let Some(sid) = channel.server_id {
        state
            .gateway
            .broadcast_to_server(sid, "MESSAGE_DELETE", &event, None);
    } else {
        let members = queries::get_dm_members(&state.db, channel_id).await?;
        for member in &members {
            state
                .gateway
                .dispatch_to_user(member.id, "MESSAGE_DELETE", &event);
        }
    }

    Ok(axum::http::StatusCode::NO_CONTENT)
}

// ── Reactions ─────────────────────────────────────────

async fn add_reaction(
    State(state): State<AppState>,
    user: AuthUser,
    Path((channel_id, message_id, emoji)): Path<(Uuid, Uuid, String)>,
) -> Result<impl IntoResponse, ApiError> {
    let (channel, _, _) = resolve_channel_with_perm(
        &state,
        channel_id,
        user.user_id,
        Permissions::VIEW_CHANNEL | Permissions::ADD_REACTIONS,
    )
    .await?;

    let message = queries::get_message_by_id(&state.db, message_id)
        .await?
        .ok_or(ApiError::NotFound("Message"))?;

    if message.channel_id != channel_id {
        return Err(ApiError::NotFound("Message"));
    }

    queries::add_reaction(&state.db, message_id, user.user_id, &emoji, None).await?;

    let event = ReactionAddEvent {
        message_id,
        channel_id,
        user_id: user.user_id,
        emoji_name: emoji,
        emoji_id: None,
    };

    if let Some(sid) = channel.server_id {
        state
            .gateway
            .broadcast_to_server(sid, "REACTION_ADD", &event, None);
    } else {
        let members = queries::get_dm_members(&state.db, channel_id).await?;
        for member in &members {
            state
                .gateway
                .dispatch_to_user(member.id, "REACTION_ADD", &event);
        }
    }

    Ok(axum::http::StatusCode::NO_CONTENT)
}

async fn remove_reaction(
    State(state): State<AppState>,
    user: AuthUser,
    Path((channel_id, message_id, emoji)): Path<(Uuid, Uuid, String)>,
) -> Result<impl IntoResponse, ApiError> {
    let (channel, _, _) =
        resolve_channel_with_perm(&state, channel_id, user.user_id, Permissions::VIEW_CHANNEL)
            .await?;

    let message = queries::get_message_by_id(&state.db, message_id)
        .await?
        .ok_or(ApiError::NotFound("Message"))?;

    if message.channel_id != channel_id {
        return Err(ApiError::NotFound("Message"));
    }

    queries::remove_reaction(&state.db, message_id, user.user_id, &emoji).await?;

    let event = ReactionRemoveEvent {
        message_id,
        channel_id,
        user_id: user.user_id,
        emoji_name: emoji,
    };

    if let Some(sid) = channel.server_id {
        state
            .gateway
            .broadcast_to_server(sid, "REACTION_REMOVE", &event, None);
    } else {
        let members = queries::get_dm_members(&state.db, channel_id).await?;
        for member in &members {
            state
                .gateway
                .dispatch_to_user(member.id, "REACTION_REMOVE", &event);
        }
    }

    Ok(axum::http::StatusCode::NO_CONTENT)
}

// ── Pins ──────────────────────────────────────────────

async fn pin_message(
    State(state): State<AppState>,
    user: AuthUser,
    Path((channel_id, message_id)): Path<(Uuid, Uuid)>,
) -> Result<impl IntoResponse, ApiError> {
    let (channel, server_id, owner_id) = resolve_channel_with_perm(
        &state,
        channel_id,
        user.user_id,
        Permissions::VIEW_CHANNEL,
    )
    .await?;

    // MANAGE_MESSAGES required to pin
    if let (Some(sid), Some(oid)) = (server_id, owner_id) {
        if !perm_service::has_channel_permission(
            &state.db,
            sid,
            channel_id,
            user.user_id,
            oid,
            Permissions::MANAGE_MESSAGES,
        )
        .await?
        {
            return Err(ApiError::Forbidden);
        }
    }

    let message = queries::get_message_by_id(&state.db, message_id)
        .await?
        .ok_or(ApiError::NotFound("Message"))?;

    if message.channel_id != channel_id {
        return Err(ApiError::NotFound("Message"));
    }

    queries::set_message_pinned(&state.db, message_id, true).await?;

    let event = MessagePinEvent {
        channel_id,
        message_id,
        pinned: true,
    };

    if let Some(sid) = channel.server_id {
        state
            .gateway
            .broadcast_to_server(sid, "MESSAGE_PIN", &event, None);
    } else {
        let members = queries::get_dm_members(&state.db, channel_id).await?;
        for member in &members {
            state
                .gateway
                .dispatch_to_user(member.id, "MESSAGE_PIN", &event);
        }
    }

    Ok(axum::http::StatusCode::NO_CONTENT)
}

async fn unpin_message(
    State(state): State<AppState>,
    user: AuthUser,
    Path((channel_id, message_id)): Path<(Uuid, Uuid)>,
) -> Result<impl IntoResponse, ApiError> {
    let (channel, server_id, owner_id) = resolve_channel_with_perm(
        &state,
        channel_id,
        user.user_id,
        Permissions::VIEW_CHANNEL,
    )
    .await?;

    if let (Some(sid), Some(oid)) = (server_id, owner_id) {
        if !perm_service::has_channel_permission(
            &state.db,
            sid,
            channel_id,
            user.user_id,
            oid,
            Permissions::MANAGE_MESSAGES,
        )
        .await?
        {
            return Err(ApiError::Forbidden);
        }
    }

    let message = queries::get_message_by_id(&state.db, message_id)
        .await?
        .ok_or(ApiError::NotFound("Message"))?;

    if message.channel_id != channel_id {
        return Err(ApiError::NotFound("Message"));
    }

    queries::set_message_pinned(&state.db, message_id, false).await?;

    let event = MessagePinEvent {
        channel_id,
        message_id,
        pinned: false,
    };

    if let Some(sid) = channel.server_id {
        state
            .gateway
            .broadcast_to_server(sid, "MESSAGE_PIN", &event, None);
    } else {
        let members = queries::get_dm_members(&state.db, channel_id).await?;
        for member in &members {
            state
                .gateway
                .dispatch_to_user(member.id, "MESSAGE_PIN", &event);
        }
    }

    Ok(axum::http::StatusCode::NO_CONTENT)
}

async fn get_pinned_messages(
    State(state): State<AppState>,
    user: AuthUser,
    Path(channel_id): Path<Uuid>,
) -> Result<impl IntoResponse, ApiError> {
    resolve_channel_with_perm(
        &state,
        channel_id,
        user.user_id,
        Permissions::VIEW_CHANNEL | Permissions::READ_MESSAGE_HISTORY,
    )
    .await?;

    let messages = queries::get_pinned_messages(&state.db, channel_id).await?;
    Ok(Json(messages))
}

// ── File Upload ──────────────────────────────────────

async fn request_upload(
    State(state): State<AppState>,
    user: AuthUser,
    Path(channel_id): Path<Uuid>,
    multipart: axum::extract::Multipart,
) -> Result<impl IntoResponse, ApiError> {
    resolve_channel_with_perm(
        &state,
        channel_id,
        user.user_id,
        Permissions::VIEW_CHANNEL | Permissions::ATTACH_FILES,
    )
    .await?;

    let s3 = state
        .s3
        .as_ref()
        .ok_or_else(|| ApiError::InvalidInput("File uploads not configured".into()))?;
    let s3_config = state
        .config
        .s3
        .as_ref()
        .ok_or_else(|| ApiError::InvalidInput("File uploads not configured".into()))?;

    let (filename, content_type, data) =
        crate::services::uploads::extract_multipart_file(multipart, 25 * 1024 * 1024).await?;

    let attachment_id = Uuid::now_v7();
    let object_key = format!(
        "attachments/{}/{}/{}",
        channel_id, attachment_id, filename
    );

    let file_url =
        crate::services::uploads::upload_to_s3(s3, s3_config, &object_key, &content_type, data)
            .await?;

    Ok(Json(UploadUrlResponse {
        upload_url: String::new(),
        file_url,
        attachment_id: attachment_id.to_string(),
    }))
}

// ── Channel Override Endpoints ────────────────────────

async fn list_overrides(
    State(state): State<AppState>,
    user: AuthUser,
    Path(channel_id): Path<Uuid>,
) -> Result<impl IntoResponse, ApiError> {
    let channel = queries::get_channel_by_id(&state.db, channel_id)
        .await?
        .ok_or(ApiError::NotFound("Channel"))?;

    let server_id = channel.server_id.ok_or(ApiError::InvalidInput(
        "Channel overrides only apply to server channels".into(),
    ))?;

    let server = queries::get_server_by_id(&state.db, server_id)
        .await?
        .ok_or(ApiError::NotFound("Server"))?;

    queries::get_server_member(&state.db, server_id, user.user_id)
        .await?
        .ok_or(ApiError::NotFound("Channel"))?;

    // Need MANAGE_ROLES to view overrides
    if !perm_service::has_server_permission(
        &state.db,
        server_id,
        user.user_id,
        server.owner_id,
        Permissions::MANAGE_ROLES,
    )
    .await?
    {
        return Err(ApiError::Forbidden);
    }

    let overrides = queries::get_channel_overrides(&state.db, channel_id).await?;
    Ok(Json(overrides))
}

async fn set_override(
    State(state): State<AppState>,
    user: AuthUser,
    Path((channel_id, target_type, target_id)): Path<(Uuid, String, Uuid)>,
    Json(body): Json<SetChannelOverrideRequest>,
) -> Result<impl IntoResponse, ApiError> {
    if target_type != "role" && target_type != "member" {
        return Err(ApiError::InvalidInput(
            "target_type must be 'role' or 'member'".into(),
        ));
    }

    let channel = queries::get_channel_by_id(&state.db, channel_id)
        .await?
        .ok_or(ApiError::NotFound("Channel"))?;

    let server_id = channel.server_id.ok_or(ApiError::InvalidInput(
        "Channel overrides only apply to server channels".into(),
    ))?;

    let server = queries::get_server_by_id(&state.db, server_id)
        .await?
        .ok_or(ApiError::NotFound("Server"))?;

    // Need MANAGE_ROLES permission
    if !perm_service::has_server_permission(
        &state.db,
        server_id,
        user.user_id,
        server.owner_id,
        Permissions::MANAGE_ROLES,
    )
    .await?
    {
        return Err(ApiError::Forbidden);
    }

    let override_id = Uuid::now_v7();
    let channel_override = queries::set_channel_override(
        &state.db,
        override_id,
        channel_id,
        &target_type,
        target_id,
        body.allow,
        body.deny,
    )
    .await?;

    // Broadcast all overrides for this channel
    let all_overrides = queries::get_channel_overrides(&state.db, channel_id).await?;
    let event = ChannelOverrideUpdateEvent {
        server_id,
        channel_id,
        overrides: all_overrides,
    };
    state
        .gateway
        .broadcast_to_server(server_id, "CHANNEL_OVERRIDE_UPDATE", &event, None);

    Ok(Json(channel_override))
}

async fn delete_override(
    State(state): State<AppState>,
    user: AuthUser,
    Path((channel_id, target_type, target_id)): Path<(Uuid, String, Uuid)>,
) -> Result<impl IntoResponse, ApiError> {
    if target_type != "role" && target_type != "member" {
        return Err(ApiError::InvalidInput(
            "target_type must be 'role' or 'member'".into(),
        ));
    }

    let channel = queries::get_channel_by_id(&state.db, channel_id)
        .await?
        .ok_or(ApiError::NotFound("Channel"))?;

    let server_id = channel.server_id.ok_or(ApiError::InvalidInput(
        "Channel overrides only apply to server channels".into(),
    ))?;

    let server = queries::get_server_by_id(&state.db, server_id)
        .await?
        .ok_or(ApiError::NotFound("Server"))?;

    if !perm_service::has_server_permission(
        &state.db,
        server_id,
        user.user_id,
        server.owner_id,
        Permissions::MANAGE_ROLES,
    )
    .await?
    {
        return Err(ApiError::Forbidden);
    }

    queries::delete_channel_override(&state.db, channel_id, &target_type, target_id).await?;

    let all_overrides = queries::get_channel_overrides(&state.db, channel_id).await?;
    let event = ChannelOverrideUpdateEvent {
        server_id,
        channel_id,
        overrides: all_overrides,
    };
    state
        .gateway
        .broadcast_to_server(server_id, "CHANNEL_OVERRIDE_UPDATE", &event, None);

    Ok(axum::http::StatusCode::NO_CONTENT)
}

// ── Threads ──────────────────────────────────────────

async fn create_thread(
    State(state): State<AppState>,
    user: AuthUser,
    Path(channel_id): Path<Uuid>,
    Json(body): Json<CreateThreadRequest>,
) -> Result<impl IntoResponse, ApiError> {
    if body.name.is_empty() || body.name.len() > 100 {
        return Err(ApiError::InvalidInput(
            "Thread name must be 1-100 characters".into(),
        ));
    }

    let (parent_channel, server_id, _) = resolve_channel_with_perm(
        &state,
        channel_id,
        user.user_id,
        Permissions::VIEW_CHANNEL | Permissions::SEND_MESSAGES,
    )
    .await?;

    let instance_id =
        queries::ensure_local_instance(&state.db, &state.config.instance.domain).await?;

    let thread_id = Uuid::now_v7();
    let thread_channel = queries::create_channel(
        &state.db,
        thread_id,
        instance_id,
        parent_channel.server_id,
        ChannelType::Text,
        Some(&body.name),
        None,
        Some(channel_id),
        0,
    )
    .await?;

    let metadata =
        queries::create_thread_metadata(&state.db, thread_id, channel_id, body.message_id).await?;

    let event = ThreadCreateEvent {
        channel: thread_channel.clone(),
        metadata: metadata.clone(),
        parent_channel_id: channel_id,
        server_id: parent_channel.server_id,
    };

    if let Some(sid) = server_id {
        state
            .gateway
            .broadcast_to_server(sid, "THREAD_CREATE", &event, None);
    } else {
        let members = queries::get_dm_members(&state.db, channel_id).await?;
        for member in &members {
            state
                .gateway
                .dispatch_to_user(member.id, "THREAD_CREATE", &event);
        }
    }

    Ok(Json(serde_json::json!({
        "channel": thread_channel,
        "metadata": metadata,
    })))
}

async fn list_threads(
    State(state): State<AppState>,
    user: AuthUser,
    Path(channel_id): Path<Uuid>,
) -> Result<impl IntoResponse, ApiError> {
    resolve_channel_with_perm(
        &state,
        channel_id,
        user.user_id,
        Permissions::VIEW_CHANNEL,
    )
    .await?;

    let threads = queries::get_channel_threads(&state.db, channel_id).await?;
    Ok(Json(threads))
}

// ── Typing Indicators ────────────────────────────────

async fn typing_start(
    State(state): State<AppState>,
    user: AuthUser,
    Path(channel_id): Path<Uuid>,
) -> Result<impl IntoResponse, ApiError> {
    let (_, server_id, _) = resolve_channel_with_perm(
        &state,
        channel_id,
        user.user_id,
        Permissions::VIEW_CHANNEL | Permissions::SEND_MESSAGES,
    )
    .await?;

    let event = TypingStartEvent {
        channel_id,
        user_id: user.user_id,
        timestamp: Utc::now().timestamp(),
    };

    if let Some(sid) = server_id {
        state.gateway.broadcast_to_server(
            sid,
            "TYPING_START",
            &event,
            Some(user.user_id),
        );
    } else {
        let members = queries::get_dm_members(&state.db, channel_id).await?;
        for member in &members {
            if member.id != user.user_id {
                state
                    .gateway
                    .dispatch_to_user(member.id, "TYPING_START", &event);
            }
        }
    }

    Ok(axum::http::StatusCode::NO_CONTENT)
}

// ── Ack (Read State) ─────────────────────────────────

async fn ack_message(
    State(state): State<AppState>,
    user: AuthUser,
    Path(channel_id): Path<Uuid>,
    Json(body): Json<AckMessageRequest>,
) -> Result<impl IntoResponse, ApiError> {
    // Verify the user has access to this channel
    resolve_channel_with_perm(&state, channel_id, user.user_id, Permissions::VIEW_CHANNEL)
        .await?;

    queries::ack_channel(&state.db, user.user_id, channel_id, body.message_id).await?;

    let event = MessageAckEvent {
        channel_id,
        message_id: body.message_id,
    };
    state
        .gateway
        .dispatch_to_user(user.user_id, "MESSAGE_ACK", &event);

    Ok(axum::http::StatusCode::NO_CONTENT)
}

// ── Helpers ───────────────────────────────────────────

static RE_MENTION_ID: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"<@([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})>").unwrap());
static RE_MENTION_NAME: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"@(\w{2,32})").unwrap());

/// Parse `<@uuid>` and `@username` mentions from message content.
/// Returns a deduplicated list of mentioned user IDs (excluding the author).
async fn parse_mentions(
    pool: &sqlx::PgPool,
    content: &str,
    author_id: Uuid,
    server_id: Option<Uuid>,
) -> Vec<Uuid> {
    let mut mentioned: std::collections::HashSet<Uuid> = std::collections::HashSet::new();

    // Direct ID mentions: <@uuid>
    for cap in RE_MENTION_ID.captures_iter(content) {
        if let Ok(uid) = cap[1].parse::<Uuid>() {
            if uid != author_id {
                mentioned.insert(uid);
            }
        }
    }

    // Username mentions: @username
    for cap in RE_MENTION_NAME.captures_iter(content) {
        let username = &cap[1];
        if let Ok(Some(user)) = queries::get_user_by_username(pool, username).await {
            if user.id != author_id {
                mentioned.insert(user.id);
            }
        }
    }

    // For server channels, filter to actual server members
    if let Some(sid) = server_id {
        if let Ok(members) = queries::get_server_members(pool, sid).await {
            let member_ids: std::collections::HashSet<Uuid> =
                members.iter().map(|m| m.user_id).collect();
            mentioned.retain(|uid| member_ids.contains(uid));
        }
    }

    mentioned.into_iter().collect()
}

async fn build_reaction_groups(
    state: &AppState,
    message_id: Uuid,
    current_user_id: Uuid,
) -> Result<Vec<ReactionGroup>, ApiError> {
    let reactions = queries::get_message_reactions(&state.db, message_id).await?;
    let mut groups: Vec<ReactionGroup> = Vec::new();

    for reaction in &reactions {
        if let Some(group) = groups.iter_mut().find(|g| g.emoji_name == reaction.emoji_name) {
            group.count += 1;
            if reaction.user_id == current_user_id {
                group.me = true;
            }
        } else {
            groups.push(ReactionGroup {
                emoji_name: reaction.emoji_name.clone(),
                emoji_id: reaction.emoji_id,
                count: 1,
                me: reaction.user_id == current_user_id,
            });
        }
    }

    Ok(groups)
}
