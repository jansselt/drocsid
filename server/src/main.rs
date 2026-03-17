mod api;
mod config;
mod db;
mod error;
mod gateway;
mod services;
mod state;
mod types;

use std::sync::Arc;

use tower_http::cors::{AllowHeaders, AllowMethods, CorsLayer};
use tower_http::trace::TraceLayer;
use tracing_subscriber::layer::SubscriberExt;
use tracing_subscriber::util::SubscriberInitExt;
use tracing_subscriber::EnvFilter;

use crate::config::AppConfig;
use crate::gateway::GatewayState;
use crate::state::AppState;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Initialize logging with broadcast layer
    let (log_broadcast_layer, log_sender) =
        services::log_broadcast::LogBroadcastLayer::new(1000);

    // Set global filter to debug so the broadcast layer captures HTTP trace
    // events and gateway activity for the admin log viewer. The terminal will
    // also show debug output; set RUST_LOG=info to suppress in production.
    tracing_subscriber::registry()
        .with(
            EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| EnvFilter::new("info,tower_http=debug")),
        )
        .with(tracing_subscriber::fmt::layer())
        .with(log_broadcast_layer)
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

    // Initialize Web Push service (optional)
    let push = match config.web_push {
        Some(ref wpc) => match services::push::PushService::new(wpc) {
            Ok(svc) => {
                tracing::info!("Web Push notifications enabled");
                Some(Arc::new(svc))
            }
            Err(e) => {
                tracing::error!("Failed to initialize Web Push: {e}");
                None
            }
        },
        None => {
            tracing::warn!("Web Push not configured — push notifications disabled");
            None
        }
    };

    // Build application state
    let state = AppState {
        db,
        redis,
        config: Arc::new(config.clone()),
        gateway: Arc::new(GatewayState::new()),
        s3,
        push,
        started_at: std::time::Instant::now(),
        log_sender: Some(log_sender),
    };

    // Start background scheduler for scheduled messages
    let _scheduler = services::scheduler::spawn_scheduler(state.clone());

    // Tail LiveKit Docker container logs into the admin log stream
    if let Some(ref sender) = state.log_sender {
        services::log_broadcast::spawn_docker_log_tailer(sender.clone(), "drocsid-livekit");
    }

    // Build CORS layer — allow the configured domain (https + http for dev)
    let domain = &config.instance.domain;
    let cors = {
        let mut origins: Vec<axum::http::HeaderValue> = Vec::new();
        // Production origin
        if let Ok(v) = format!("https://{domain}").parse() {
            origins.push(v);
        }
        // Development origins (localhost Vite dev server + Electron)
        for port in [5173, 5174] {
            if let Ok(v) = format!("http://localhost:{port}").parse() {
                origins.push(v);
            }
            if let Ok(v) = format!("http://127.0.0.1:{port}").parse() {
                origins.push(v);
            }
        }
        // Electron production (serves from local http server)
        if let Ok(v) = "http://localhost:5175".parse() {
            origins.push(v);
        }
        if let Ok(v) = "http://127.0.0.1:5175".parse() {
            origins.push(v);
        }
        CorsLayer::new()
            .allow_origin(origins)
            .allow_methods(AllowMethods::mirror_request())
            .allow_headers(AllowHeaders::mirror_request())
            .allow_credentials(true)
    };

    // Build router
    let app = api::router()
        .layer(TraceLayer::new_for_http())
        .layer(cors)
        .with_state(state);

    // Start server
    let addr = format!("{}:{}", config.server.host, config.server.port);
    let listener = tokio::net::TcpListener::bind(&addr).await?;
    tracing::info!(addr = %addr, "Server listening");

    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<std::net::SocketAddr>(),
    )
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
