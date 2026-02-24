use aws_sdk_s3::primitives::ByteStream;

use crate::config::S3Config;
use crate::error::ApiError;

/// Upload bytes to S3/MinIO and return the public file URL.
pub async fn upload_to_s3(
    client: &aws_sdk_s3::Client,
    config: &S3Config,
    object_key: &str,
    content_type: &str,
    data: Vec<u8>,
) -> Result<String, ApiError> {
    client
        .put_object()
        .bucket(&config.bucket)
        .key(object_key)
        .content_type(content_type)
        .body(ByteStream::from(data))
        .send()
        .await
        .map_err(|e| ApiError::Internal(e.into()))?;

    let file_url = format!(
        "{}/{}",
        config.public_url.trim_end_matches('/'),
        object_key
    );
    Ok(file_url)
}

/// Extract a single file from a multipart upload.
/// Returns (filename, content_type, bytes).
pub async fn extract_multipart_file(
    mut multipart: axum::extract::Multipart,
    max_bytes: usize,
) -> Result<(String, String, Vec<u8>), ApiError> {
    let field = multipart
        .next_field()
        .await
        .map_err(|e| ApiError::InvalidInput(format!("Multipart error: {e}")))?
        .ok_or_else(|| ApiError::InvalidInput("No file provided".into()))?;

    let filename = field
        .file_name()
        .unwrap_or("upload")
        .to_string();
    let content_type = field
        .content_type()
        .unwrap_or("application/octet-stream")
        .to_string();

    let data = field
        .bytes()
        .await
        .map_err(|e| ApiError::InvalidInput(format!("Failed to read file: {e}")))?
        .to_vec();

    if data.len() > max_bytes {
        return Err(ApiError::InvalidInput(format!(
            "File too large (max {} MB)",
            max_bytes / (1024 * 1024)
        )));
    }

    Ok((filename, content_type, data))
}
