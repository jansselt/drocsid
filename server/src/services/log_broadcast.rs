use std::fmt;
use tokio::sync::broadcast;
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
