use argon2::password_hash::rand_core::OsRng;
use argon2::password_hash::SaltString;
use argon2::{Argon2, PasswordHash, PasswordHasher, PasswordVerifier};
use chrono::Utc;
use jsonwebtoken::{decode, encode, DecodingKey, EncodingKey, Header, Validation};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::PgPool;
use uuid::Uuid;

use crate::config::AppConfig;
use crate::db::queries;
use crate::error::ApiError;
use crate::types::entities::{AuthResponse, PublicUser, TokenResponse};

#[derive(Debug, Serialize, Deserialize)]
pub struct JwtClaims {
    pub sub: Uuid,
    pub iat: i64,
    pub exp: i64,
}

/// Returns (AuthResponse, Option<server_id>) — server_id is set when a server invite
/// was used as the registration code and the user was auto-joined to that server.
pub async fn register(
    pool: &PgPool,
    config: &AppConfig,
    username: &str,
    email: &str,
    password: &str,
    invite_code: Option<&str>,
) -> Result<(AuthResponse, Option<Uuid>), ApiError> {
    // Validate input
    if username.len() < 2 || username.len() > 32 {
        return Err(ApiError::InvalidInput(
            "Username must be 2-32 characters".into(),
        ));
    }
    if password.len() < 8 {
        return Err(ApiError::InvalidInput(
            "Password must be at least 8 characters".into(),
        ));
    }

    // Check if this is the first user (bootstrap: no invite code needed)
    let user_count = queries::count_users(pool).await?;
    let is_first_user = user_count == 0;

    // Track whether the code is a server invite (for auto-join after user creation)
    let mut server_invite_id: Option<Uuid> = None;

    // Validate invite code (required unless first user)
    if !is_first_user {
        let code_str = invite_code.unwrap_or("");
        if code_str.is_empty() {
            return Err(ApiError::InvalidInput(
                "Registration requires an invite code".into(),
            ));
        }

        // Check registration_codes table first
        if let Some(reg_code) = queries::get_registration_code_by_code(pool, code_str).await? {
            if let Some(expires_at) = reg_code.expires_at {
                if Utc::now() > expires_at {
                    return Err(ApiError::InvalidInput("Registration code has expired".into()));
                }
            }
            if let Some(max_uses) = reg_code.max_uses {
                if reg_code.uses >= max_uses {
                    return Err(ApiError::InvalidInput("Registration code has reached its maximum uses".into()));
                }
            }
        // Fall back to server invites table
        } else if let Some(invite) = queries::get_invite_by_code(pool, code_str).await? {
            if let Some(expires_at) = invite.expires_at {
                if Utc::now() > expires_at {
                    return Err(ApiError::InvalidInput("Invite has expired".into()));
                }
            }
            if let Some(max_uses) = invite.max_uses {
                if invite.uses >= max_uses {
                    return Err(ApiError::InvalidInput("Invite has reached its maximum uses".into()));
                }
            }
            server_invite_id = Some(invite.server_id);
        } else {
            return Err(ApiError::InvalidInput("Invalid invite code".into()));
        }
    }

    // Check if email already exists
    if queries::get_user_by_email(pool, email).await?.is_some() {
        return Err(ApiError::InvalidInput(
            "Email already registered".into(),
        ));
    }

    // Hash password
    let salt = SaltString::generate(&mut OsRng);
    let argon2 = Argon2::default();
    let password_hash = argon2
        .hash_password(password.as_bytes(), &salt)
        .map_err(|e| anyhow::anyhow!("Failed to hash password: {}", e))?
        .to_string();

    // Get local instance
    let instance_id = queries::ensure_local_instance(pool, &config.instance.domain).await?;

    // Create user
    let user_id = Uuid::now_v7();
    let user = queries::create_user(pool, user_id, instance_id, username, email, &password_hash)
        .await?;

    // First user becomes admin; otherwise increment code usage
    if is_first_user {
        queries::set_user_admin(pool, user.id, true).await?;
    } else if server_invite_id.is_some() {
        // Server invite: increment invite uses and auto-join server
        let code_str = invite_code.unwrap_or("");
        queries::increment_invite_uses(pool, code_str).await?;
        queries::add_server_member(pool, server_invite_id.unwrap(), user.id).await?;
    } else {
        // Registration code
        queries::increment_registration_code_uses(pool, invite_code.unwrap_or("")).await?;
    }

    // Re-fetch user to get updated is_admin flag
    let user = queries::get_user_by_id(pool, user.id)
        .await?
        .ok_or(ApiError::NotFound("User"))?;

    // Generate tokens
    let (access_token, refresh_token) = create_tokens(pool, config, user.id).await?;

    Ok((AuthResponse {
        access_token,
        refresh_token,
        user: PublicUser::from(user),
    }, server_invite_id))
}

pub async fn login(
    pool: &PgPool,
    config: &AppConfig,
    email: &str,
    password: &str,
) -> Result<AuthResponse, ApiError> {
    let user = queries::get_user_by_email(pool, email)
        .await?
        .ok_or(ApiError::Unauthorized)?;

    let password_hash = user
        .password_hash
        .as_ref()
        .ok_or(ApiError::Unauthorized)?;

    // Verify password
    let parsed_hash =
        PasswordHash::new(password_hash).map_err(|e| anyhow::anyhow!("Invalid hash: {}", e))?;
    Argon2::default()
        .verify_password(password.as_bytes(), &parsed_hash)
        .map_err(|_| ApiError::Unauthorized)?;

    // Generate tokens
    let (access_token, refresh_token) = create_tokens(pool, config, user.id).await?;

    Ok(AuthResponse {
        access_token,
        refresh_token,
        user: PublicUser::from(user),
    })
}

pub async fn refresh(
    pool: &PgPool,
    config: &AppConfig,
    refresh_token: &str,
) -> Result<TokenResponse, ApiError> {
    let token_hash = hash_token(refresh_token);

    let session = queries::get_session_by_token_hash(pool, &token_hash)
        .await?
        .ok_or(ApiError::Unauthorized)?;

    // Delete old session
    queries::delete_session(pool, session.id).await?;

    // Create new tokens
    let (access_token, new_refresh_token) =
        create_tokens(pool, config, session.user_id).await?;

    Ok(TokenResponse {
        access_token,
        refresh_token: new_refresh_token,
    })
}

pub fn validate_access_token(config: &AppConfig, token: &str) -> Result<Uuid, ApiError> {
    let token_data = decode::<JwtClaims>(
        token,
        &DecodingKey::from_secret(config.auth.jwt_secret.as_bytes()),
        &Validation::default(),
    )
    .map_err(|_| ApiError::Unauthorized)?;

    Ok(token_data.claims.sub)
}

async fn create_tokens(
    pool: &PgPool,
    config: &AppConfig,
    user_id: Uuid,
) -> Result<(String, String), ApiError> {
    let now = Utc::now().timestamp();

    // Access token (JWT)
    let claims = JwtClaims {
        sub: user_id,
        iat: now,
        exp: now + config.auth.access_token_ttl_secs,
    };
    let access_token = encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(config.auth.jwt_secret.as_bytes()),
    )
    .map_err(|e| anyhow::anyhow!("Failed to encode JWT: {}", e))?;

    // Refresh token (random, stored as hash)
    let refresh_token = Uuid::now_v7().to_string();
    let token_hash = hash_token(&refresh_token);

    let expires_at = Utc::now()
        + chrono::Duration::seconds(config.auth.refresh_token_ttl_secs);

    queries::create_session(pool, Uuid::now_v7(), user_id, &token_hash, None, expires_at)
        .await?;

    Ok((access_token, refresh_token))
}

pub fn hash_token(token: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(token.as_bytes());
    format!("{:x}", hasher.finalize())
}

pub async fn request_password_reset(
    pool: &PgPool,
    config: &AppConfig,
    email: &str,
) -> Result<(), ApiError> {
    let email_config = config.email.as_ref().ok_or_else(|| {
        ApiError::Internal(anyhow::anyhow!("Email is not configured"))
    })?;

    // Look up user — but always return Ok to avoid revealing email existence
    let user = queries::get_user_by_email(pool, email).await?;

    if let Some(user) = user {
        // Delete any existing reset tokens for this user
        queries::delete_user_password_reset_tokens(pool, user.id).await?;

        // Generate token
        let raw_token = Uuid::now_v7().to_string();
        let token_hash = hash_token(&raw_token);

        let ttl_secs = email_config.reset_token_ttl_secs.unwrap_or(1800);
        let expires_at = Utc::now() + chrono::Duration::seconds(ttl_secs);

        queries::create_password_reset_token(pool, Uuid::now_v7(), user.id, &token_hash, expires_at)
            .await?;

        // Build reset URL
        let reset_url = format!(
            "https://{}/reset-password?token={}",
            config.instance.domain, raw_token
        );

        // Send email — suppress errors to avoid leaking info
        if let Err(e) = crate::services::email::send_password_reset_email(
            email_config,
            &config.instance.name,
            email,
            &reset_url,
        )
        .await
        {
            tracing::error!(error = %e, "Failed to send password reset email");
        }
    }

    Ok(())
}

pub async fn complete_password_reset(
    pool: &PgPool,
    raw_token: &str,
    new_password: &str,
) -> Result<(), ApiError> {
    if new_password.len() < 8 {
        return Err(ApiError::InvalidInput(
            "Password must be at least 8 characters".into(),
        ));
    }

    let token_hash = hash_token(raw_token);

    let reset_token = queries::get_password_reset_token_by_hash(pool, &token_hash)
        .await?
        .ok_or(ApiError::InvalidInput(
            "Invalid or expired reset token".into(),
        ))?;

    // Hash new password
    let salt = SaltString::generate(&mut OsRng);
    let argon2 = Argon2::default();
    let password_hash = argon2
        .hash_password(new_password.as_bytes(), &salt)
        .map_err(|e| anyhow::anyhow!("Failed to hash password: {}", e))?
        .to_string();

    // Update password and clean up tokens
    queries::update_user_password_hash(pool, reset_token.user_id, &password_hash).await?;
    queries::delete_user_password_reset_tokens(pool, reset_token.user_id).await?;

    Ok(())
}
