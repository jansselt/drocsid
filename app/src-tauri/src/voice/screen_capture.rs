//! Native screen capture using XDG Desktop Portal + GStreamer subprocess.
//!
//! webkit2gtk's getDisplayMedia() is broken on Wayland (returns "live" track but
//! never delivers frames). This module bypasses it entirely:
//!   1. ashpd opens the XDG portal picker → user selects screen/window
//!   2. gst-launch-1.0 subprocess captures PipeWire stream → raw I420 to stdout
//!   3. Rust reads frames and pushes to LiveKit NativeVideoSource

use std::os::fd::{AsRawFd, OwnedFd};
use std::process::{Child, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use livekit::webrtc::video_frame::{I420Buffer, VideoFrame, VideoRotation};
use livekit::webrtc::video_source::native::NativeVideoSource;

const CAPTURE_WIDTH: u32 = 1280;
const CAPTURE_HEIGHT: u32 = 720;
const CAPTURE_FPS: u32 = 10;
/// I420: Y = W*H, U = W/2*H/2, V = W/2*H/2
const I420_FRAME_SIZE: usize = (CAPTURE_WIDTH as usize * CAPTURE_HEIGHT as usize * 3) / 2;

/// Handle that keeps the XDG portal session alive. Dropping it closes the session.
pub struct PortalSessionHandle {
    shutdown_tx: std::sync::Mutex<Option<tokio::sync::oneshot::Sender<()>>>,
}

impl PortalSessionHandle {
    fn close(&self) {
        if let Some(tx) = self.shutdown_tx.lock().unwrap().take() {
            let _ = tx.send(());
        }
    }
}

impl Drop for PortalSessionHandle {
    fn drop(&mut self) {
        self.close();
    }
}

pub struct ScreenCaptureState {
    shutdown: Arc<AtomicBool>,
    child_pid: u32,
    _portal: PortalSessionHandle,
}

impl ScreenCaptureState {
    pub fn stop(&self) {
        self.shutdown.store(true, Ordering::Relaxed);
        self._portal.close();
        // SIGTERM the gst-launch process to unblock the blocking read
        unsafe {
            libc::kill(self.child_pid as i32, libc::SIGTERM);
        }
    }
}

/// Open XDG Desktop Portal screen cast picker. Returns PipeWire (fd, node_id) and a
/// handle that keeps the portal session alive. The PipeWire stream is only valid while
/// the portal session exists — dropping the handle closes the session and kills the stream.
pub async fn request_screencast() -> Result<(OwnedFd, u32, PortalSessionHandle), String> {
    use ashpd::desktop::screencast::{
        CursorMode, Screencast, SelectSourcesOptions, SourceType,
    };
    use ashpd::desktop::PersistMode;

    // Channel to receive portal results from the spawned task
    let (result_tx, result_rx) =
        tokio::sync::oneshot::channel::<Result<(OwnedFd, u32), String>>();
    // Channel to signal the task to close the portal session
    let (shutdown_tx, shutdown_rx) = tokio::sync::oneshot::channel::<()>();

    // Spawn a task that owns proxy + session for their entire lifetime.
    // The portal session is closed when shutdown_rx fires (or this task is dropped).
    tokio::spawn(async move {
        let proxy = match Screencast::new().await {
            Ok(p) => p,
            Err(e) => {
                let _ = result_tx.send(Err(format!("Portal init failed: {e}")));
                return;
            }
        };

        let session = match proxy.create_session(Default::default()).await {
            Ok(s) => s,
            Err(e) => {
                let _ = result_tx.send(Err(format!("Create session failed: {e}")));
                return;
            }
        };

        if let Err(e) = proxy
            .select_sources(
                &session,
                SelectSourcesOptions::default()
                    .set_cursor_mode(CursorMode::Embedded)
                    .set_sources(SourceType::Monitor | SourceType::Window)
                    .set_multiple(false)
                    .set_persist_mode(PersistMode::DoNot),
            )
            .await
        {
            let _ = result_tx.send(Err(format!("Select sources failed: {e}")));
            return;
        }

        let response = match proxy
            .start(&session, None, Default::default())
            .await
            .map_err(|e| format!("Start screencast failed: {e}"))
            .and_then(|r| r.response().map_err(|e| format!("Screencast response error: {e}")))
        {
            Ok(r) => r,
            Err(e) => {
                let _ = result_tx.send(Err(e));
                return;
            }
        };

        let streams = response.streams();
        if streams.is_empty() {
            let _ = result_tx.send(Err("No streams returned from portal".into()));
            return;
        }

        let node_id = streams[0].pipe_wire_node_id();

        let fd = match proxy
            .open_pipe_wire_remote(&session, Default::default())
            .await
        {
            Ok(f) => f,
            Err(e) => {
                let _ = result_tx.send(Err(format!("Open PipeWire remote failed: {e}")));
                return;
            }
        };

        log::info!(
            "request_screencast: fd={}, node_id={}",
            fd.as_raw_fd(),
            node_id
        );

        // Send fd + node_id to caller
        let _ = result_tx.send(Ok((fd, node_id)));

        // Keep proxy + session alive until told to stop.
        // When session drops, its Drop impl sends Close to the portal.
        log::info!("request_screencast: holding portal session alive");
        let _ = shutdown_rx.await;
        log::info!("request_screencast: portal session closing");
        // session + proxy drop here → portal Close sent
    });

    let (fd, node_id) = result_rx
        .await
        .map_err(|_| "Portal task panicked".to_string())??;

    let handle = PortalSessionHandle {
        shutdown_tx: std::sync::Mutex::new(Some(shutdown_tx)),
    };

    Ok((fd, node_id, handle))
}

/// Spawn gst-launch-1.0 to capture PipeWire stream, read I420 frames, push to video source.
pub fn start_capture(
    pw_fd: OwnedFd,
    node_id: u32,
    video_source: NativeVideoSource,
    app_handle: tauri::AppHandle,
    portal: PortalSessionHandle,
) -> Result<ScreenCaptureState, String> {
    // Pass the PipeWire fd as stdin (fd 0) and video output as stdout (fd 1).
    // Rust's Command closes all fds > 2 in the child before exec, so we CANNOT
    // use custom fd numbers — they get closed before gst-launch sees them.
    // Instead, we use Rust's Stdio system which correctly dup2's fds to 0/1/2.
    // Pipeline: accept whatever pipewiresrc outputs, convert + scale to fixed I420,
    // output raw frames to stdout. No videorate element — it buffers indefinitely
    // waiting to determine input framerate. Frame pacing is handled on the Rust side.
    let pipeline = format!(
        "pipewiresrc fd=0 path={node_id} do-timestamp=true \
         ! videoconvert \
         ! videoscale \
         ! video/x-raw,format=I420,width={CAPTURE_WIDTH},height={CAPTURE_HEIGHT} \
         ! fdsink fd=1 sync=false"
    );
    log::info!("start_capture: pipeline = {pipeline}");

    // Use a wrapper shell script so we can:
    // 1. Run gst-launch WITHOUT -q (to see pipeline state messages on stderr)
    // 2. Keep stdout clean for raw video data (fdsink fd=1 still works)
    // 3. Log gst-launch's stdout text to stderr (merged with debug output)
    //
    // The wrapper: redirect gst-launch's own stdout (text) to stderr,
    // but fd 1 is already our pipe so fdsink writes directly to it.
    // Actually gst-launch -q suppresses text. Without -q, text goes to fd 1
    // which corrupts video. Solution: use -q but set GST_DEBUG high enough
    // to see pipeline state on stderr.
    let mut cmd = std::process::Command::new("gst-launch-1.0");
    cmd.arg("-q");
    cmd.args(pipeline.split_whitespace());

    // PipeWire fd → child's stdin (fd 0), video data → child's stdout (fd 1)
    cmd.stdin(Stdio::from(pw_fd));
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());

    // GST_DEBUG=4 for pipewiresrc specifically to see connection/negotiation
    cmd.env("GST_DEBUG", "pipewiresrc:5,fdsink:4,*:2");
    cmd.env("GST_DEBUG_NO_COLOR", "1");

    let child = cmd
        .spawn()
        .map_err(|e| format!("Spawn gst-launch-1.0 failed: {e}"))?;
    let child_pid = child.id();

    log::info!(
        "start_capture: gst-launch pid={child_pid}, {}x{} @ {}fps (pw_fd=stdin, video=stdout)",
        CAPTURE_WIDTH,
        CAPTURE_HEIGHT,
        CAPTURE_FPS,
    );

    let shutdown = Arc::new(AtomicBool::new(false));
    let shutdown_clone = shutdown.clone();

    // Blocking thread reads I420 frames from child's stdout
    std::thread::spawn(move || {
        capture_loop(child, video_source, shutdown_clone, app_handle);
    });

    Ok(ScreenCaptureState {
        shutdown,
        child_pid,
        _portal: portal,
    })
}

/// Convert I420 raw buffer to JPEG and emit as a Tauri event for local preview.
fn emit_preview_frame(buf: &[u8], app_handle: &tauri::AppHandle) {
    use base64::Engine as _;
    use tauri::Emitter;

    let w = CAPTURE_WIDTH as usize;
    let h = CAPTURE_HEIGHT as usize;
    let y_size = w * h;
    let half_w = w / 2;
    let half_h = h / 2;

    // I420 → RGB
    let mut rgb = vec![0u8; w * h * 3];
    for y_pos in 0..h {
        for x_pos in 0..w {
            let y_val = buf[y_pos * w + x_pos] as f32;
            let u_idx = y_size + (y_pos / 2) * half_w + (x_pos / 2);
            let v_idx = y_size + half_w * half_h + (y_pos / 2) * half_w + (x_pos / 2);
            let u_val = buf[u_idx] as f32 - 128.0;
            let v_val = buf[v_idx] as f32 - 128.0;

            let r = (y_val + 1.402 * v_val).clamp(0.0, 255.0) as u8;
            let g = (y_val - 0.344 * u_val - 0.714 * v_val).clamp(0.0, 255.0) as u8;
            let b = (y_val + 1.772 * u_val).clamp(0.0, 255.0) as u8;

            let idx = (y_pos * w + x_pos) * 3;
            rgb[idx] = r;
            rgb[idx + 1] = g;
            rgb[idx + 2] = b;
        }
    }

    let Some(img) = image::RgbImage::from_raw(CAPTURE_WIDTH, CAPTURE_HEIGHT, rgb) else {
        return;
    };
    let mut jpeg_buf = Vec::new();
    let encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut jpeg_buf, 50);
    if img.write_with_encoder(encoder).is_err() {
        return;
    }

    let b64 = base64::engine::general_purpose::STANDARD.encode(&jpeg_buf);
    let _ = app_handle.emit("voice:local-screen-preview", b64);
}

fn capture_loop(
    mut child: Child,
    video_source: NativeVideoSource,
    shutdown: Arc<AtomicBool>,
    app_handle: tauri::AppHandle,
) {
    use std::io::Read;
    use tauri::Emitter;

    log::info!("capture_loop: starting, frame_size={I420_FRAME_SIZE} bytes");

    // Spawn a thread to read and log stderr from gst-launch
    if let Some(stderr) = child.stderr.take() {
        std::thread::spawn(move || {
            use std::io::BufRead;
            log::info!("gst-launch stderr reader: started");
            let reader = std::io::BufReader::new(stderr);
            for line in reader.lines() {
                match line {
                    Ok(l) => log::warn!("gst-launch stderr: {l}"),
                    Err(e) => {
                        log::warn!("gst-launch stderr reader: error {e}");
                        break;
                    }
                }
            }
            log::info!("gst-launch stderr reader: ended");
        });
    } else {
        log::error!("capture_loop: no stderr handle from gst-launch");
    }

    // Take stdout — this is where video frames arrive (fdsink fd=1)
    let mut video_pipe = match child.stdout.take() {
        Some(stdout) => stdout,
        None => {
            log::error!("capture_loop: no stdout handle from gst-launch");
            return;
        }
    };

    let mut buf = vec![0u8; I420_FRAME_SIZE];
    let y_size = CAPTURE_WIDTH as usize * CAPTURE_HEIGHT as usize;
    let uv_size = (CAPTURE_WIDTH as usize / 2) * (CAPTURE_HEIGHT as usize / 2);
    let mut frame_count: u64 = 0;
    // Send a local preview every N frames (~2fps at whatever source rate)
    let preview_every: u64 = 5;

    log::info!("capture_loop: waiting for first frame from gst-launch (stdout)...");

    while !shutdown.load(Ordering::Relaxed) {
        match video_pipe.read_exact(&mut buf) {
            Ok(()) => {
                let mut i420 = I420Buffer::new(CAPTURE_WIDTH, CAPTURE_HEIGHT);
                let (stride_y, stride_u, stride_v) = i420.strides();
                let (data_y, data_u, data_v) = i420.data_mut();

                // GStreamer I420 output: contiguous Y, U, V planes, stride == width
                if stride_y as usize == CAPTURE_WIDTH as usize {
                    data_y[..y_size].copy_from_slice(&buf[..y_size]);
                } else {
                    for row in 0..CAPTURE_HEIGHT as usize {
                        let src = row * CAPTURE_WIDTH as usize;
                        let dst = row * stride_y as usize;
                        data_y[dst..dst + CAPTURE_WIDTH as usize]
                            .copy_from_slice(&buf[src..src + CAPTURE_WIDTH as usize]);
                    }
                }

                let half_w = CAPTURE_WIDTH as usize / 2;
                if stride_u as usize == half_w {
                    data_u[..uv_size].copy_from_slice(&buf[y_size..y_size + uv_size]);
                } else {
                    for row in 0..CAPTURE_HEIGHT as usize / 2 {
                        let src = y_size + row * half_w;
                        let dst = row * stride_u as usize;
                        data_u[dst..dst + half_w]
                            .copy_from_slice(&buf[src..src + half_w]);
                    }
                }

                if stride_v as usize == half_w {
                    data_v[..uv_size]
                        .copy_from_slice(&buf[y_size + uv_size..y_size + 2 * uv_size]);
                } else {
                    for row in 0..CAPTURE_HEIGHT as usize / 2 {
                        let src = y_size + uv_size + row * half_w;
                        let dst = row * stride_v as usize;
                        data_v[dst..dst + half_w]
                            .copy_from_slice(&buf[src..src + half_w]);
                    }
                }

                let frame = VideoFrame {
                    rotation: VideoRotation::VideoRotation0,
                    buffer: i420,
                    timestamp_us: 0,
                };
                video_source.capture_frame(&frame);

                frame_count += 1;
                if frame_count <= 3 {
                    log::info!("capture_loop: frame #{frame_count} pushed");
                }

                // Emit a local preview frame periodically
                if frame_count == 1 || frame_count % preview_every == 0 {
                    emit_preview_frame(&buf, &app_handle);
                }
            }
            Err(e) => {
                if !shutdown.load(Ordering::Relaxed) {
                    log::warn!("capture_loop: read error (gst-launch exited?): {e}");
                }
                break;
            }
        }
    }

    log::info!("capture_loop: stopping after {frame_count} frames");

    // Clean up child process
    let _ = child.kill();
    let _ = child.wait();

    // Notify frontend if this wasn't an intentional stop
    if !shutdown.load(Ordering::Relaxed) {
        let _ = app_handle.emit("voice:screenshare-ended", ());
    }
}
