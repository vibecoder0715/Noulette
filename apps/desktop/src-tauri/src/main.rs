// Noulette desktop shell: starts the hidden background engine (daemon), shows the UI,
// lives in the tray, and optionally starts at Windows sign-in.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::Duration;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, State, WindowEvent};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt};

#[cfg(windows)]
use std::os::windows::process::CommandExt;
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

struct Engine {
    child: Mutex<Option<Child>>,
    token: Mutex<Option<String>>,
}

#[derive(Serialize, Deserialize, Clone)]
struct DaemonInfo {
    port: u16,
    token: String,
}

fn data_dir() -> PathBuf {
    if let Ok(h) = std::env::var("NOULETTE_HOME") {
        return PathBuf::from(h);
    }
    std::env::var("APPDATA").map(|a| PathBuf::from(a).join("noulette")).unwrap_or_else(|_| PathBuf::from(".noulette"))
}

/// The engine is installed next to this exe (Tauri sidecar). In development it is built into packages/engine/dist.
fn engine_path() -> PathBuf {
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let p = dir.join("noulette-engine.exe");
            if p.exists() {
                return p;
            }
        }
    }
    let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..").join("..").join("..").join("packages").join("engine").join("dist").join("noulette-engine.exe");
    dev
}

fn resource_env(app: &AppHandle, cmd: &mut Command) {
    if let Ok(res) = app.path().resource_dir() {
        let scanners = res.join("resources").join("scanners");
        let rules = res.join("resources").join("rules");
        let ui = res.join("resources").join("ui");
        if scanners.exists() {
            cmd.env("NOULETTE_SCANNERS", scanners);
        }
        if rules.exists() {
            cmd.env("NOULETTE_RULES", rules);
        }
        if ui.exists() {
            cmd.env("NOULETTE_UI", ui);
        }
    }
}

fn hidden(cmd: &mut Command) {
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
}

fn read_port() -> Option<u16> {
    let raw = std::fs::read_to_string(data_dir().join("daemon.json")).ok()?;
    let v: serde_json::Value = serde_json::from_str(&raw).ok()?;
    v.get("port")?.as_u64().map(|p| p as u16)
}

fn port_alive(port: u16) -> bool {
    std::net::TcpStream::connect_timeout(&format!("127.0.0.1:{port}").parse().unwrap(), Duration::from_millis(400)).is_ok()
}

fn start_daemon(app: &AppHandle, engine: &Engine) {
    if let Some(p) = read_port() {
        if port_alive(p) {
            return; // already running (for example started at sign-in)
        }
    }
    let mut cmd = Command::new(engine_path());
    cmd.arg("daemon").stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
    resource_env(app, &mut cmd);
    hidden(&mut cmd);
    if let Ok(child) = cmd.spawn() {
        *engine.child.lock().unwrap() = Some(child);
    }
}

fn fetch_token(app: &AppHandle) -> Option<String> {
    let mut cmd = Command::new(engine_path());
    cmd.arg("token").stdin(Stdio::null()).stderr(Stdio::null());
    resource_env(app, &mut cmd);
    hidden(&mut cmd);
    let out = cmd.output().ok()?;
    let v: serde_json::Value = serde_json::from_slice(&out.stdout).ok()?;
    v.get("token")?.as_str().map(|s| s.to_string())
}

#[tauri::command]
async fn daemon_info(app: AppHandle, engine: State<'_, Engine>) -> Result<DaemonInfo, String> {
    for _ in 0..40 {
        if let Some(port) = read_port() {
            if port_alive(port) {
                let mut tok = engine.token.lock().unwrap().clone();
                if tok.is_none() {
                    tok = fetch_token(&app);
                    *engine.token.lock().unwrap() = tok.clone();
                }
                if let Some(token) = tok {
                    return Ok(DaemonInfo { port, token });
                }
            }
        }
        start_daemon(&app, &engine);
        std::thread::sleep(Duration::from_millis(250));
    }
    Err("The Noulette background service did not start.".into())
}

#[tauri::command]
fn set_autostart(app: AppHandle, enabled: bool) -> Result<(), String> {
    let al = app.autolaunch();
    if enabled { al.enable() } else { al.disable() }.map_err(|e| e.to_string())
}

fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

fn main() {
    let hidden_start = std::env::args().any(|a| a == "--hidden");
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| show_main(app)))
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, Some(vec!["--hidden"])))
        .manage(Engine { child: Mutex::new(None), token: Mutex::new(None) })
        .setup(move |app| {
            let handle = app.handle().clone();
            start_daemon(&handle, &app.state::<Engine>());
            let show = MenuItem::with_id(app, "show", "Open Noulette", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit Noulette", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit])?;
            TrayIconBuilder::with_id("main")
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("Noulette")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, e| match e.id.as_ref() {
                    "show" => show_main(app),
                    "quit" => {
                        if let Some(mut c) = app.state::<Engine>().child.lock().unwrap().take() {
                            let _ = c.kill();
                        }
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, e| {
                    if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = e {
                        show_main(tray.app_handle());
                    }
                })
                .build(app)?;
            if hidden_start {
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.hide();
                }
            }
            Ok(())
        })
        .on_window_event(|w, e| {
            // Closing the window keeps Noulette running in the tray (monitoring and the download guard continue).
            if let WindowEvent::CloseRequested { api, .. } = e {
                api.prevent_close();
                let _ = w.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![daemon_info, set_autostart])
        .run(tauri::generate_context!())
        .expect("error while running Noulette");
}
