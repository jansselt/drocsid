use bitflags::bitflags;
use serde::{Deserialize, Serialize};

bitflags! {
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
    #[serde(transparent)]
    pub struct Permissions: i64 {
        const CREATE_INSTANT_INVITE  = 1 << 0;
        const KICK_MEMBERS           = 1 << 1;
        const BAN_MEMBERS            = 1 << 2;
        const ADMINISTRATOR          = 1 << 3;
        const MANAGE_CHANNELS        = 1 << 4;
        const MANAGE_SERVER          = 1 << 5;
        const ADD_REACTIONS          = 1 << 6;
        const VIEW_AUDIT_LOG         = 1 << 7;
        const VIEW_CHANNEL           = 1 << 10;
        const SEND_MESSAGES          = 1 << 11;
        const MANAGE_MESSAGES        = 1 << 13;
        const EMBED_LINKS            = 1 << 14;
        const ATTACH_FILES           = 1 << 15;
        const READ_MESSAGE_HISTORY   = 1 << 16;
        const MENTION_EVERYONE       = 1 << 17;
        const USE_EXTERNAL_EMOJIS    = 1 << 18;
        const CONNECT                = 1 << 20;
        const SPEAK                  = 1 << 21;
        const MUTE_MEMBERS           = 1 << 22;
        const DEAFEN_MEMBERS         = 1 << 23;
        const MOVE_MEMBERS           = 1 << 24;
        const CHANGE_NICKNAME        = 1 << 26;
        const MANAGE_NICKNAMES       = 1 << 27;
        const MANAGE_ROLES           = 1 << 28;
        const MANAGE_WEBHOOKS        = 1 << 29;
        const MANAGE_EXPRESSIONS     = 1 << 30;
        const MANAGE_THREADS         = 1 << 34;
        const SEND_MESSAGES_IN_THREADS = 1 << 38;
        const MODERATE_MEMBERS       = 1 << 40;
        const USE_SOUNDBOARD         = 1 << 42;
        const MANAGE_SOUNDBOARD      = 1 << 43;
    }
}

impl Default for Permissions {
    fn default() -> Self {
        // Default permissions for @everyone role in a new server
        Self::VIEW_CHANNEL
            | Self::SEND_MESSAGES
            | Self::READ_MESSAGE_HISTORY
            | Self::ADD_REACTIONS
            | Self::CONNECT
            | Self::SPEAK
            | Self::CHANGE_NICKNAME
            | Self::CREATE_INSTANT_INVITE
            | Self::EMBED_LINKS
            | Self::ATTACH_FILES
            | Self::USE_EXTERNAL_EMOJIS
            | Self::MENTION_EVERYONE
            | Self::USE_SOUNDBOARD
    }
}
