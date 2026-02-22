use tokio::time::{interval, Duration};
use uuid::Uuid;

use crate::db::queries;
use crate::state::AppState;
use crate::types::entities::PublicUser;
use crate::types::events::{DmChannelCreateEvent, MessageCreateEvent, PollCloseEvent};

/// Spawn the scheduled message processor.
/// Runs until the server shuts down.
pub fn spawn_scheduler(state: AppState) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        let mut ticker = interval(Duration::from_secs(30));
        loop {
            ticker.tick().await;
            if let Err(e) = process_due_messages(&state).await {
                tracing::error!(error = %e, "Scheduler: failed to process due messages");
            }
            if let Err(e) = process_expired_polls(&state).await {
                tracing::error!(error = %e, "Scheduler: failed to process expired polls");
            }
        }
    })
}

async fn process_due_messages(state: &AppState) -> Result<(), anyhow::Error> {
    let due = queries::get_due_scheduled_messages(&state.db).await?;
    if due.is_empty() {
        return Ok(());
    }

    tracing::info!(count = due.len(), "Scheduler: processing due scheduled messages");

    let instance_id =
        queries::ensure_local_instance(&state.db, &state.config.instance.domain).await?;

    for scheduled in due {
        // Verify the channel still exists
        let channel = match queries::get_channel_by_id(&state.db, scheduled.channel_id).await? {
            Some(ch) => ch,
            None => {
                // Channel deleted; discard
                let _ = queries::delete_scheduled_message_by_id(&state.db, scheduled.id).await;
                continue;
            }
        };

        // Verify user still exists
        let author = match queries::get_user_by_id(&state.db, scheduled.author_id).await? {
            Some(u) => u,
            None => {
                let _ = queries::delete_scheduled_message_by_id(&state.db, scheduled.id).await;
                continue;
            }
        };

        // Create the real message
        let message_id = Uuid::now_v7();
        let message = match queries::create_message(
            &state.db,
            message_id,
            instance_id,
            scheduled.channel_id,
            scheduled.author_id,
            &scheduled.content,
            scheduled.reply_to_id,
        )
        .await
        {
            Ok(msg) => msg,
            Err(e) => {
                tracing::error!(
                    scheduled_id = %scheduled.id,
                    error = %e,
                    "Scheduler: failed to create message"
                );
                continue; // Will retry next tick
            }
        };

        // Update last_message_id
        let _ =
            queries::update_channel_last_message(&state.db, scheduled.channel_id, message_id)
                .await;

        // Parse mentions (same logic as send_message)
        let mentioned_user_ids = crate::api::channels::parse_mentions(
            &state.db,
            &state.gateway,
            &scheduled.content,
            scheduled.author_id,
            channel.server_id,
        )
        .await;
        if !mentioned_user_ids.is_empty() {
            let _ = queries::increment_mention_counts(
                &state.db,
                scheduled.channel_id,
                &mentioned_user_ids,
            )
            .await;
        }

        // Build gateway event
        let event = MessageCreateEvent {
            message,
            author: PublicUser::from(author),
        };

        // Broadcast: server channels vs DMs
        if let Some(sid) = channel.server_id {
            state
                .gateway
                .broadcast_to_server(sid, "MESSAGE_CREATE", &event, None);
        } else {
            // DM — reopen and dispatch to all members
            let _ = queries::reopen_dm_for_members(&state.db, scheduled.channel_id).await;
            if let Ok(members) =
                queries::get_dm_members(&state.db, scheduled.channel_id).await
            {
                let recipients: Vec<PublicUser> =
                    members.iter().map(|m| PublicUser::from(m.clone())).collect();
                let dm_event = DmChannelCreateEvent {
                    channel: channel.clone(),
                    recipients,
                };
                for member in &members {
                    state
                        .gateway
                        .dispatch_to_user(member.id, "DM_CHANNEL_CREATE", &dm_event);
                    state
                        .gateway
                        .dispatch_to_user(member.id, "MESSAGE_CREATE", &event);
                }
            }
        }

        // Delete from scheduled table
        let _ = queries::delete_scheduled_message_by_id(&state.db, scheduled.id).await;
        tracing::info!(
            scheduled_id = %scheduled.id,
            channel_id = %scheduled.channel_id,
            "Scheduler: sent scheduled message"
        );
    }

    Ok(())
}

async fn process_expired_polls(state: &AppState) -> Result<(), anyhow::Error> {
    let expired = queries::get_expired_open_polls(&state.db).await?;
    if expired.is_empty() {
        return Ok(());
    }

    tracing::info!(count = expired.len(), "Scheduler: closing expired polls");

    for poll in expired {
        queries::close_poll(&state.db, poll.id).await?;

        let options = queries::get_poll_options(&state.db, poll.id).await?;
        let votes = queries::get_poll_votes(&state.db, poll.id).await?;

        let mut closed_poll = poll.clone();
        closed_poll.closed = true;
        let results = crate::api::polls::build_poll_results(
            closed_poll,
            &options,
            &votes,
            Uuid::nil(),
        );

        let event = PollCloseEvent {
            channel_id: poll.channel_id,
            message_id: poll.message_id,
            poll_id: poll.id,
            options: results.options,
            total_votes: results.total_votes,
            ranked_results: results.ranked_results,
        };

        if let Ok(Some(channel)) = queries::get_channel_by_id(&state.db, poll.channel_id).await {
            if let Some(sid) = channel.server_id {
                state
                    .gateway
                    .broadcast_to_server(sid, "POLL_CLOSE", &event, None);
            } else {
                if let Ok(members) = queries::get_dm_members(&state.db, poll.channel_id).await {
                    for member in &members {
                        state
                            .gateway
                            .dispatch_to_user(member.id, "POLL_CLOSE", &event);
                    }
                }
            }
        }

        tracing::info!(poll_id = %poll.id, "Scheduler: closed expired poll");
    }

    Ok(())
}
