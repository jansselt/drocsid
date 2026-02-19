#[cfg(target_os = "linux")]
mod audio;
mod voice;

use log::LevelFilter;
use simplelog::{CombinedLogger, ConfigBuilder, TermLogger, TerminalMode, ColorChoice, WriteLogger};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager,
};

fn setup_tray(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let icon = app
        .default_window_icon()
        .cloned()
        .ok_or("no default window icon")?;

    let show_i = MenuItem::with_id(app, "show", "Show Drocsid", true, None::<&str>)?;
    let quit_i = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show_i, &quit_i])?;

    let _tray = TrayIconBuilder::new()
        .icon(icon)
        .tooltip("Drocsid")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.unminimize();
                    let _ = window.set_focus();
                }
            }
            "quit" => {
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| match event {
            TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } => {
                let app = tray.app_handle();
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.unminimize();
                    let _ = window.set_focus();
                }
            }
            _ => {}
        })
        .build(app)?;

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![
            #[cfg(target_os = "linux")]
            audio::list_audio_sinks,
            #[cfg(target_os = "linux")]
            audio::set_audio_sink,
            #[cfg(target_os = "linux")]
            audio::get_default_audio_sink,
            #[cfg(target_os = "linux")]
            audio::label_audio_streams,
            voice::voice_connect,
            voice::voice_disconnect,
            voice::voice_set_mute,
            voice::voice_set_deaf,
            voice::voice_set_user_volume,
            voice::voice_list_input_devices,
            voice::voice_list_output_devices,
            voice::voice_mic_test_start,
            voice::voice_mic_test_stop,
        ])
        .setup(|app| {
            // Initialize file + terminal logging
            {
                let log_dir = app.path().app_log_dir().unwrap_or_else(|_| {
                    std::env::temp_dir().join("drocsid")
                });
                let _ = std::fs::create_dir_all(&log_dir);
                let log_path = log_dir.join("drocsid.log");

                // Truncate to keep only the current session's log
                let file = std::fs::OpenOptions::new()
                    .create(true)
                    .write(true)
                    .truncate(true)
                    .open(&log_path);

                let log_config = ConfigBuilder::new()
                    .set_time_format_rfc3339()
                    .build();

                let mut loggers: Vec<Box<dyn simplelog::SharedLogger>> = vec![
                    TermLogger::new(
                        LevelFilter::Info,
                        log_config.clone(),
                        TerminalMode::Mixed,
                        ColorChoice::Auto,
                    ),
                ];
                if let Ok(f) = file {
                    // Wrap in LineWriter so every log line flushes to disk immediately.
                    // Without this, BufWriter holds data in memory and we lose logs on crash.
                    let line_writer = std::io::LineWriter::new(f);
                    loggers.push(WriteLogger::new(LevelFilter::Debug, log_config, line_writer));
                }
                let _ = CombinedLogger::init(loggers);
                log::info!("Drocsid v{} starting — log: {}", env!("CARGO_PKG_VERSION"), log_path.display());

                // Install panic hook that writes to a crash file (survives process abort)
                let crash_path = log_dir.join("drocsid-crash.log");
                std::panic::set_hook(Box::new(move |info| {
                    let msg = format!(
                        "PANIC at {}: {}\n\nBacktrace:\n{:?}\n",
                        info.location().map(|l| l.to_string()).unwrap_or_default(),
                        info,
                        std::backtrace::Backtrace::force_capture(),
                    );
                    // Write directly to crash file (not through log framework)
                    let _ = std::fs::write(&crash_path, &msg);
                    // Also try logging (may not flush)
                    log::error!("{msg}");
                }));
            }

            // Register voice managed state (native LiveKit + cpal)
            app.manage(voice::VoiceState::new());
            app.manage(voice::MicTestState::new());

            // Open devtools in debug builds
            if cfg!(debug_assertions) {
                if let Some(window) = app.get_webview_window("main") {
                    window.open_devtools();
                }
            }

            // Enable media devices (getUserMedia) and WebRTC in the webview
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.with_webview(|webview| {
                    #[cfg(target_os = "linux")]
                    {
                        use webkit2gtk::{
                            glib::prelude::ObjectExt, DeviceInfoPermissionRequest,
                            PermissionRequestExt, SettingsExt,
                            UserMediaPermissionRequest, WebViewExt,
                        };

                        let wv = webview.inner();
                        if let Some(settings) = wv.settings() {
                            settings.set_enable_media_stream(true);
                            settings.set_enable_webrtc(true);
                            settings.set_enable_mediasource(true);
                            settings.set_enable_media_capabilities(true);
                        }

                        // Auto-grant camera/mic and device-enumeration permissions
                        wv.connect_permission_request(|_, request| {
                            if request.is::<UserMediaPermissionRequest>()
                                || request.is::<DeviceInfoPermissionRequest>()
                            {
                                request.allow();
                                return true;
                            }
                            false // default handling for other permission types
                        });
                    }
                });
            }

            match setup_tray(app) {
                Ok(()) => {}
                Err(e) => {
                    eprintln!("Warning: failed to create tray icon: {e}");
                }
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let _ = window.hide();
                api.prevent_close();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
