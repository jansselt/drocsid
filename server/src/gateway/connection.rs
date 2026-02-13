use axum::extract::ws::{Message, WebSocket};
use futures_util::{SinkExt, StreamExt};
use tokio::sync::mpsc;
use uuid::Uuid;

use crate::db::queries;
use crate::error::ApiError;
use crate::services::auth;
use crate::state::AppState;
use crate::types::entities::PublicUser;
use crate::types::events::{
    ClientPresenceUpdate, GatewayOpcode, GatewayPayload, IdentifyPayload, ReadyPayload,
};

pub async fn handle_connection(state: AppState, socket: WebSocket) {
    let (mut ws_sender, mut ws_receiver) = socket.split();
    let (tx, mut rx) = mpsc::unbounded_channel::<GatewayPayload>();

    // Send Hello
    let hello = GatewayPayload::hello(state.gateway.heartbeat_interval());
    if ws_sender
        .send(Message::Text(serde_json::to_string(&hello).unwrap().into()))
        .await
        .is_err()
    {
        return;
    }

    // Spawn sender task - forwards channel messages to WebSocket
    let sender_task = tokio::spawn(async move {
        while let Some(payload) = rx.recv().await {
            let text = match serde_json::to_string(&payload) {
                Ok(t) => t,
                Err(_) => continue,
            };
            if ws_sender.send(Message::Text(text.into())).await.is_err() {
                break;
            }
        }
    });

    let session_id = Uuid::now_v7();
    let mut identified = false;
    let mut user_id: Option<Uuid> = None;

    // Receive loop
    while let Some(Ok(msg)) = ws_receiver.next().await {
        let text = match msg {
            Message::Text(t) => t.to_string(),
            Message::Close(_) => break,
            _ => continue,
        };

        let payload: GatewayPayload = match serde_json::from_str(&text) {
            Ok(p) => p,
            Err(_) => continue,
        };

        match payload.op {
            op if op == GatewayOpcode::Identify as u8 => {
                if identified {
                    continue;
                }

                let identify: IdentifyPayload = match payload
                    .d
                    .and_then(|d| serde_json::from_value(d).ok())
                {
                    Some(i) => i,
                    None => {
                        let _ = tx.send(GatewayPayload::invalid_session(false));
                        break;
                    }
                };

                match handle_identify(&state, session_id, &identify, &tx).await {
                    Ok(uid) => {
                        identified = true;
                        user_id = Some(uid);
                    }
                    Err(_) => {
                        let _ = tx.send(GatewayPayload::invalid_session(false));
                        break;
                    }
                }
            }
            op if op == GatewayOpcode::PresenceUpdate as u8 => {
                if let Some(uid) = user_id {
                    if let Some(update) = payload
                        .d
                        .and_then(|d| serde_json::from_value::<ClientPresenceUpdate>(d).ok())
                    {
                        state.gateway.update_presence(uid, &update.status);
                    }
                }
            }
            op if op == GatewayOpcode::Heartbeat as u8 => {
                let _ = tx.send(GatewayPayload::heartbeat_ack());
            }
            _ => {}
        }
    }

    // Cleanup
    state.gateway.remove_connection(session_id);
    sender_task.abort();

    if let Some(uid) = user_id {
        tracing::info!(user_id = %uid, session_id = %session_id, "Client disconnected");
    }
}

async fn handle_identify(
    state: &AppState,
    session_id: Uuid,
    identify: &IdentifyPayload,
    tx: &mpsc::UnboundedSender<GatewayPayload>,
) -> Result<Uuid, ApiError> {
    // Validate token
    let uid = auth::validate_access_token(&state.config, &identify.token)?;

    // Get user
    let user = queries::get_user_by_id(&state.db, uid)
        .await?
        .ok_or(ApiError::Unauthorized)?;

    // Get user's servers
    let servers = queries::get_user_servers(&state.db, uid).await?;
    let server_ids: Vec<Uuid> = servers.iter().map(|s| s.id).collect();

    // Register connection
    state.gateway.add_connection(session_id, uid, tx.clone());
    state.gateway.subscribe_to_servers(session_id, &server_ids);

    // Send Ready
    let ready = ReadyPayload {
        session_id,
        user: PublicUser::from(user),
        servers,
    };

    let seq = state.gateway.next_seq(session_id).unwrap_or(1);
    let _ = tx.send(GatewayPayload::ready(ready, seq));

    // Set user as online and cache their server list for presence broadcasts
    state.gateway.set_online(uid, &server_ids);

    tracing::info!(user_id = %uid, session_id = %session_id, servers = server_ids.len(), "Client identified");

    Ok(uid)
}
