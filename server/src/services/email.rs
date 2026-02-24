use crate::config::EmailConfig;
use crate::error::ApiError;

pub async fn send_password_reset_email(
    email_config: &EmailConfig,
    instance_name: &str,
    recipient_email: &str,
    reset_url: &str,
) -> Result<(), ApiError> {
    let client = reqwest::Client::new();

    let body = serde_json::json!({
        "from": email_config.from_address,
        "to": [recipient_email],
        "subject": format!("Reset your {} password", instance_name),
        "html": format!(
            "<p>You requested a password reset for your <strong>{}</strong> account.</p>\
             <p><a href=\"{}\">Click here to reset your password</a></p>\
             <p>This link expires in 30 minutes.</p>\
             <p>If you didn't request this, you can safely ignore this email.</p>",
            instance_name, reset_url
        ),
    });

    let response = client
        .post("https://api.resend.com/emails")
        .header(
            "Authorization",
            format!("Bearer {}", email_config.resend_api_key),
        )
        .json(&body)
        .send()
        .await
        .map_err(|e| anyhow::anyhow!("Failed to send email: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        tracing::error!(status = %status, body = %text, "Resend API error");
        return Err(anyhow::anyhow!("Email delivery failed: {}", status).into());
    }

    tracing::info!(to = %recipient_email, "Password reset email sent");
    Ok(())
}
