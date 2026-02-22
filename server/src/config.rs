use serde::Deserialize;

#[derive(Debug, Clone, Deserialize)]
pub struct AppConfig {
    pub server: ServerConfig,
    pub database: DatabaseConfig,
    pub redis: RedisConfig,
    pub auth: AuthConfig,
    pub instance: InstanceConfig,
    pub s3: Option<S3Config>,
    pub livekit: Option<LiveKitConfig>,
    pub gif: Option<GifConfig>,
    pub email: Option<EmailConfig>,
    pub github: Option<GitHubConfig>,
    pub web_push: Option<WebPushConfig>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ServerConfig {
    pub host: String,
    pub port: u16,
}

#[derive(Debug, Clone, Deserialize)]
pub struct DatabaseConfig {
    pub url: String,
    pub max_connections: u32,
}

#[derive(Debug, Clone, Deserialize)]
pub struct RedisConfig {
    pub url: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct AuthConfig {
    pub jwt_secret: String,
    pub access_token_ttl_secs: i64,
    pub refresh_token_ttl_secs: i64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct InstanceConfig {
    pub domain: String,
    pub name: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct S3Config {
    pub endpoint: String,
    pub region: String,
    pub bucket: String,
    pub access_key: String,
    pub secret_key: String,
    pub public_url: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct LiveKitConfig {
    pub url: String,
    pub public_url: String,
    pub api_key: String,
    pub api_secret: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct GifConfig {
    pub provider: String,
    pub api_key: String,
    pub rating: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct EmailConfig {
    pub resend_api_key: String,
    pub from_address: String,
    pub reset_token_ttl_secs: Option<i64>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct GitHubConfig {
    pub token: String,
    pub repo: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct WebPushConfig {
    pub vapid_private_key: String,
    pub vapid_public_key: String,
    pub subject: String,
}

impl AppConfig {
    pub fn load() -> Result<Self, config::ConfigError> {
        let config = config::Config::builder()
            .add_source(config::File::with_name("config/default").required(false))
            .add_source(
                config::Environment::with_prefix("DROCSID")
                    .separator("__")
                    .try_parsing(true),
            )
            .build()?;

        config.try_deserialize()
    }
}
