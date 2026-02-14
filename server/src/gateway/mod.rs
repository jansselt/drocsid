pub mod connection;

use std::collections::HashSet;
use std::sync::atomic::{AtomicU64, Ordering};

use dashmap::DashMap;
use tokio::sync::mpsc;
use uuid::Uuid;

use crate::types::events::{GatewayPayload, PresenceUpdateEvent, VoiceStateUpdateEvent};

const HEARTBEAT_INTERVAL_MS: u64 = 41250;

/// In-memory voice state for a user in a voice channel
#[derive(Debug, Clone)]
pub struct VoiceState {
    pub user_id: Uuid,
    pub channel_id: Uuid,
    pub server_id: Uuid,
    pub self_mute: bool,
    pub self_deaf: bool,
}

/// In-memory presence for a connected user
#[derive(Debug, Clone)]
pub struct UserPresence {
    pub status: String,
    pub custom_status: Option<String>,
}

pub struct GatewayState {
    /// session_id -> Connection sender
    connections: DashMap<Uuid, ConnectionHandle>,
    /// user_id -> set of session_ids
    user_sessions: DashMap<Uuid, HashSet<Uuid>>,
    /// server_id -> set of session_ids
    server_subscriptions: DashMap<Uuid, HashSet<Uuid>>,
    /// user_id -> VoiceState (a user can only be in one voice channel)
    voice_states: DashMap<Uuid, VoiceState>,
    /// channel_id -> set of user_ids in that voice channel
    voice_channels: DashMap<Uuid, HashSet<Uuid>>,
    /// user_id -> presence (online/idle/dnd while connected)
    presences: DashMap<Uuid, UserPresence>,
    /// user_id -> set of server_ids they belong to (cached on identify)
    user_servers: DashMap<Uuid, HashSet<Uuid>>,
}

struct ConnectionHandle {
    user_id: Uuid,
    sender: mpsc::UnboundedSender<GatewayPayload>,
    sequence: AtomicU64,
}

impl GatewayState {
    pub fn new() -> Self {
        Self {
            connections: DashMap::new(),
            user_sessions: DashMap::new(),
            server_subscriptions: DashMap::new(),
            voice_states: DashMap::new(),
            voice_channels: DashMap::new(),
            presences: DashMap::new(),
            user_servers: DashMap::new(),
        }
    }

    pub fn add_connection(
        &self,
        session_id: Uuid,
        user_id: Uuid,
        sender: mpsc::UnboundedSender<GatewayPayload>,
    ) {
        self.connections.insert(
            session_id,
            ConnectionHandle {
                user_id,
                sender,
                sequence: AtomicU64::new(0),
            },
        );

        self.user_sessions
            .entry(user_id)
            .or_default()
            .insert(session_id);
    }

    pub fn remove_connection(&self, session_id: Uuid) {
        if let Some((_, handle)) = self.connections.remove(&session_id) {
            let user_id = handle.user_id;
            let mut is_last_session = false;

            if let Some(mut sessions) = self.user_sessions.get_mut(&user_id) {
                sessions.remove(&session_id);
                if sessions.is_empty() {
                    is_last_session = true;
                    drop(sessions);
                    self.user_sessions.remove(&user_id);
                }
            }

            if is_last_session {
                // Leave voice
                self.voice_leave(user_id);

                // Broadcast offline presence to all shared servers
                self.broadcast_presence(user_id, "offline", None);
                self.presences.remove(&user_id);
                self.user_servers.remove(&user_id);
            }

            // Remove from all server subscriptions
            self.server_subscriptions.iter_mut().for_each(|mut entry| {
                entry.value_mut().remove(&session_id);
            });
        }
    }

    pub fn subscribe_to_server(&self, session_id: Uuid, server_id: Uuid) {
        self.server_subscriptions
            .entry(server_id)
            .or_default()
            .insert(session_id);
    }

    pub fn subscribe_to_servers(&self, session_id: Uuid, server_ids: &[Uuid]) {
        for server_id in server_ids {
            self.subscribe_to_server(session_id, *server_id);
        }
    }

    /// Send a payload to a specific session
    pub fn send_to_session(&self, session_id: Uuid, payload: GatewayPayload) {
        if let Some(handle) = self.connections.get(&session_id) {
            let _ = handle.sender.send(payload);
        }
    }

    /// Send a dispatch event to a specific session, incrementing the sequence counter
    pub fn dispatch_to_session(&self, session_id: Uuid, event: &str, data: impl serde::Serialize) {
        if let Some(handle) = self.connections.get(&session_id) {
            let seq = handle.sequence.fetch_add(1, Ordering::Relaxed) + 1;
            let payload = GatewayPayload::dispatch(event, data, seq);
            let _ = handle.sender.send(payload);
        }
    }

    /// Broadcast a dispatch event to all sessions subscribed to a server
    pub fn broadcast_to_server(
        &self,
        server_id: Uuid,
        event: &str,
        data: &impl serde::Serialize,
        exclude_user: Option<Uuid>,
    ) {
        if let Some(sessions) = self.server_subscriptions.get(&server_id) {
            for session_id in sessions.iter() {
                if let Some(handle) = self.connections.get(session_id) {
                    if exclude_user == Some(handle.user_id) {
                        continue;
                    }
                    let seq = handle.sequence.fetch_add(1, Ordering::Relaxed) + 1;
                    let payload = GatewayPayload::dispatch(
                        event,
                        data,
                        seq,
                    );
                    let _ = handle.sender.send(payload);
                }
            }
        }
    }

    /// Send a dispatch event to all sessions of a specific user
    pub fn dispatch_to_user(&self, user_id: Uuid, event: &str, data: &impl serde::Serialize) {
        if let Some(sessions) = self.user_sessions.get(&user_id) {
            for session_id in sessions.iter() {
                self.dispatch_to_session(*session_id, event, data);
            }
        }
    }

    /// Subscribe all of a user's active sessions to a server
    pub fn subscribe_to_server_for_user(&self, user_id: Uuid, server_id: Uuid) {
        if let Some(sessions) = self.user_sessions.get(&user_id) {
            for session_id in sessions.iter() {
                self.subscribe_to_server(*session_id, server_id);
            }
        }
    }

    /// Get the next sequence number for a session (used by connection handler)
    pub fn next_seq(&self, session_id: Uuid) -> Option<u64> {
        self.connections
            .get(&session_id)
            .map(|h| h.sequence.fetch_add(1, Ordering::Relaxed) + 1)
    }

    pub fn heartbeat_interval(&self) -> u64 {
        HEARTBEAT_INTERVAL_MS
    }

    // ── Voice State ──────────────────────────────────────

    /// Join a voice channel. Returns the previous channel_id if the user was already in one.
    pub fn voice_join(
        &self,
        user_id: Uuid,
        channel_id: Uuid,
        server_id: Uuid,
        self_mute: bool,
        self_deaf: bool,
    ) -> Option<Uuid> {
        // Remove from previous voice channel if any
        let prev_channel = self.voice_leave(user_id);

        // Add to new channel
        self.voice_states.insert(user_id, VoiceState {
            user_id,
            channel_id,
            server_id,
            self_mute,
            self_deaf,
        });
        self.voice_channels
            .entry(channel_id)
            .or_default()
            .insert(user_id);

        // Broadcast join to server
        let event = VoiceStateUpdateEvent {
            server_id,
            channel_id: Some(channel_id),
            user_id,
            self_mute,
            self_deaf,
        };
        self.broadcast_to_server(server_id, "VOICE_STATE_UPDATE", &event, None);

        prev_channel
    }

    /// Leave the current voice channel. Returns the channel_id that was left.
    pub fn voice_leave(&self, user_id: Uuid) -> Option<Uuid> {
        if let Some((_, state)) = self.voice_states.remove(&user_id) {
            if let Some(mut users) = self.voice_channels.get_mut(&state.channel_id) {
                users.remove(&user_id);
                if users.is_empty() {
                    drop(users);
                    self.voice_channels.remove(&state.channel_id);
                }
            }

            // Broadcast leave to server
            let event = VoiceStateUpdateEvent {
                server_id: state.server_id,
                channel_id: None,
                user_id,
                self_mute: false,
                self_deaf: false,
            };
            self.broadcast_to_server(state.server_id, "VOICE_STATE_UPDATE", &event, None);

            Some(state.channel_id)
        } else {
            None
        }
    }

    /// Update mute/deaf state for a user in voice
    pub fn voice_update(&self, user_id: Uuid, self_mute: bool, self_deaf: bool) -> bool {
        if let Some(mut state) = self.voice_states.get_mut(&user_id) {
            state.self_mute = self_mute;
            state.self_deaf = self_deaf;

            let event = VoiceStateUpdateEvent {
                server_id: state.server_id,
                channel_id: Some(state.channel_id),
                user_id,
                self_mute,
                self_deaf,
            };
            self.broadcast_to_server(state.server_id, "VOICE_STATE_UPDATE", &event, None);
            true
        } else {
            false
        }
    }

    /// Get all voice states for a specific channel
    pub fn voice_channel_users(&self, channel_id: Uuid) -> Vec<VoiceState> {
        let user_ids: Vec<Uuid> = self.voice_channels
            .get(&channel_id)
            .map(|users| users.iter().copied().collect())
            .unwrap_or_default();

        user_ids
            .into_iter()
            .filter_map(|uid| self.voice_states.get(&uid).map(|s| s.clone()))
            .collect()
    }

    /// Get a user's current voice state
    pub fn voice_state(&self, user_id: Uuid) -> Option<VoiceState> {
        self.voice_states.get(&user_id).map(|s| s.clone())
    }

    // ── Presence ──────────────────────────────────────────

    /// Set a user online and cache their server list for presence broadcasting
    pub fn set_online(&self, user_id: Uuid, server_ids: &[Uuid]) {
        self.presences.insert(
            user_id,
            UserPresence {
                status: "online".into(),
                custom_status: None,
            },
        );
        let mut servers = HashSet::new();
        for sid in server_ids {
            servers.insert(*sid);
        }
        self.user_servers.insert(user_id, servers);

        self.broadcast_presence(user_id, "online", None);
    }

    /// Update a user's presence status
    pub fn update_presence(&self, user_id: Uuid, status: &str) {
        let valid = matches!(status, "online" | "idle" | "dnd" | "invisible");
        if !valid {
            return;
        }

        if let Some(mut presence) = self.presences.get_mut(&user_id) {
            presence.status = status.to_string();
        }

        // Invisible users appear offline to others
        let broadcast_status = if status == "invisible" { "offline" } else { status };
        self.broadcast_presence(user_id, broadcast_status, None);
    }

    /// Get a user's public presence status (returns "offline" if not connected or invisible)
    pub fn get_presence(&self, user_id: Uuid) -> String {
        self.presences
            .get(&user_id)
            .map(|p| if p.status == "invisible" { "offline".into() } else { p.status.clone() })
            .unwrap_or_else(|| "offline".into())
    }

    /// Broadcast a presence update to all servers the user belongs to
    fn broadcast_presence(&self, user_id: Uuid, status: &str, custom_status: Option<String>) {
        let event = PresenceUpdateEvent {
            user_id,
            status: status.into(),
            custom_status,
        };

        if let Some(servers) = self.user_servers.get(&user_id) {
            for server_id in servers.iter() {
                self.broadcast_to_server(*server_id, "PRESENCE_UPDATE", &event, None);
            }
        }

        // Also dispatch to the user's own sessions
        self.dispatch_to_user(user_id, "PRESENCE_UPDATE", &event);
    }

    /// Add a server to a user's cached server list (called when they join a server while connected)
    pub fn add_user_server(&self, user_id: Uuid, server_id: Uuid) {
        if let Some(mut servers) = self.user_servers.get_mut(&user_id) {
            servers.insert(server_id);
        }
    }

    /// Remove a server from a user's cached server list
    pub fn remove_user_server(&self, user_id: Uuid, server_id: Uuid) {
        if let Some(mut servers) = self.user_servers.get_mut(&user_id) {
            servers.remove(&server_id);
        }
    }

    /// Check if a user is currently connected (has any sessions)
    pub fn is_online(&self, user_id: Uuid) -> bool {
        self.user_sessions.contains_key(&user_id)
    }
}
