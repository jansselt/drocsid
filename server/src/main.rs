mod api;
mod config;
mod db;
mod error;
mod gateway;
mod services;
mod state;
mod types;

use std::sync::Arc;

use tower_http::cors::CorsLayer;
use tower_http::trace::TraceLayer;
use tracing_subscriber::EnvFilter;

use crate::config::AppConfig;
use crate::gateway::GatewayState;
use crate::state::AppState;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Initialize logging
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .init();

    // Load config
    let config = AppConfig::load()?;
    tracing::info!(domain = %config.instance.domain, "Starting Drocsid server");

    // Connect to database
    let db = db::create_pool(&config.database.url, config.database.max_connections).await?;
    tracing::info!("Database connected and migrations applied");

    // Connect to Redis
    let redis_client = redis::Client::open(config.redis.url.as_str())?;
    let redis = redis::aio::ConnectionManager::new(redis_client).await?;
    tracing::info!("Redis connected");

    // Connect to S3/MinIO (optional)
    let s3 = if let Some(ref s3_config) = config.s3 {
        let creds = aws_credential_types::Credentials::new(
            &s3_config.access_key,
            &s3_config.secret_key,
            None,
            None,
            "drocsid",
        );
        let s3_sdk_config = aws_config::defaults(aws_config::BehaviorVersion::latest())
            .endpoint_url(&s3_config.endpoint)
            .region(aws_config::Region::new(s3_config.region.clone()))
            .credentials_provider(creds)
            .load()
            .await;
        let client = aws_sdk_s3::Client::new(&s3_sdk_config);
        tracing::info!(endpoint = %s3_config.endpoint, "S3 connected");
        Some(client)
    } else {
        tracing::warn!("S3 not configured — file uploads disabled");
        None
    };

    // Build application state
    let state = AppState {
        db,
        redis,
        config: Arc::new(config.clone()),
        gateway: Arc::new(GatewayState::new()),
        s3,
    };

    // Start background scheduler for scheduled messages
    let _scheduler = services::scheduler::spawn_scheduler(state.clone());

    // Build router
    let app = api::router()
        .layer(TraceLayer::new_for_http())
        .layer(CorsLayer::permissive())
        .with_state(state);

    // Start server
    let addr = format!("{}:{}", config.server.host, config.server.port);
    let listener = tokio::net::TcpListener::bind(&addr).await?;
    tracing::info!(addr = %addr, "Server listening");

    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await?;

    Ok(())
}

async fn shutdown_signal() {
    tokio::signal::ctrl_c()
        .await
        .expect("Failed to install CTRL+C handler");
    tracing::info!("Shutting down...");
}
