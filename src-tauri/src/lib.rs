use std::fs;
use std::path::PathBuf;
use std::process::Command;
use serde::Serialize;
use tauri::{Emitter, Manager};

// ─── Helpers ──────────────────────────────────────────────────────────────────

fn get_injax_binary(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    #[cfg(target_os = "macos")]
    let binary_name = "injax_mac";
    #[cfg(target_os = "windows")]
    let binary_name = "injax.exe";
    #[cfg(target_os = "linux")]
    let binary_name = "injax";

    // 1. Release build: look in the app bundle's resource directory
    if let Ok(resource_dir) = app.path().resource_dir() {
        let path = resource_dir.join(binary_name);
        if path.exists() { return Ok(path); }
    }

    // 2. Dev mode: walk up from the current executable until we find bin/<binary>
    if let Ok(exe) = std::env::current_exe() {
        let mut dir = exe.parent();
        while let Some(d) = dir {
            let candidate = d.join("bin").join(binary_name);
            if candidate.exists() { return Ok(candidate); }
            dir = d.parent();
        }
    }

    Err(format!("Binary '{}' not found. Place it in the project's bin/ folder.", binary_name))
}

#[cfg(unix)]
fn ensure_executable(path: &PathBuf) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;
    let mut perms = fs::metadata(path).map_err(|e| e.to_string())?.permissions();
    perms.set_mode(0o755);
    fs::set_permissions(path, perms).map_err(|e| e.to_string())
}

#[cfg(not(unix))]
fn ensure_executable(_path: &PathBuf) -> Result<(), String> { Ok(()) }

// ─── Generic save dialog ──────────────────────────────────────────────────────

async fn save_dialog(
    app: tauri::AppHandle,
    content: String,
    filter_name: &str,
    extensions: &[&str],
) -> Result<bool, String> {
    use tauri_plugin_dialog::DialogExt;
    use tokio::sync::oneshot;

    let (tx, rx) = oneshot::channel();
    app.dialog()
        .file()
        .add_filter(filter_name, extensions)
        .save_file(move |path| { let _ = tx.send(path); });

    match rx.await.map_err(|e| e.to_string())? {
        None => Ok(false),
        Some(fp) => {
            let path = fp.into_path()
                .map_err(|_| "Unsupported path type".to_string())?;
            fs::write(&path, content)
                .map_err(|e| format!("Failed to save file: {}", e))?;
            Ok(true)
        }
    }
}

// ─── Shared types ────────────────────────────────────────────────────────────

#[derive(Serialize)]
struct OpenedFile {
    path: String,
    name: String,
    content: String,
}

// ─── Tauri commands ───────────────────────────────────────────────────────────

#[tauri::command]
async fn generate_output(
    app: tauri::AppHandle,
    template_content: String,
    data_content: String,
    output_ext: String,
) -> Result<String, String> {
    let injax_path = get_injax_binary(&app)?;
    ensure_executable(&injax_path)?;

    let temp_dir = std::env::temp_dir().join("injax-studio");
    fs::create_dir_all(&temp_dir).map_err(|e| e.to_string())?;

    let id = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .subsec_nanos();

    let ext = if output_ext.is_empty() { "txt".to_string() } else { output_ext };
    let template_path = temp_dir.join(format!("template_{}.inja", id));
    let data_path     = temp_dir.join(format!("data_{}.json",     id));
    let output_path   = temp_dir.join(format!("output_{}.{}",     id, ext));

    fs::write(&template_path, &template_content).map_err(|e| e.to_string())?;
    fs::write(&data_path,     &data_content    ).map_err(|e| e.to_string())?;

    // injax looks for modules/ and readers/ relative to its working directory
    let bin_dir = injax_path.parent()
        .ok_or_else(|| "Cannot determine binary directory".to_string())?;

    let result = Command::new(&injax_path)
        .args([
            data_path.to_str().unwrap(),
            template_path.to_str().unwrap(),
            output_path.to_str().unwrap(),
        ])
        .current_dir(bin_dir)
        .output();

    let _ = fs::remove_file(&template_path);
    let _ = fs::remove_file(&data_path);

    let output = result.map_err(|e| format!("Failed to run injax: {}", e))?;

    if !output.status.success() {
        let _ = fs::remove_file(&output_path);
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).to_string();
        return Err(if !stderr.is_empty() { stderr } else { stdout });
    }

    let content = fs::read_to_string(&output_path)
        .map_err(|e| format!("Failed to read generated output: {}", e))?;
    let _ = fs::remove_file(&output_path);

    Ok(content)
}

#[tauri::command]
async fn save_output(
    app: tauri::AppHandle,
    content: String,
    default_name: String,
    ext: String,
) -> Result<bool, String> {
    use tauri_plugin_dialog::DialogExt;
    use tokio::sync::oneshot;

    let (tx, rx) = oneshot::channel();
    let filter_name = ext.to_uppercase();
    let ext_ref: &str = ext.as_str();
    app.dialog()
        .file()
        .set_file_name(&default_name)
        .add_filter(&filter_name, &[ext_ref])
        .save_file(move |path| { let _ = tx.send(path); });

    match rx.await.map_err(|e| e.to_string())? {
        None => Ok(false),
        Some(fp) => {
            let path = fp.into_path()
                .map_err(|_| "Unsupported path type".to_string())?;
            fs::write(&path, content)
                .map_err(|e| format!("Failed to save output: {}", e))?;
            Ok(true)
        }
    }
}

/// Open a file-picker dialog and return path + content of the chosen template.
#[tauri::command]
async fn open_template_file(app: tauri::AppHandle) -> Result<Option<OpenedFile>, String> {
    use tauri_plugin_dialog::DialogExt;
    use tokio::sync::oneshot;

    let (tx, rx) = oneshot::channel();
    app.dialog()
        .file()
        .add_filter("Jinja2 Template", &["inja", "injax", "j2", "jinja2", "jinja", "txt"])
        .pick_file(move |path| { let _ = tx.send(path); });

    match rx.await.map_err(|e| e.to_string())? {
        None => Ok(None),
        Some(fp) => {
            let path = fp.into_path()
                .map_err(|_| "Unsupported path type".to_string())?;
            let name = path.file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_else(|| "template.inja".to_string());
            let content = fs::read_to_string(&path)
                .map_err(|e| format!("Failed to read file: {}", e))?;
            Ok(Some(OpenedFile {
                path: path.to_string_lossy().to_string(),
                name,
                content,
            }))
        }
    }
}

/// Save template content directly to an existing path (no dialog).
#[tauri::command]
async fn save_template_to_path(path: String, content: String) -> Result<(), String> {
    fs::write(&path, content).map_err(|e| format!("Failed to save file: {}", e))
}

/// Save template with a Save-As dialog (always prompts for location).
#[tauri::command]
async fn save_template(app: tauri::AppHandle, content: String) -> Result<bool, String> {
    save_dialog(app, content, "Jinja2 Template", &["j2", "jinja2", "jinja", "inja", "injax"]).await
}

#[tauri::command]
async fn save_data(app: tauri::AppHandle, content: String) -> Result<bool, String> {
    save_dialog(app, content, "JSON", &["json"]).await
}

#[tauri::command]
fn quit_app(app: tauri::AppHandle) {
    app.exit(0);
}

// ─── Entry point ──────────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|_app| {
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            generate_output,
            save_output,
            open_template_file,
            save_template_to_path,
            save_template,
            save_data,
            quit_app,
        ])
        .run(tauri::generate_context!())
        .expect("Failed to start InjaX Studio");
}
