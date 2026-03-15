use std::fmt;
use tokio::process::Command;
use tokio::sync::broadcast;
use tokio::io::{AsyncBufReadExt, BufReader};
use tracing::Subscriber;
use tracing_subscriber::Layer;

pub struct LogBroadcastLayer {
    sender: broadcast::Sender<String>,
}

impl LogBroadcastLayer {
    pub fn new(capacity: usize) -> (Self, broadcast::Sender<String>) {
        let (sender, _) = broadcast::channel(capacity);
        (
            Self {
                sender: sender.clone(),
            },
            sender,
        )
    }
}

impl<S: Subscriber> Layer<S> for LogBroadcastLayer {
    fn on_event(
        &self,
        event: &tracing::Event<'_>,
        _ctx: tracing_subscriber::layer::Context<'_, S>,
    ) {
        let meta = event.metadata();
        let level = meta.level();
        let target = meta.target();

        let mut visitor = FieldCollector::default();
        event.record(&mut visitor);

        let line = format!(
            "{} {:>5} {}: {}",
            chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
            level,
            target,
            visitor.message,
        );
        let _ = self.sender.send(line);
    }
}

#[derive(Default)]
struct FieldCollector {
    message: String,
}

impl tracing::field::Visit for FieldCollector {
    fn record_debug(&mut self, field: &tracing::field::Field, value: &dyn fmt::Debug) {
        if field.name() == "message" {
            self.message = format!("{:?}", value);
        } else if !self.message.is_empty() {
            self.message.push_str(&format!(" {}={:?}", field.name(), value));
        } else {
            self.message = format!("{}={:?}", field.name(), value);
        }
    }

    fn record_str(&mut self, field: &tracing::field::Field, value: &str) {
        if field.name() == "message" {
            self.message = value.to_string();
        } else if !self.message.is_empty() {
            self.message.push_str(&format!(" {}={}", field.name(), value));
        } else {
            self.message = format!("{}={}", field.name(), value);
        }
    }
}

/// Spawn a background task that tails Docker container logs and feeds them
/// to the broadcast channel. Prefixes each line with [container_name].
/// Automatically reconnects if the container restarts.
pub fn spawn_docker_log_tailer(
    sender: broadcast::Sender<String>,
    container_name: &'static str,
) {
    tokio::spawn(async move {
        loop {
            tracing::info!("Starting docker log tailer for {container_name}");
            match tail_docker_logs(&sender, container_name).await {
                Ok(()) => tracing::info!("Docker log tailer for {container_name} exited cleanly"),
                Err(e) => tracing::warn!("Docker log tailer for {container_name} failed: {e}"),
            }
            // Wait before reconnecting (container might be restarting)
            tokio::time::sleep(std::time::Duration::from_secs(5)).await;
        }
    });
}

async fn tail_docker_logs(
    sender: &broadcast::Sender<String>,
    container_name: &str,
) -> Result<(), String> {
    let mut child = Command::new("docker")
        .args(["logs", "-f", "--tail", "100", "--timestamps", container_name])
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to spawn docker logs: {e}"))?;

    // LiveKit logs to stderr
    let stderr = child.stderr.take().ok_or("No stderr")?;
    let stdout = child.stdout.take().ok_or("No stdout")?;

    let sender2 = sender.clone();
    let name = container_name.to_string();

    // Tail stdout
    let name_stdout = name.clone();
    let sender_stdout = sender.clone();
    tokio::spawn(async move {
        let reader = BufReader::new(stdout);
        let mut lines = reader.lines();
        while let Ok(Some(line)) = lines.next_line().await {
            let _ = sender_stdout.send(format!("[{name_stdout}] {line}"));
        }
    });

    // Tail stderr (LiveKit's primary output)
    let reader = BufReader::new(stderr);
    let mut lines = reader.lines();
    while let Ok(Some(line)) = lines.next_line().await {
        let _ = sender2.send(format!("[{name}] {line}"));
    }

    let _ = child.wait().await;
    Ok(())
}
