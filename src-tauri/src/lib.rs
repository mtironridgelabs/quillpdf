use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;

use base64::Engine;
use tauri::{AppHandle, Emitter, Manager, State};

/// Latest PDF the shell was asked to open. The webview pulls the bytes.
struct LaunchQueue {
    pending: Mutex<Option<PathBuf>>,
}

#[derive(serde::Serialize)]
struct OpenedPdf {
    name: String,
    base64: String,
}

fn pdf_from_arg(arg: &str) -> Option<PathBuf> {
    let trimmed = arg.trim().trim_matches('"');
    if trimmed.is_empty() || trimmed.starts_with('-') {
        return None;
    }
    let path = PathBuf::from(trimmed);
    let ext = path.extension().and_then(|value| value.to_str())?;
    if !ext.eq_ignore_ascii_case("pdf") {
        return None;
    }
    let canonical = path.canonicalize().ok()?;
    if !canonical.is_file() {
        return None;
    }
    Some(canonical)
}

fn focus_main(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn register_pdf_args(app: &AppHandle, args: &[String]) {
    if let Some(path) = args.iter().filter_map(|arg| pdf_from_arg(arg)).last() {
        if let Some(queue) = app.try_state::<LaunchQueue>() {
            if let Ok(mut pending) = queue.pending.lock() {
                *pending = Some(path);
            }
        }
        let _ = app.emit("quill-open-pdf", ());
    }
    focus_main(app);
}

#[tauri::command]
fn take_opened_pdf(queue: State<LaunchQueue>) -> Result<Option<OpenedPdf>, String> {
    let path = queue
        .pending
        .lock()
        .map_err(|_| "Quill couldn't read the open-file queue.".to_string())?
        .take();
    let Some(path) = path else {
        return Ok(None);
    };
    let bytes =
        fs::read(&path).map_err(|err| format!("Couldn't read {}: {err}", path.display()))?;
    let name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("document.pdf")
        .to_string();
    Ok(Some(OpenedPdf {
        name,
        base64: base64::engine::general_purpose::STANDARD.encode(bytes),
    }))
}

#[tauri::command]
fn write_pdf_file(path: String, base64: String) -> Result<(), String> {
    let path = PathBuf::from(path.trim());
    let name = path
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| "Choose a PDF file name.".to_string())?;
    if name == ".pdf" || !name.to_ascii_lowercase().ends_with(".pdf") {
        return Err("Quill only saves PDF files.".into());
    }
    if path
        .components()
        .any(|component| matches!(component, std::path::Component::ParentDir))
    {
        return Err("Choose a PDF path without '..'.".into());
    }
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(base64.trim())
        .map_err(|_| "Couldn't read the PDF bytes.".to_string())?;
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent)
                .map_err(|err| format!("Couldn't create the folder: {err}"))?;
        }
    }
    fs::write(&path, bytes).map_err(|err| format!("Couldn't save the PDF: {err}"))?;
    Ok(())
}

#[tauri::command]
fn open_default_apps() -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        // `start` treats the first quoted argument as a window title.
        std::process::Command::new("cmd")
            .args(["/C", "start", "", "ms-settings:defaultapps"])
            .spawn()
            .map_err(|err| format!("Couldn't open Windows default app settings: {err}"))?;
        return Ok(());
    }
    #[cfg(not(target_os = "windows"))]
    {
        Err("Windows default app settings are only available in the Windows app.".into())
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            register_pdf_args(app, &args);
        }))
        .manage(LaunchQueue {
            pending: Mutex::new(None),
        })
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            register_pdf_args(app.handle(), &std::env::args().collect::<Vec<_>>());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            take_opened_pdf,
            write_pdf_file,
            open_default_apps
        ])
        .run(tauri::generate_context!())
        .expect("error while running Quill");
}

#[cfg(test)]
mod tests {
    use super::pdf_from_arg;

    #[test]
    fn ignores_flags_and_non_pdf_args() {
        assert!(pdf_from_arg("--no-default-features").is_none());
        assert!(pdf_from_arg("quill.exe").is_none());
        assert!(pdf_from_arg("").is_none());
    }

    #[test]
    fn rejects_a_missing_pdf() {
        assert!(pdf_from_arg("this-file-does-not-exist.pdf").is_none());
    }
}
