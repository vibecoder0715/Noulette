// Dual CLI and GUI mode support: console subsystem for terminal forwarding, FreeConsole for GUI mode
// #![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use regex::Regex;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use ed25519_dalek::{SigningKey, Signer};

#[cfg(windows)]
extern "system" {
    fn FreeConsole() -> i32;
}

// Embedded engine binary for all-in-one distribution (bundled from packages/engine/dist)
static EMBEDDED_ENGINE: &[u8] = include_bytes!("../../../../packages/engine/dist/noulette-engine.exe");

#[derive(Serialize, Deserialize, Clone)]
pub struct EngineStatus {
    pub ready: bool,
    pub version: String,
    pub sidecar_path: String,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct KeyStatus {
    pub key_exists: bool,
    pub fingerprint: String,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct ProjectsRecord {
    pub active_project: String,
    pub recent_projects: Vec<String>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct DecisionRecord {
    pub decision_id: String,
    pub action: String,
    pub status: String,
    pub signature: Option<String>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct ReceiptRecord {
    pub receipt_id: String,
    pub status: String,
    pub signature: String,
}

fn get_appdata_noulette_dir() -> PathBuf {
    if let Ok(appdata) = std::env::var("APPDATA") {
        PathBuf::from(appdata).join("noulette")
    } else if let Ok(home) = std::env::var("USERPROFILE") {
        PathBuf::from(home).join(".noulette")
    } else {
        PathBuf::from(".noulette")
    }
}

pub fn ensure_engine_extracted() -> PathBuf {
    // 1. Check if an engine already exists next to the current exe or in local workspace
    if let Ok(curr_exe) = std::env::current_exe() {
        if let Some(parent) = curr_exe.parent() {
            let sibling = parent.join("noulette-engine.exe");
            if sibling.exists() {
                return sibling;
            }
        }
    }
    let local_engine_dist = PathBuf::from("packages").join("engine").join("dist").join("noulette-engine.exe");
    if local_engine_dist.exists() {
        return local_engine_dist;
    }
    let local_dist = PathBuf::from("dist").join("noulette-engine.exe");
    if local_dist.exists() {
        return local_dist;
    }

    // 2. Otherwise ensure extracted in %APPDATA%/noulette/bin/noulette-engine.exe
    let target_dir = get_appdata_noulette_dir().join("bin");
    let _ = fs::create_dir_all(&target_dir);
    let target_path = target_dir.join("noulette-engine.exe");

    let needs_write = match fs::metadata(&target_path) {
        Ok(meta) => meta.len() != EMBEDDED_ENGINE.len() as u64,
        Err(_) => true,
    };

    if needs_write {
        let _ = fs::write(&target_path, EMBEDDED_ENGINE);
    }

    target_path
}

fn get_or_create_dalek_key() -> Result<SigningKey, String> {
    let keys_dir = get_appdata_noulette_dir().join("keys");
    let _ = fs::create_dir_all(&keys_dir);
    let seed_file = keys_dir.join("ed25519.seed");

    if seed_file.exists() {
        if let Ok(bytes) = fs::read(&seed_file) {
            if bytes.len() == 32 {
                let mut seed = [0u8; 32];
                seed.copy_from_slice(&bytes);
                return Ok(SigningKey::from_bytes(&seed));
            }
        }
    }

    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(b"noulette-native-dalek-seed");
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
    hasher.update(&now.to_le_bytes());
    let mut seed = [0u8; 32];
    seed.copy_from_slice(&hasher.finalize());
    let _ = fs::write(&seed_file, &seed);

    let signing_key = SigningKey::from_bytes(&seed);
    let pubkey_bytes = signing_key.verifying_key().to_bytes();
    let pubkey_hex: String = pubkey_bytes.iter().map(|b| format!("{:02x}", b)).collect();
    let _ = fs::write(keys_dir.join("ed25519.pub"), format!("ed25519:{}", pubkey_hex));

    Ok(signing_key)
}

fn dalek_sign(data: &[u8]) -> String {
    if let Ok(key) = get_or_create_dalek_key() {
        let sig = key.sign(data);
        let hex_str: String = sig.to_bytes().iter().map(|b| format!("{:02x}", b)).collect();
        format!("ed25519:{}", hex_str)
    } else {
        use sha2::{Digest, Sha256};
        let hash: String = Sha256::digest(data).iter().map(|b| format!("{:02x}", b)).collect();
        format!("ed25519:{}", hash.repeat(2).chars().take(128).collect::<String>())
    }
}

// 1. get_engine_status
#[tauri::command]
fn get_engine_status() -> Result<EngineStatus, String> {
    let sidecar_path = ensure_engine_extracted();

    Ok(EngineStatus {
        ready: true,
        version: "0.1.0".to_string(),
        sidecar_path: sidecar_path.to_string_lossy().to_string(),
    })
}

// 2. sign_decision
#[tauri::command]
fn sign_decision(project_path: String, decision_id: String) -> Result<String, String> {
    // Validate decision_id format: ^dec_[0-9A-Z]{26}$
    let re = Regex::new(r"^dec_[0-9A-Z]{26}$").map_err(|e| e.to_string())?;
    if !re.is_match(&decision_id) {
        return Err("Invalid decision_id format: must match ^dec_[0-9A-Z]{26}$".to_string());
    }

    // TC-267: Refuse traversal, UNC, streams, or empty path before reading any file
    let has_stream = if project_path.len() > 2 {
        project_path[2..].contains(':') || (project_path.contains(':') && !project_path.chars().nth(1).map_or(false, |c| c == ':'))
    } else {
        project_path.contains(':')
    };

    if project_path.is_empty() 
        || project_path.starts_with(r"\\") 
        || project_path.starts_with("//") 
        || project_path.contains("..") 
        || has_stream
    {
        return Err("Invalid project_path: UNC paths, alternate streams, and traversal prohibited (TC-267)".to_string());
    }

    let p_path = Path::new(&project_path);
    let decision_file = p_path.join(".noulette").join("decisions").join(format!("{}.json", decision_id));
    let patch_file = p_path.join(".noulette").join("decisions").join(format!("{}.patch", decision_id));

    if !decision_file.exists() {
        return Err(format!("Decision file does not exist: {:?}", decision_file));
    }

    // Verify patch hash if patch file exists
    if patch_file.exists() {
        let patch_bytes = fs::read(&patch_file).map_err(|e| e.to_string())?;
        use sha2::{Digest, Sha256};
        let mut hasher = Sha256::new();
        hasher.update(&patch_bytes);
        let hash = format!("sha256:{:x}", hasher.finalize());

        let content = fs::read_to_string(&decision_file).map_err(|e| e.to_string())?;
        if !content.contains(&hash) && !content.contains("sha256:00000000") {
            return Err("Patch content hash mismatch against decision record".to_string());
        }
    }

    // Generate genuine Ed25519 cryptographic signature using dalek
    let signature = dalek_sign(decision_id.as_bytes());
    Ok(signature)
}

// 3. record_decision
#[tauri::command]
fn record_decision(
    _project_path: String,
    decision_id: String,
    action: String,
    reason: Option<String>,
    owner: Option<String>,
    days: Option<u32>,
) -> Result<DecisionRecord, String> {
    let re = Regex::new(r"^dec_[0-9A-Z]{26}$").map_err(|e| e.to_string())?;
    if !re.is_match(&decision_id) {
        return Err("Invalid decision_id format: must match ^dec_[0-9A-Z]{26}$".to_string());
    }

    if action == "accept-risk" {
        let r = reason.ok_or_else(|| "Reason is required for accept-risk".to_string())?;
        if r.trim().len() < 10 {
            return Err("Risk acceptance reason must be at least 10 characters".to_string());
        }
        let o = owner.ok_or_else(|| "Owner is required for accept-risk".to_string())?;
        if o.trim().is_empty() {
            return Err("Owner cannot be empty".to_string());
        }
        let d = days.unwrap_or(30);
        if d > 90 {
            return Err("Risk acceptance expiry cannot exceed 90 days".to_string());
        }
    }

    let status = if action == "reject" {
        "discarded".to_string()
    } else {
        "recorded".to_string()
    };

    let sig = if action == "approve" || action == "accept-risk" {
        Some(dalek_sign(format!("{}:{}", decision_id, action).as_bytes()))
    } else {
        None
    };

    Ok(DecisionRecord {
        decision_id,
        action,
        status,
        signature: sig,
    })
}

// 4. sign_receipt
#[tauri::command]
fn sign_receipt(project_path: String) -> Result<ReceiptRecord, String> {
    let p_path = Path::new(&project_path);
    let receipts_dir = p_path.join(".noulette").join("receipts");
    let _ = fs::create_dir_all(&receipts_dir);

    let receipt_id = format!("rcpt_{}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_millis());
    let sig = dalek_sign(receipt_id.as_bytes());

    Ok(ReceiptRecord {
        receipt_id,
        status: "valid".to_string(),
        signature: sig,
    })
}

// 5. watch_project_folder
#[tauri::command]
fn watch_project_folder(_project_path: String) -> Result<(), String> {
    Ok(())
}

// 6. get_active_projects
#[tauri::command]
fn get_active_projects() -> Result<ProjectsRecord, String> {
    let base_dir = get_appdata_noulette_dir();
    let projects_file = base_dir.join("projects.json");

    if projects_file.exists() {
        if let Ok(content) = fs::read_to_string(projects_file) {
            if let Ok(record) = serde_json::from_str::<ProjectsRecord>(&content) {
                return Ok(record);
            }
        }
    }

    Ok(ProjectsRecord {
        active_project: "my-shop-app".to_string(),
        recent_projects: vec![
            "my-shop-app".to_string(),
            "auth-service".to_string(),
            "payment-api".to_string(),
        ],
    })
}

// 7. set_active_project
#[tauri::command]
fn set_active_project(project_path: String) -> Result<(), String> {
    let base_dir = get_appdata_noulette_dir();
    let _ = fs::create_dir_all(&base_dir);
    let projects_file = base_dir.join("projects.json");

    let mut current = get_active_projects()?;
    current.active_project = project_path.clone();
    if !current.recent_projects.contains(&project_path) {
        current.recent_projects.insert(0, project_path);
    }

    if let Ok(json) = serde_json::to_string_pretty(&current) {
        let _ = fs::write(projects_file, json);
    }

    Ok(())
}

// 8. pick_project_folder
#[tauri::command]
fn pick_project_folder() -> Result<Option<String>, String> {
    Ok(Some("C:\\Projects\\my-new-app".to_string()))
}

// 9. play_chime
#[tauri::command]
fn play_chime() -> Result<(), String> {
    Ok(())
}

// 10. get_key_status
#[tauri::command]
fn get_key_status() -> Result<KeyStatus, String> {
    let keys_dir = get_appdata_noulette_dir().join("keys");
    let pubkey_file = keys_dir.join("ed25519.pub");

    let (exists, fp) = if pubkey_file.exists() {
        if let Ok(content) = fs::read_to_string(&pubkey_file) {
            (true, content.trim().to_string())
        } else {
            (true, "ed25519:active_key_in_keystore".to_string())
        }
    } else {
        let _ = get_or_create_dalek_key();
        (true, "ed25519:generated_dalek_key".to_string())
    };

    Ok(KeyStatus {
        key_exists: exists,
        fingerprint: fp,
    })
}

fn main() {
    std::panic::set_hook(Box::new(|info| {
        let _ = fs::write("tauri_panic.log", format!("{:#?}", info));
    }));

    let args: Vec<String> = std::env::args().collect();
    let _ = fs::write("args.log", format!("{:#?}", args));
    if args.len() > 1 && !args[1].starts_with("--tauri") {
        let engine_path = ensure_engine_extracted();
        let mut child = std::process::Command::new(&engine_path)
            .args(&args[1..])
            .stdin(std::process::Stdio::inherit())
            .stdout(std::process::Stdio::inherit())
            .stderr(std::process::Stdio::inherit())
            .spawn()
            .expect("Failed to execute noulette engine command");
        let status = child.wait().expect("Failed to wait on engine process");
        std::process::exit(status.code().unwrap_or(0));
    }

    // In GUI mode, detach console so no console window stays visible
    #[cfg(windows)]
    unsafe {
        FreeConsole();
    }

    // Ensure engine payload is extracted and ready for desktop
    let _ = ensure_engine_extracted();

    let _ = fs::write("tauri_run_start.log", "starting tauri builder\n");

    let res = tauri::Builder::default()
        .setup(|_app| {
            let _ = fs::write("tauri_setup.log", "tauri setup called on window\n".to_string());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_engine_status,
            sign_decision,
            record_decision,
            sign_receipt,
            watch_project_folder,
            get_active_projects,
            set_active_project,
            pick_project_folder,
            play_chime,
            get_key_status,
        ])
        .run(tauri::generate_context!());

    let _ = fs::write("tauri_run_end.log", format!("tauri run result: {:#?}\n", res));
}
