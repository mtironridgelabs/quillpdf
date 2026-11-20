mod pdfium_fill;

use std::fs;
use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;

use base64::Engine;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_dialog::DialogExt;

/// 256 MB. A client packet fits. A file this large is not a form Quill should hold in memory.
const MAX_PDF_BYTES: usize = 256 * 1024 * 1024;
const NETWORK_SAVE: &str =
    "Quill will not save onto a network path. Choose a folder on this computer.";

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
    let meta =
        fs::metadata(&path).map_err(|err| format!("Couldn't read {}: {err}", path.display()))?;
    if meta.len() == 0 {
        return Err("Quill couldn't read this PDF.".into());
    }
    if meta.len() > MAX_PDF_BYTES as u64 {
        return Err(too_big_message());
    }
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

/// The page sends the bytes and a suggested name. It does not send a path.
/// The save dialog runs here, and the write uses only the folder the user picked.
#[tauri::command]
async fn save_pdf_copy(
    app: AppHandle,
    filename: String,
    base64: String,
) -> Result<Option<String>, String> {
    let bytes = decode_pdf_bytes(&base64)?;
    let suggested = suggested_pdf_name(&filename);
    // Async commands are not on the window thread, so the blocking dialog is the one that won't deadlock.
    let picked = app
        .dialog()
        .file()
        .add_filter("PDF", &["pdf"])
        .set_file_name(&suggested)
        .set_title("Save a copy")
        .blocking_save_file();
    let Some(picked) = picked else {
        return Ok(None);
    };
    let path = picked
        .into_path()
        .map_err(|_| "Choose a folder on this computer.".to_string())?;
    let destination = local_pdf_destination(&path)?;
    fs::write(&destination, &bytes).map_err(|err| format!("Couldn't save the PDF: {err}"))?;
    Ok(Some(destination.display().to_string()))
}

fn decode_pdf_bytes(base64_text: &str) -> Result<Vec<u8>, String> {
    let trimmed = base64_text.trim();
    check_encoded_len(trimmed.len())?;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(trimmed)
        .map_err(|_| "Couldn't read the PDF bytes.".to_string())?;
    if bytes.len() > MAX_PDF_BYTES {
        return Err(too_big_message());
    }
    if bytes.is_empty() {
        return Err("Quill couldn't read this PDF.".into());
    }
    let window = bytes.len().min(1024);
    if !bytes[..window].windows(5).any(|slice| slice == b"%PDF-") {
        return Err("Quill couldn't read this PDF.".into());
    }
    Ok(bytes)
}

fn check_encoded_len(len: usize) -> Result<(), String> {
    if len > max_base64_chars() {
        Err(too_big_message())
    } else {
        Ok(())
    }
}

fn max_base64_chars() -> usize {
    MAX_PDF_BYTES / 3 * 4 + 8
}

fn too_big_message() -> String {
    "This PDF is larger than 256 MB, which is as much as Quill will handle.".to_string()
}

/// A file name for the dialog. Never a directory, and never a Windows device name.
fn suggested_pdf_name(filename: &str) -> String {
    let raw = filename.split(['/', '\\']).next_back().unwrap_or("").trim();
    let cleaned: String = raw
        .chars()
        .filter(|ch| !ch.is_control() && !matches!(*ch, '<' | '>' | ':' | '"' | '|' | '?' | '*'))
        .collect();
    let cleaned = cleaned.trim().trim_end_matches(['.', ' ']);
    let cleaned = if cleaned.is_empty() || cleaned == "." || cleaned == ".." {
        "document"
    } else {
        cleaned
    };
    let with_ext = if cleaned.to_ascii_lowercase().ends_with(".pdf") {
        cleaned.to_string()
    } else {
        format!("{cleaned}.pdf")
    };
    if is_reserved_windows_name(&with_ext) {
        format!("document-{with_ext}")
    } else {
        with_ext
    }
}

fn local_pdf_destination(path: &Path) -> Result<PathBuf, String> {
    if is_network_or_device_path(&path.to_string_lossy()) {
        return Err(NETWORK_SAVE.into());
    }
    if !path.is_absolute()
        || path
            .components()
            .any(|component| matches!(component, Component::ParentDir))
    {
        return Err("Choose a folder on this computer.".into());
    }
    let name = pdf_file_name(path)?;
    let parent = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .ok_or_else(|| "Choose a folder on this computer.".to_string())?;
    if !parent.is_dir() {
        return Err("Choose a folder on this computer.".into());
    }
    let folder = parent
        .canonicalize()
        .map_err(|_| "Choose a folder on this computer.".to_string())?;
    if !folder_is_local(&folder) {
        return Err(NETWORK_SAVE.into());
    }
    let destination = folder.join(name);
    if destination.file_name() != Some(name) || !destination.starts_with(&folder) {
        return Err("Choose a folder on this computer.".into());
    }
    match destination.symlink_metadata() {
        Ok(meta) if meta.file_type().is_symlink() => {
            return Err("Quill won't replace a shortcut. Choose the PDF itself.".into());
        }
        Ok(meta) if !meta.is_file() => return Err("Choose a PDF file name.".into()),
        _ => {}
    }
    Ok(destination)
}

fn pdf_file_name(path: &Path) -> Result<&std::ffi::OsStr, String> {
    let name = path
        .file_name()
        .ok_or_else(|| "Choose a PDF file name.".to_string())?;
    let text = name
        .to_str()
        .ok_or_else(|| "Choose a PDF file name.".to_string())?;
    if text.contains(':') || text.ends_with('.') || text.ends_with(' ') {
        return Err("Choose a PDF file name.".into());
    }
    if text.eq_ignore_ascii_case(".pdf") || !text.to_ascii_lowercase().ends_with(".pdf") {
        return Err("Quill only saves PDF files.".into());
    }
    if is_reserved_windows_name(text) {
        return Err("Choose a different PDF file name.".into());
    }
    Ok(name)
}

fn is_reserved_windows_name(name: &str) -> bool {
    let stem = name.rsplit_once('.').map(|(stem, _)| stem).unwrap_or(name);
    matches!(
        stem.to_ascii_lowercase().as_str(),
        "con"
            | "prn"
            | "aux"
            | "nul"
            | "com1"
            | "com2"
            | "com3"
            | "com4"
            | "com5"
            | "com6"
            | "com7"
            | "com8"
            | "com9"
            | "lpt1"
            | "lpt2"
            | "lpt3"
            | "lpt4"
            | "lpt5"
            | "lpt6"
            | "lpt7"
            | "lpt8"
            | "lpt9"
    )
}

/// UNC shares, device paths, and the `\\?\UNC` form. A verbatim `\\?\C:\` path is local.
fn is_network_or_device_path(text: &str) -> bool {
    let unified: String = text
        .trim()
        .chars()
        .map(|ch| if ch == '/' { '\\' } else { ch })
        .collect();
    let lower = unified.to_ascii_lowercase();
    if lower.starts_with(r"\\?\unc\") {
        return true;
    }
    if let Some(rest) = unified.get(4..).filter(|_| lower.starts_with(r"\\?\")) {
        return !is_verbatim_disk(rest);
    }
    unified.starts_with(r"\\")
}

fn is_verbatim_disk(rest: &str) -> bool {
    let mut chars = rest.chars();
    let Some(letter) = chars.next() else {
        return false;
    };
    letter.is_ascii_alphabetic() && chars.next() == Some(':') && chars.next() == Some('\\')
}

fn folder_is_local(path: &Path) -> bool {
    if is_network_or_device_path(&path.to_string_lossy()) {
        return false;
    }
    #[cfg(windows)]
    {
        return windows_drive_is_local(path);
    }
    #[cfg(not(windows))]
    {
        path.is_absolute()
    }
}

#[cfg(windows)]
fn windows_drive_is_local(path: &Path) -> bool {
    let Some(letter) = drive_letter(path) else {
        return false;
    };
    let root = [u16::from(letter), u16::from(b':'), u16::from(b'\\'), 0];
    unsafe { matches!(GetDriveTypeW(root.as_ptr()), 2 | 3 | 6) }
}

#[cfg(windows)]
fn drive_letter(path: &Path) -> Option<u8> {
    let text = path.to_string_lossy();
    let trimmed = text.trim();
    let without = trimmed.strip_prefix(r"\\?\").unwrap_or(trimmed);
    let mut chars = without.chars();
    let letter = chars.next()?;
    if !letter.is_ascii_alphabetic() || chars.next() != Some(':') {
        return None;
    }
    Some(letter.to_ascii_uppercase() as u8)
}

#[cfg(windows)]
#[link(name = "kernel32")]
extern "system" {
    fn GetDriveTypeW(lp_root_path_name: *const u16) -> u32;
}

#[derive(serde::Deserialize)]
struct LockedField {
    name: String,
    kind: String,
    value: String,
}

#[tauri::command]
fn fill_locked_form(
    app: AppHandle,
    base64: String,
    fields: Vec<LockedField>,
) -> Result<String, String> {
    let bytes = decode_pdf_bytes(&base64)?;
    let library = pdfium_library(&app)?;
    let writes: Vec<pdfium_fill::FieldWrite> = fields
        .iter()
        .map(|field| pdfium_fill::FieldWrite {
            name: field.name.as_str(),
            kind: field.kind.as_str(),
            value: field.value.as_str(),
        })
        .collect();
    let saved = pdfium_fill::fill_locked_form(&library, &bytes, &writes)?;
    Ok(base64::engine::general_purpose::STANDARD.encode(saved))
}

#[tauri::command]
fn release_locked_form(
    app: AppHandle,
    base64: String,
    fields: Vec<LockedField>,
    flatten: bool,
) -> Result<String, String> {
    let bytes = decode_pdf_bytes(&base64)?;
    let library = pdfium_library(&app)?;
    let writes: Vec<pdfium_fill::FieldWrite> = fields
        .iter()
        .map(|field| pdfium_fill::FieldWrite {
            name: field.name.as_str(),
            kind: field.kind.as_str(),
            value: field.value.as_str(),
        })
        .collect();
    let saved = pdfium_fill::release_locked_form(&library, &bytes, &writes, flatten)?;
    Ok(base64::engine::general_purpose::STANDARD.encode(saved))
}

fn pdfium_library(app: &AppHandle) -> Result<PathBuf, String> {
    let file_name = if cfg!(windows) {
        "pdfium.dll"
    } else if cfg!(target_os = "macos") {
        "libpdfium.dylib"
    } else {
        "libpdfium.so"
    };
    let mut candidates = Vec::new();
    if let Ok(dir) = app.path().resource_dir() {
        candidates.push(dir.join(file_name));
        candidates.push(dir.join("resources").join(file_name));
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            candidates.push(parent.join(file_name));
            candidates.push(parent.join("resources").join(file_name));
        }
    }
    candidates
        .into_iter()
        .find(|path| path.is_file())
        .ok_or_else(|| {
            "Quill couldn't find its PDF library, so this locked form can't be kept editable."
                .to_string()
        })
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
            save_pdf_copy,
            fill_locked_form,
            release_locked_form,
            open_default_apps
        ])
        .run(tauri::generate_context!())
        .expect("error while running Quill");
}

#[cfg(test)]
mod tests {
    use super::{
        check_encoded_len, decode_pdf_bytes, is_network_or_device_path, local_pdf_destination,
        max_base64_chars, pdf_from_arg, suggested_pdf_name, MAX_PDF_BYTES,
    };
    use base64::Engine;
    use std::path::Path;

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

    #[test]
    fn rejects_network_and_device_paths() {
        assert!(is_network_or_device_path(r"\\server\share\a.pdf"));
        assert!(is_network_or_device_path("//server/share/a.pdf"));
        assert!(is_network_or_device_path(r"\\?\UNC\server\share\a.pdf"));
        assert!(is_network_or_device_path(r"\\.\pipe\evil"));
        assert!(!is_network_or_device_path(r"C:\Users\Mike\a.pdf"));
        assert!(!is_network_or_device_path(r"\\?\C:\Users\Mike\a.pdf"));
    }

    #[test]
    fn suggested_name_is_only_a_file_name() {
        assert_eq!(suggested_pdf_name(r"C:\Users\Mike\notes"), "notes.pdf");
        assert_eq!(suggested_pdf_name("../secret.pdf"), "secret.pdf");
        assert_eq!(suggested_pdf_name("report.PDF"), "report.PDF");
        assert_eq!(suggested_pdf_name(""), "document.pdf");
        assert_eq!(suggested_pdf_name("nul"), "document-nul.pdf");
    }

    #[test]
    fn the_size_cap_is_256_megabytes() {
        assert_eq!(MAX_PDF_BYTES, 256 * 1024 * 1024);
        assert!(check_encoded_len(max_base64_chars()).is_ok());
        let message = check_encoded_len(max_base64_chars() + 1).unwrap_err();
        assert!(message.contains("256 MB"));
    }

    #[test]
    fn decodes_a_small_pdf_and_rejects_other_bytes() {
        let encoded = base64::engine::general_purpose::STANDARD.encode(b"%PDF-1.7\n");
        let bytes = decode_pdf_bytes(&encoded).expect("pdf");
        assert!(bytes.starts_with(b"%PDF-"));
        assert!(decode_pdf_bytes("").is_err());
        assert!(
            decode_pdf_bytes(&base64::engine::general_purpose::STANDARD.encode(b"hello")).is_err()
        );
    }

    #[test]
    fn accepts_a_new_pdf_in_a_local_folder_and_refuses_a_relative_path() {
        let folder = std::env::temp_dir();
        let path = folder.join("quill-save-check.pdf");
        let dest = local_pdf_destination(&path).expect("local folder");
        assert_eq!(
            dest.file_name().and_then(|name| name.to_str()),
            Some("quill-save-check.pdf")
        );
        assert!(local_pdf_destination(Path::new("quill-save-check.pdf")).is_err());
        assert!(local_pdf_destination(Path::new(r"\\server\share\a.pdf")).is_err());
        assert!(local_pdf_destination(&folder.join("..").join("a.pdf")).is_err());
        assert!(local_pdf_destination(&folder.join("notes.txt")).is_err());
        assert!(local_pdf_destination(&folder.join("nul.pdf")).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn refuses_to_replace_a_symlink() {
        let folder = std::env::temp_dir();
        let target = folder.join("quill-save-target.pdf");
        let link = folder.join("quill-save-link.pdf");
        std::fs::write(&target, b"%PDF-1.4\n").expect("target");
        let _ = std::fs::remove_file(&link);
        std::os::unix::fs::symlink(&target, &link).expect("link");
        let message = local_pdf_destination(&link).expect_err("symlink");
        assert!(message.contains("shortcut"));
        let _ = std::fs::remove_file(&link);
        let _ = std::fs::remove_file(&target);
    }
}
