use sqlx::PgPool;
use uuid::Uuid;

use crate::db::queries;
use crate::types::entities::{ChannelOverride, Role};
use crate::types::permissions::Permissions;

/// Compute effective permissions for a user in a server (server-level, no channel overrides).
///
/// Algorithm (matches Discord):
/// 1. Start with @everyone role permissions
/// 2. OR all the user's additional role permissions
/// 3. If ADMINISTRATOR is set, return ALL permissions
pub async fn compute_server_permissions(
    pool: &PgPool,
    server_id: Uuid,
    user_id: Uuid,
    owner_id: Uuid,
) -> Result<Permissions, sqlx::Error> {
    // Server owner always has all permissions
    if user_id == owner_id {
        return Ok(Permissions::all());
    }

    let roles = queries::get_server_roles(pool, server_id).await?;
    let member_role_ids = queries::get_member_role_ids(pool, server_id, user_id).await?;

    Ok(compute_base_permissions(&roles, &member_role_ids))
}

/// Compute effective permissions for a user in a specific channel.
///
/// Algorithm (matches Discord):
/// 1. Compute server-level base permissions
/// 2. If ADMINISTRATOR, short-circuit to ALL
/// 3. Apply @everyone channel overrides (deny, then allow)
/// 4. Apply all role overrides for the user's roles (OR together, deny then allow)
/// 5. Apply member-specific override (deny, then allow)
pub async fn compute_channel_permissions(
    pool: &PgPool,
    server_id: Uuid,
    channel_id: Uuid,
    user_id: Uuid,
    owner_id: Uuid,
) -> Result<Permissions, sqlx::Error> {
    // Server owner always has all permissions
    if user_id == owner_id {
        return Ok(Permissions::all());
    }

    let roles = queries::get_server_roles(pool, server_id).await?;
    let member_role_ids = queries::get_member_role_ids(pool, server_id, user_id).await?;

    let base = compute_base_permissions(&roles, &member_role_ids);

    // Administrator bypasses channel overrides
    if base.contains(Permissions::ADMINISTRATOR) {
        return Ok(Permissions::all());
    }

    let overrides = queries::get_channel_overrides(pool, channel_id).await?;

    Ok(apply_channel_overrides(base, &roles, &member_role_ids, &overrides, user_id))
}

/// Check if a user has a specific permission in a server.
pub async fn has_server_permission(
    pool: &PgPool,
    server_id: Uuid,
    user_id: Uuid,
    owner_id: Uuid,
    permission: Permissions,
) -> Result<bool, sqlx::Error> {
    let perms = compute_server_permissions(pool, server_id, user_id, owner_id).await?;
    Ok(perms.contains(permission))
}

/// Check if a user has a specific permission in a channel.
pub async fn has_channel_permission(
    pool: &PgPool,
    server_id: Uuid,
    channel_id: Uuid,
    user_id: Uuid,
    owner_id: Uuid,
    permission: Permissions,
) -> Result<bool, sqlx::Error> {
    let perms =
        compute_channel_permissions(pool, server_id, channel_id, user_id, owner_id).await?;
    Ok(perms.contains(permission))
}

// ── Internal helpers ──────────────────────────────────

/// Compute base server-level permissions from @everyone + member roles.
fn compute_base_permissions(roles: &[Role], member_role_ids: &[Uuid]) -> Permissions {
    // Find @everyone role (is_default = true)
    let everyone_perms = roles
        .iter()
        .find(|r| r.is_default)
        .map(|r| r.permissions())
        .unwrap_or(Permissions::empty());

    // OR all the member's role permissions
    let mut perms = everyone_perms;
    for role in roles {
        if member_role_ids.contains(&role.id) {
            perms |= role.permissions();
        }
    }

    // If ADMINISTRATOR, grant all
    if perms.contains(Permissions::ADMINISTRATOR) {
        return Permissions::all();
    }

    perms
}

/// Apply channel-level overrides to base permissions.
fn apply_channel_overrides(
    base: Permissions,
    roles: &[Role],
    member_role_ids: &[Uuid],
    overrides: &[ChannelOverride],
    user_id: Uuid,
) -> Permissions {
    let mut perms = base;

    // Find @everyone role ID
    let everyone_role_id = roles.iter().find(|r| r.is_default).map(|r| r.id);

    // 1. Apply @everyone channel override
    if let Some(everyone_id) = everyone_role_id {
        if let Some(ov) = overrides.iter().find(|o| o.target_type == "role" && o.target_id == everyone_id) {
            let deny = Permissions::from_bits_truncate(ov.deny);
            let allow = Permissions::from_bits_truncate(ov.allow);
            perms &= !deny;
            perms |= allow;
        }
    }

    // 2. Apply role overrides (OR all allows, OR all denies, then apply)
    let mut role_allow = Permissions::empty();
    let mut role_deny = Permissions::empty();
    for ov in overrides {
        if ov.target_type == "role" {
            // Skip @everyone (already handled)
            if Some(ov.target_id) == everyone_role_id {
                continue;
            }
            if member_role_ids.contains(&ov.target_id) {
                role_allow |= Permissions::from_bits_truncate(ov.allow);
                role_deny |= Permissions::from_bits_truncate(ov.deny);
            }
        }
    }
    perms &= !role_deny;
    perms |= role_allow;

    // 3. Apply member-specific override
    if let Some(ov) = overrides.iter().find(|o| o.target_type == "member" && o.target_id == user_id) {
        let deny = Permissions::from_bits_truncate(ov.deny);
        let allow = Permissions::from_bits_truncate(ov.allow);
        perms &= !deny;
        perms |= allow;
    }

    perms
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;

    fn make_role(id: Uuid, permissions: i64, is_default: bool) -> Role {
        Role {
            id,
            server_id: Uuid::now_v7(),
            name: "test".into(),
            color: 0,
            hoist: false,
            position: 0,
            permissions,
            mentionable: false,
            is_default,
            created_at: Utc::now(),
        }
    }

    fn make_override(target_type: &str, target_id: Uuid, allow: i64, deny: i64) -> ChannelOverride {
        ChannelOverride {
            id: Uuid::now_v7(),
            channel_id: Uuid::now_v7(),
            target_type: target_type.into(),
            target_id,
            allow,
            deny,
        }
    }

    #[test]
    fn test_base_permissions_everyone_only() {
        let everyone_id = Uuid::now_v7();
        let roles = vec![make_role(everyone_id, Permissions::VIEW_CHANNEL.bits(), true)];
        let perms = compute_base_permissions(&roles, &[]);
        assert!(perms.contains(Permissions::VIEW_CHANNEL));
        assert!(!perms.contains(Permissions::SEND_MESSAGES));
    }

    #[test]
    fn test_base_permissions_with_extra_role() {
        let everyone_id = Uuid::now_v7();
        let mod_role_id = Uuid::now_v7();
        let roles = vec![
            make_role(everyone_id, Permissions::VIEW_CHANNEL.bits(), true),
            make_role(mod_role_id, Permissions::MANAGE_MESSAGES.bits(), false),
        ];
        let perms = compute_base_permissions(&roles, &[mod_role_id]);
        assert!(perms.contains(Permissions::VIEW_CHANNEL));
        assert!(perms.contains(Permissions::MANAGE_MESSAGES));
    }

    #[test]
    fn test_administrator_grants_all() {
        let everyone_id = Uuid::now_v7();
        let admin_id = Uuid::now_v7();
        let roles = vec![
            make_role(everyone_id, Permissions::VIEW_CHANNEL.bits(), true),
            make_role(admin_id, Permissions::ADMINISTRATOR.bits(), false),
        ];
        let perms = compute_base_permissions(&roles, &[admin_id]);
        assert_eq!(perms, Permissions::all());
    }

    #[test]
    fn test_channel_override_deny() {
        let everyone_id = Uuid::now_v7();
        let roles = vec![make_role(
            everyone_id,
            (Permissions::VIEW_CHANNEL | Permissions::SEND_MESSAGES).bits(),
            true,
        )];
        let overrides = vec![make_override(
            "role",
            everyone_id,
            0,
            Permissions::SEND_MESSAGES.bits(),
        )];
        let base = compute_base_permissions(&roles, &[]);
        let perms = apply_channel_overrides(base, &roles, &[], &overrides, Uuid::now_v7());
        assert!(perms.contains(Permissions::VIEW_CHANNEL));
        assert!(!perms.contains(Permissions::SEND_MESSAGES));
    }

    #[test]
    fn test_member_override_trumps_role() {
        let everyone_id = Uuid::now_v7();
        let user_id = Uuid::now_v7();
        let roles = vec![make_role(
            everyone_id,
            (Permissions::VIEW_CHANNEL | Permissions::SEND_MESSAGES).bits(),
            true,
        )];
        let overrides = vec![
            // Deny sending for @everyone
            make_override("role", everyone_id, 0, Permissions::SEND_MESSAGES.bits()),
            // But allow it for this specific member
            make_override("member", user_id, Permissions::SEND_MESSAGES.bits(), 0),
        ];
        let base = compute_base_permissions(&roles, &[]);
        let perms = apply_channel_overrides(base, &roles, &[], &overrides, user_id);
        assert!(perms.contains(Permissions::SEND_MESSAGES));
    }
}
