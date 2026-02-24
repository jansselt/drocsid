use std::collections::{HashMap, HashSet};

use axum::extract::{Path, State};
use axum::response::IntoResponse;
use axum::routing::{get, post};
use axum::{Json, Router};
use uuid::Uuid;

use crate::api::auth::AuthUser;
use crate::api::channels::resolve_channel_with_perm;
use crate::db::queries;
use crate::error::ApiError;
use crate::state::AppState;
use crate::types::entities::{
    CastVoteRequest, CreatePollRequest, MyVote, Poll, PollOption, PollOptionResult, PollType,
    PollVote, PollWithResults, RankedResult,
};
use crate::types::events::{MessageCreateEvent, PollCloseEvent, PollCreateEvent, PollVoteEvent};
use crate::types::permissions::Permissions;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/{channel_id}/polls", post(create_poll))
        .route("/{channel_id}/polls/{poll_id}", get(get_poll))
        .route(
            "/{channel_id}/polls/{poll_id}/votes",
            post(cast_vote).delete(retract_vote),
        )
        .route(
            "/{channel_id}/polls/{poll_id}/close",
            post(close_poll),
        )
}

async fn create_poll(
    State(state): State<AppState>,
    user: AuthUser,
    Path(channel_id): Path<Uuid>,
    Json(body): Json<CreatePollRequest>,
) -> Result<impl IntoResponse, ApiError> {
    let (channel, _instance_id, server_id) = resolve_channel_with_perm(
        &state,
        channel_id,
        user.user_id,
        Permissions::VIEW_CHANNEL | Permissions::SEND_MESSAGES,
    )
    .await?;

    // Validate
    let question = body.question.trim();
    if question.is_empty() || question.len() > 500 {
        return Err(ApiError::InvalidInput(
            "Question must be 1-500 characters".into(),
        ));
    }
    if body.options.len() < 2 || body.options.len() > 25 {
        return Err(ApiError::InvalidInput(
            "Polls must have 2-25 options".into(),
        ));
    }
    for opt in &body.options {
        let label = opt.label.trim();
        if label.is_empty() || label.len() > 100 {
            return Err(ApiError::InvalidInput(
                "Option labels must be 1-100 characters".into(),
            ));
        }
    }
    let poll_type = body.poll_type.unwrap_or(PollType::Single);
    let anonymous = body.anonymous.unwrap_or(false);
    if let Some(ref closes_at) = body.closes_at {
        if *closes_at <= chrono::Utc::now() + chrono::Duration::seconds(30) {
            return Err(ApiError::InvalidInput(
                "Deadline must be at least 30 seconds in the future".into(),
            ));
        }
    }

    // Create the message
    let instance_id =
        queries::ensure_local_instance(&state.db, &state.config.instance.domain).await?;
    let message_id = Uuid::now_v7();
    let message = queries::create_message(
        &state.db,
        message_id,
        instance_id,
        channel_id,
        user.user_id,
        question,
        None,
    )
    .await?;
    let _ = queries::update_channel_last_message(&state.db, channel_id, message_id).await;

    // Create the poll
    let poll_id = Uuid::now_v7();
    let poll = queries::create_poll(
        &state.db,
        poll_id,
        message_id,
        channel_id,
        user.user_id,
        question,
        poll_type,
        anonymous,
        body.closes_at,
    )
    .await?;

    // Create options
    let mut options = Vec::new();
    for (i, opt) in body.options.iter().enumerate() {
        let opt_id = Uuid::now_v7();
        let option =
            queries::create_poll_option(&state.db, opt_id, poll_id, opt.label.trim(), i as i16)
                .await?;
        options.push(option);
    }

    // Build results (empty initially)
    let results = build_poll_results(poll, &options, &[], user.user_id);

    // Get author for MESSAGE_CREATE event
    let author = queries::get_user_by_id(&state.db, user.user_id)
        .await?
        .ok_or(ApiError::NotFound("User"))?;
    let public_author =
        crate::types::entities::PublicUser::from(author);

    // Include poll data in MESSAGE_CREATE so the message + poll arrive atomically
    let msg_event = serde_json::json!({
        "id": message.id,
        "instance_id": message.instance_id,
        "channel_id": message.channel_id,
        "author_id": message.author_id,
        "content": message.content,
        "created_at": message.created_at,
        "edited_at": message.edited_at,
        "reply_to_id": message.reply_to_id,
        "pinned": message.pinned,
        "author": public_author,
        "poll": &results,
    });
    let poll_event = PollCreateEvent {
        channel_id,
        message_id,
        poll: results.clone(),
    };

    // Broadcast
    if let Some(sid) = server_id {
        state
            .gateway
            .broadcast_to_server(sid, "MESSAGE_CREATE", &msg_event, None);
        state
            .gateway
            .broadcast_to_server(sid, "POLL_CREATE", &poll_event, None);
    } else {
        // DM
        let _ = queries::reopen_dm_for_members(&state.db, channel_id).await;
        if let Ok(members) = queries::get_dm_members(&state.db, channel_id).await {
            let recipients: Vec<crate::types::entities::PublicUser> = members
                .iter()
                .map(|m| crate::types::entities::PublicUser::from(m.clone()))
                .collect();
            let dm_event = crate::types::events::DmChannelCreateEvent {
                channel: channel,
                recipients,
            };
            for member in &members {
                state
                    .gateway
                    .dispatch_to_user(member.id, "DM_CHANNEL_CREATE", &dm_event);
                state
                    .gateway
                    .dispatch_to_user(member.id, "MESSAGE_CREATE", &msg_event);
                state
                    .gateway
                    .dispatch_to_user(member.id, "POLL_CREATE", &poll_event);
            }
        }
    }

    Ok((axum::http::StatusCode::CREATED, Json(results)))
}

async fn get_poll(
    State(state): State<AppState>,
    user: AuthUser,
    Path((channel_id, poll_id)): Path<(Uuid, Uuid)>,
) -> Result<impl IntoResponse, ApiError> {
    resolve_channel_with_perm(
        &state,
        channel_id,
        user.user_id,
        Permissions::VIEW_CHANNEL,
    )
    .await?;

    let poll = queries::get_poll_by_id(&state.db, poll_id)
        .await?
        .ok_or(ApiError::NotFound("Poll"))?;
    if poll.channel_id != channel_id {
        return Err(ApiError::NotFound("Poll"));
    }

    let options = queries::get_poll_options(&state.db, poll_id).await?;
    let votes = queries::get_poll_votes(&state.db, poll_id).await?;
    let results = build_poll_results(poll, &options, &votes, user.user_id);

    Ok(Json(results))
}

async fn cast_vote(
    State(state): State<AppState>,
    user: AuthUser,
    Path((channel_id, poll_id)): Path<(Uuid, Uuid)>,
    Json(body): Json<CastVoteRequest>,
) -> Result<impl IntoResponse, ApiError> {
    let (_channel, _instance_id, server_id) = resolve_channel_with_perm(
        &state,
        channel_id,
        user.user_id,
        Permissions::VIEW_CHANNEL,
    )
    .await?;

    let poll = queries::get_poll_by_id(&state.db, poll_id)
        .await?
        .ok_or(ApiError::NotFound("Poll"))?;
    if poll.channel_id != channel_id {
        return Err(ApiError::NotFound("Poll"));
    }
    if poll.closed {
        return Err(ApiError::InvalidInput("Poll is closed".into()));
    }
    if let Some(closes_at) = poll.closes_at {
        if chrono::Utc::now() >= closes_at {
            return Err(ApiError::InvalidInput("Poll deadline has passed".into()));
        }
    }

    if body.option_ids.is_empty() {
        return Err(ApiError::InvalidInput("Must select at least one option".into()));
    }

    let options = queries::get_poll_options(&state.db, poll_id).await?;
    let valid_ids: HashSet<Uuid> = options.iter().map(|o| o.id).collect();
    for oid in &body.option_ids {
        if !valid_ids.contains(oid) {
            return Err(ApiError::InvalidInput("Invalid option ID".into()));
        }
    }

    // Validate cardinality
    match poll.poll_type {
        PollType::Single => {
            if body.option_ids.len() != 1 {
                return Err(ApiError::InvalidInput(
                    "Single-choice polls require exactly one selection".into(),
                ));
            }
        }
        PollType::Multiple => {
            // Check for duplicates
            let unique: HashSet<&Uuid> = body.option_ids.iter().collect();
            if unique.len() != body.option_ids.len() {
                return Err(ApiError::InvalidInput("Duplicate option IDs".into()));
            }
        }
        PollType::Ranked => {
            let unique: HashSet<&Uuid> = body.option_ids.iter().collect();
            if unique.len() != body.option_ids.len() {
                return Err(ApiError::InvalidInput("Duplicate option IDs".into()));
            }
        }
    }

    // Delete existing votes and insert new ones
    queries::delete_user_poll_votes(&state.db, poll_id, user.user_id).await?;

    for (i, option_id) in body.option_ids.iter().enumerate() {
        let rank = match poll.poll_type {
            PollType::Ranked => Some((i + 1) as i16),
            _ => None,
        };
        queries::insert_poll_vote(
            &state.db,
            Uuid::now_v7(),
            poll_id,
            *option_id,
            user.user_id,
            rank,
        )
        .await?;
    }

    // Build updated results
    let votes = queries::get_poll_votes(&state.db, poll_id).await?;
    let results = build_poll_results(poll.clone(), &options, &votes, user.user_id);

    // Broadcast vote update (without individual user's my_votes)
    let vote_event = PollVoteEvent {
        channel_id,
        message_id: poll.message_id,
        poll_id,
        options: results.options.clone(),
        total_votes: results.total_votes,
        ranked_results: results.ranked_results.clone(),
    };
    if let Some(sid) = server_id {
        state
            .gateway
            .broadcast_to_server(sid, "POLL_VOTE", &vote_event, None);
    } else {
        if let Ok(members) = queries::get_dm_members(&state.db, channel_id).await {
            for member in &members {
                state
                    .gateway
                    .dispatch_to_user(member.id, "POLL_VOTE", &vote_event);
            }
        }
    }

    Ok(Json(results))
}

async fn retract_vote(
    State(state): State<AppState>,
    user: AuthUser,
    Path((channel_id, poll_id)): Path<(Uuid, Uuid)>,
) -> Result<impl IntoResponse, ApiError> {
    let (_channel, _instance_id, server_id) = resolve_channel_with_perm(
        &state,
        channel_id,
        user.user_id,
        Permissions::VIEW_CHANNEL,
    )
    .await?;

    let poll = queries::get_poll_by_id(&state.db, poll_id)
        .await?
        .ok_or(ApiError::NotFound("Poll"))?;
    if poll.channel_id != channel_id {
        return Err(ApiError::NotFound("Poll"));
    }
    if poll.closed {
        return Err(ApiError::InvalidInput("Poll is closed".into()));
    }

    queries::delete_user_poll_votes(&state.db, poll_id, user.user_id).await?;

    let options = queries::get_poll_options(&state.db, poll_id).await?;
    let votes = queries::get_poll_votes(&state.db, poll_id).await?;
    let results = build_poll_results(poll.clone(), &options, &votes, user.user_id);

    let vote_event = PollVoteEvent {
        channel_id,
        message_id: poll.message_id,
        poll_id,
        options: results.options.clone(),
        total_votes: results.total_votes,
        ranked_results: results.ranked_results.clone(),
    };
    if let Some(sid) = server_id {
        state
            .gateway
            .broadcast_to_server(sid, "POLL_VOTE", &vote_event, None);
    } else {
        if let Ok(members) = queries::get_dm_members(&state.db, channel_id).await {
            for member in &members {
                state
                    .gateway
                    .dispatch_to_user(member.id, "POLL_VOTE", &vote_event);
            }
        }
    }

    Ok(axum::http::StatusCode::NO_CONTENT)
}

async fn close_poll(
    State(state): State<AppState>,
    user: AuthUser,
    Path((channel_id, poll_id)): Path<(Uuid, Uuid)>,
) -> Result<impl IntoResponse, ApiError> {
    let (_channel, _instance_id, server_id) = resolve_channel_with_perm(
        &state,
        channel_id,
        user.user_id,
        Permissions::VIEW_CHANNEL,
    )
    .await?;

    let poll = queries::get_poll_by_id(&state.db, poll_id)
        .await?
        .ok_or(ApiError::NotFound("Poll"))?;
    if poll.channel_id != channel_id {
        return Err(ApiError::NotFound("Poll"));
    }
    if poll.closed {
        return Err(ApiError::InvalidInput("Poll is already closed".into()));
    }

    // Only creator or MANAGE_MESSAGES
    if poll.creator_id != user.user_id {
        // Check if user has MANAGE_MESSAGES permission
        resolve_channel_with_perm(
            &state,
            channel_id,
            user.user_id,
            Permissions::MANAGE_MESSAGES,
        )
        .await?;
    }

    queries::close_poll(&state.db, poll_id).await?;

    let options = queries::get_poll_options(&state.db, poll_id).await?;
    let votes = queries::get_poll_votes(&state.db, poll_id).await?;
    let mut closed_poll = poll.clone();
    closed_poll.closed = true;
    let results = build_poll_results(closed_poll, &options, &votes, user.user_id);

    let close_event = PollCloseEvent {
        channel_id,
        message_id: poll.message_id,
        poll_id,
        options: results.options.clone(),
        total_votes: results.total_votes,
        ranked_results: results.ranked_results.clone(),
    };
    if let Some(sid) = server_id {
        state
            .gateway
            .broadcast_to_server(sid, "POLL_CLOSE", &close_event, None);
    } else {
        if let Ok(members) = queries::get_dm_members(&state.db, channel_id).await {
            for member in &members {
                state
                    .gateway
                    .dispatch_to_user(member.id, "POLL_CLOSE", &close_event);
            }
        }
    }

    Ok(Json(results))
}

// ── Helpers ──────────────────────────────────────────

pub(crate) fn build_poll_results(
    poll: Poll,
    options: &[PollOption],
    votes: &[PollVote],
    current_user_id: Uuid,
) -> PollWithResults {
    // Count votes per option
    let mut vote_counts: HashMap<Uuid, i64> = HashMap::new();
    let mut voters_map: HashMap<Uuid, Vec<Uuid>> = HashMap::new();
    for vote in votes {
        *vote_counts.entry(vote.option_id).or_default() += 1;
        voters_map
            .entry(vote.option_id)
            .or_default()
            .push(vote.user_id);
    }

    // Count unique voters (for total_votes)
    let unique_voters: HashSet<Uuid> = votes.iter().map(|v| v.user_id).collect();
    let total_votes = unique_voters.len() as i64;

    let option_results: Vec<PollOptionResult> = options
        .iter()
        .map(|opt| {
            let count = *vote_counts.get(&opt.id).unwrap_or(&0);
            let percentage = if total_votes > 0 {
                (count as f64 / total_votes as f64) * 100.0
            } else {
                0.0
            };
            PollOptionResult {
                option_id: opt.id,
                label: opt.label.clone(),
                position: opt.position,
                vote_count: count,
                percentage,
                voters: if poll.anonymous {
                    Vec::new()
                } else {
                    voters_map.get(&opt.id).cloned().unwrap_or_default()
                },
            }
        })
        .collect();

    // Current user's votes
    let my_votes: Vec<MyVote> = votes
        .iter()
        .filter(|v| v.user_id == current_user_id)
        .map(|v| MyVote {
            option_id: v.option_id,
            rank: v.rank,
        })
        .collect();

    // Ranked results (only for ranked polls with votes)
    let ranked_results = if poll.poll_type == PollType::Ranked && !votes.is_empty() {
        Some(compute_instant_runoff(options, votes))
    } else {
        None
    };

    PollWithResults {
        poll,
        options: option_results,
        total_votes,
        my_votes,
        ranked_results,
    }
}

fn compute_instant_runoff(options: &[PollOption], votes: &[PollVote]) -> Vec<RankedResult> {
    // Group votes by user, sorted by rank
    let mut user_ballots: HashMap<Uuid, Vec<(Uuid, i16)>> = HashMap::new();
    for vote in votes {
        if let Some(rank) = vote.rank {
            user_ballots
                .entry(vote.user_id)
                .or_default()
                .push((vote.option_id, rank));
        }
    }
    // Sort each user's ballot by rank
    for ballot in user_ballots.values_mut() {
        ballot.sort_by_key(|(_, rank)| *rank);
    }

    let mut remaining: HashSet<Uuid> = options.iter().map(|o| o.id).collect();
    let mut eliminated: HashMap<Uuid, usize> = HashMap::new();
    let mut round = 0;

    loop {
        if remaining.len() <= 1 {
            break;
        }
        round += 1;

        // Count first-choice votes among remaining candidates
        let mut first_choice_counts: HashMap<Uuid, i64> = HashMap::new();
        for candidate in &remaining {
            first_choice_counts.insert(*candidate, 0);
        }

        let total_ballots = user_ballots.len() as i64;

        for ballot in user_ballots.values() {
            // Find the first remaining candidate in this ballot
            for (option_id, _rank) in ballot {
                if remaining.contains(option_id) {
                    *first_choice_counts.get_mut(option_id).unwrap() += 1;
                    break;
                }
            }
        }

        // Check for majority
        let majority = total_ballots / 2 + 1;
        let max_votes = first_choice_counts.values().max().copied().unwrap_or(0);
        if max_votes >= majority {
            break;
        }

        // Eliminate candidate with fewest first-choice votes
        let min_votes = first_choice_counts.values().min().copied().unwrap_or(0);
        let to_eliminate: Vec<Uuid> = first_choice_counts
            .iter()
            .filter(|(_, count)| **count == min_votes)
            .map(|(id, _)| *id)
            .collect();

        // If all remaining tied, break
        if to_eliminate.len() == remaining.len() {
            break;
        }

        for id in to_eliminate {
            remaining.remove(&id);
            eliminated.insert(id, round);
        }
    }

    // Build results
    // Final vote counts for remaining candidates
    let mut final_counts: HashMap<Uuid, i64> = HashMap::new();
    for candidate in &remaining {
        final_counts.insert(*candidate, 0);
    }
    for ballot in user_ballots.values() {
        for (option_id, _rank) in ballot {
            if remaining.contains(option_id) {
                *final_counts.get_mut(option_id).unwrap() += 1;
                break;
            }
        }
    }

    let max_final = final_counts.values().max().copied().unwrap_or(0);

    options
        .iter()
        .map(|opt| {
            let is_remaining = remaining.contains(&opt.id);
            let final_votes = if is_remaining {
                *final_counts.get(&opt.id).unwrap_or(&0)
            } else {
                0
            };
            RankedResult {
                option_id: opt.id,
                label: opt.label.clone(),
                round_eliminated: eliminated.get(&opt.id).copied(),
                final_votes,
                winner: is_remaining && final_votes == max_final && max_final > 0,
            }
        })
        .collect()
}
