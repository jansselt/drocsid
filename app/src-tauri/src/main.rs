// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    #[cfg(target_os = "linux")]
    unsafe {
        // Force X11 — Tauri's tray icon (libappindicator) causes Wayland protocol errors
        std::env::set_var("GDK_BACKEND", "x11");
        // Disable DMA-BUF renderer — GBM buffer creation fails under XWayland,
        // causing invisible webview content
        std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
    }

    drocsid_lib::run();
}
