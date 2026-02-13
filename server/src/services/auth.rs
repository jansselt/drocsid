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

pub async fn register(
    pool: &PgPool,
    config: &AppConfig,
    username: &str,
    email: &str,
    password: &str,
) -> Result<AuthResponse, ApiError> {
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

    // Generate tokens
    let (access_token, refresh_token) = create_tokens(pool, config, user.id).await?;

    Ok(AuthResponse {
        access_token,
        refresh_token,
        user: PublicUser::from(user),
    })
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

fn hash_token(token: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(token.as_bytes());
    format!("{:x}", hasher.finalize())
}
