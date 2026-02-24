use std::sync::Arc;

use sqlx::PgPool;

use crate::config::AppConfig;
use crate::gateway::GatewayState;
use crate::services::push::PushService;

#[derive(Clone)]
pub struct AppState {
    pub db: PgPool,
    pub redis: redis::aio::ConnectionManager,
    pub config: Arc<AppConfig>,
    pub gateway: Arc<GatewayState>,
    pub s3: Option<aws_sdk_s3::Client>,
    pub push: Option<Arc<PushService>>,
}
