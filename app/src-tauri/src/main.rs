// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Force X11 on Linux — Tauri's tray icon (libappindicator) causes Wayland
    // protocol errors. XWayland works fine on modern Wayland compositors.
    #[cfg(target_os = "linux")]
    unsafe {
        std::env::set_var("GDK_BACKEND", "x11");
    }

    drocsid_lib::run();
}
