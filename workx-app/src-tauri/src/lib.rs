mod app_server;

use tauri::{Manager, RunEvent};

use app_server::AppServerManager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(AppServerManager::default())
        .invoke_handler(tauri::generate_handler![
            app_server::app_server_start,
            app_server::app_server_stop,
            app_server::app_server_status,
            app_server::app_server_write,
        ])
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(|app, event| {
            if let RunEvent::Exit = event {
                app.state::<AppServerManager>().shutdown();
            }
        });
}
