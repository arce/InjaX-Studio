use std::fs;
use std::path::PathBuf;
use std::process::Command;
use tauri::{Emitter, Manager};
use tauri::menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder};

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

// ─── Tauri commands ───────────────────────────────────────────────────────────

#[tauri::command]
async fn generate_svg(
    app: tauri::AppHandle,
    template_content: String,
    data_content: String,
) -> Result<String, String> {
    let injax_path = get_injax_binary(&app)?;
    ensure_executable(&injax_path)?;

    let temp_dir = std::env::temp_dir().join("injax-studio");
    fs::create_dir_all(&temp_dir).map_err(|e| e.to_string())?;

    let id = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .subsec_nanos();

    let template_path = temp_dir.join(format!("template_{}.j2",  id));
    let data_path     = temp_dir.join(format!("data_{}.json",    id));
    let output_path   = temp_dir.join(format!("output_{}.svg",   id));

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

    let svg = fs::read_to_string(&output_path)
        .map_err(|e| format!("Failed to read generated SVG: {}", e))?;
    let _ = fs::remove_file(&output_path);

    if !svg.contains("<svg") {
        return Err("Generated file is not a valid SVG".to_string());
    }
    Ok(svg)
}

#[tauri::command]
async fn save_svg(
    app: tauri::AppHandle,
    content: String,
    default_name: String,
) -> Result<bool, String> {
    use tauri_plugin_dialog::DialogExt;
    use tokio::sync::oneshot;

    let (tx, rx) = oneshot::channel();
    app.dialog()
        .file()
        .set_file_name(&default_name)
        .add_filter("SVG", &["svg"])
        .save_file(move |path| { let _ = tx.send(path); });

    match rx.await.map_err(|e| e.to_string())? {
        None => Ok(false),
        Some(fp) => {
            let path = fp.into_path()
                .map_err(|_| "Unsupported path type".to_string())?;
            fs::write(&path, content)
                .map_err(|e| format!("Failed to save SVG: {}", e))?;
            Ok(true)
        }
    }
}

#[tauri::command]
async fn save_template(app: tauri::AppHandle, content: String) -> Result<bool, String> {
    save_dialog(app, content, "Jinja2 Template", &["j2", "jinja2", "jinja"]).await
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
        .setup(|app| {
            // Templates menu
            let t_load = MenuItemBuilder::with_id("template-load", "Load Template...")
                .accelerator("CmdOrCtrl+O").build(app)?;
            let t_save = MenuItemBuilder::with_id("template-save", "Save Template...")
                .accelerator("CmdOrCtrl+S").build(app)?;

            // Data menu
            let d_load = MenuItemBuilder::with_id("data-load", "Load Data...")
                .accelerator("CmdOrCtrl+D").build(app)?;
            let d_save = MenuItemBuilder::with_id("data-save", "Save Data...")
                .accelerator("CmdOrCtrl+Shift+D").build(app)?;

            // View menu
            let v_gen  = MenuItemBuilder::with_id("view-generate", "Generate SVG")
                .accelerator("CmdOrCtrl+G").build(app)?;
            let v_save = MenuItemBuilder::with_id("view-save", "Save SVG...")
                .accelerator("CmdOrCtrl+Shift+S").build(app)?;

            let menu = MenuBuilder::new(app)
                .item(&SubmenuBuilder::new(app, "Templates")
                    .item(&t_load).item(&t_save).build()?)
                .item(&SubmenuBuilder::new(app, "Data")
                    .item(&d_load).item(&d_save).build()?)
                .item(&SubmenuBuilder::new(app, "View")
                    .item(&v_gen).item(&v_save).build()?)
                .build()?;

            app.set_menu(menu)?;

            app.on_menu_event(|app, event| {
                let _ = app.emit("menu-action", event.id().as_ref().to_string());
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            generate_svg,
            save_svg,
            save_template,
            save_data,
            quit_app,
        ])
        .run(tauri::generate_context!())
        .expect("Failed to start InjaX Studio");
}
