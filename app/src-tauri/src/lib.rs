#[cfg(target_os = "linux")]
mod audio;

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
            audio::list_audio_sources,
            #[cfg(target_os = "linux")]
            audio::get_default_audio_source,
            #[cfg(target_os = "linux")]
            audio::set_audio_source,
            #[cfg(target_os = "linux")]
            audio::label_audio_streams,
        ])
        .setup(|app| {
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
