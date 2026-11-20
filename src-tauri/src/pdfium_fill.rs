//! Write existing AcroForm values the way Edge does: the form filler, not a raw /V.
//! A normal save uses flags 0, so an owner lock is kept and the fields stay editable.
//! Releasing the lock saves with FPDF_REMOVE_SECURITY (3). Flattening paints the fields
//! onto the pages first, then removes the lock.

use std::io::{self, Write};
use std::os::raw::{c_int, c_ulong, c_void};
use std::path::Path;
use std::ptr;
use std::sync::Mutex;

use pdfium_render::prelude::*;

const FORMFIELD_TEXT: c_int = 6;
const FORMFIELD_CHECKBOX: c_int = 2;
const ANNOT_WIDGET: i32 = 20;
/// pdfium public/fpdf_flatten.h. 0 is normal display, not print.
const FLAT_NORMALDISPLAY: c_int = 0;
const FLATTEN_FAIL: c_int = 0;

#[derive(Clone, Copy)]
enum SaveMode {
    Keep,
    Unlock,
    Flatten,
}

pub struct FieldWrite<'a> {
    pub name: &'a str,
    pub kind: &'a str,
    pub value: &'a str,
}

static PDFIUM: Mutex<Option<Pdfium>> = Mutex::new(None);

pub fn fill_locked_form(library: &Path, bytes: &[u8], fields: &[FieldWrite<'_>]) -> Result<Vec<u8>, String> {
    run_pdfium(library, bytes, |bindings| unsafe {
        fill_with(bindings, bytes, fields, SaveMode::Keep)
    })
}

/// Save a copy that is no longer owner-locked. `flatten` paints the fields onto the pages first.
pub fn release_locked_form(
    library: &Path,
    bytes: &[u8],
    fields: &[FieldWrite<'_>],
    flatten: bool,
) -> Result<Vec<u8>, String> {
    let mode = if flatten { SaveMode::Flatten } else { SaveMode::Unlock };
    run_pdfium(library, bytes, |bindings| unsafe { fill_with(bindings, bytes, fields, mode) })
}

fn run_pdfium<T>(
    library: &Path,
    bytes: &[u8],
    run: impl FnOnce(&dyn PdfiumLibraryBindings) -> Result<T, String>,
) -> Result<T, String> {
    if bytes.is_empty() {
        return Err("Quill couldn't read this PDF.".into());
    }
    let mut slot = PDFIUM
        .lock()
        .map_err(|_| "Quill couldn't use its PDF library.".to_string())?;
    if slot.is_none() {
        let bindings = Pdfium::bind_to_library(library).map_err(|err| library_error(&err))?;
        *slot = Some(Pdfium::new(bindings));
    }
    let pdfium = slot.as_ref().expect("pdfium");
    // The lock is held for the whole call. PDFium is not re-entrant between calls.
    run(pdfium.bindings())
}

fn library_error(err: &PdfiumError) -> String {
    match err {
        PdfiumError::PdfiumLibraryBindingsAlreadyInitialized => {
            "Quill's PDF library was already loaded.".into()
        }
        PdfiumError::LoadLibraryError(_) => "Quill couldn't load its PDF library.".into(),
        other => format!("Quill couldn't load its PDF library ({other})."),
    }
}

unsafe fn fill_with(
    bindings: &dyn PdfiumLibraryBindings,
    bytes: &[u8],
    fields: &[FieldWrite<'_>],
    mode: SaveMode,
) -> Result<Vec<u8>, String> {
    let document = bindings.FPDF_LoadMemDocument64(bytes, Some(""));
    if document.is_null() {
        let code = bindings.FPDF_GetLastError() as u64;
        if code == 4 {
            return Err("This PDF needs a password to open. Quill doesn't open those files.".into());
        }
        return Err(format!("Quill couldn't open this locked PDF (PDFium {code})."));
    }

    let mut form_info = Box::pin(FPDF_FORMFILLINFO {
        // Version 2 matches the pdfium_8125 bindings. Newer DLLs still honor it.
        version: 2,
        Release: None,
        FFI_Invalidate: None,
        FFI_OutputSelectedRect: None,
        FFI_SetCursor: None,
        FFI_SetTimer: None,
        FFI_KillTimer: None,
        FFI_GetLocalTime: None,
        FFI_OnChange: None,
        FFI_GetPage: None,
        FFI_GetCurrentPage: None,
        FFI_GetRotation: None,
        FFI_ExecuteNamedAction: None,
        FFI_SetTextFieldFocus: None,
        FFI_DoURIAction: None,
        FFI_DoGoToAction: None,
        m_pJsPlatform: ptr::null_mut(),
        // XFA is a second form parser. Quill fills AcroForm fields, so it stays off.
        xfa_disabled: 1,
        FFI_DisplayCaret: None,
        FFI_GetCurrentPageIndex: None,
        FFI_SetCurrentPage: None,
        FFI_GotoURL: None,
        FFI_GetPageViewRect: None,
        FFI_PageEvent: None,
        FFI_PopupMenu: None,
        FFI_OpenFile: None,
        FFI_EmailTo: None,
        FFI_UploadTo: None,
        FFI_GetPlatform: None,
        FFI_GetLanguage: None,
        FFI_DownloadFromURL: None,
        FFI_PostRequestURL: None,
        FFI_PutRequestURL: None,
        FFI_OnFocusChange: None,
        FFI_DoURIActionWithKeyboardModifier: None,
    });

    let form = bindings.FPDFDOC_InitFormFillEnvironment(document, form_info.as_mut().get_unchecked_mut());
    if form.is_null() {
        bindings.FPDF_CloseDocument(document);
        return Err("Quill couldn't read the form in this PDF.".into());
    }

    let result = fill_document(bindings, document, form, fields, mode);
    bindings.FPDFDOC_ExitFormFillEnvironment(form);
    bindings.FPDF_CloseDocument(document);
    // Keep the form-fill struct alive until Exit returns.
    drop(form_info);
    result
}

unsafe fn fill_document(
    bindings: &dyn PdfiumLibraryBindings,
    document: FPDF_DOCUMENT,
    form: FPDF_FORMHANDLE,
    fields: &[FieldWrite<'_>],
    mode: SaveMode,
) -> Result<Vec<u8>, String> {
    let page_count = bindings.FPDF_GetPageCount(document);
    if page_count < 1 {
        return Err("Quill couldn't read the pages in this PDF.".into());
    }

    let mut pages = Vec::with_capacity(page_count as usize);
    for index in 0..page_count {
        let page = bindings.FPDF_LoadPage(document, index);
        if page.is_null() {
            close_pages(bindings, form, &pages);
            return Err("Quill couldn't read a page in this PDF.".into());
        }
        bindings.FORM_OnAfterLoadPage(page, form);
        pages.push(page);
    }

    let mut written = 0usize;
    let mut text_done = Vec::<String>::new();
    let mut box_done = Vec::<String>::new();
    for field in fields {
        if field.name.is_empty() {
            continue;
        }
        let matched = match field.kind {
            "checkbox" => {
                if box_done.iter().any(|name| name == field.name) {
                    true
                } else if write_checkbox(bindings, form, &pages, field.name, wants_checked(field.value)) {
                    box_done.push(field.name.to_string());
                    true
                } else {
                    false
                }
            }
            _ => {
                if text_done.iter().any(|name| name == field.name) {
                    true
                } else if write_text(bindings, form, &pages, field.name, field.value) {
                    text_done.push(field.name.to_string());
                    true
                } else {
                    false
                }
            }
        };
        if matched {
            written += 1;
        }
    }

    let saved = (|| {
        if !fields.is_empty() && written == 0 {
            return Err("Quill couldn't find those fields in this PDF.".into());
        }
        if matches!(mode, SaveMode::Flatten) {
            for page in &pages {
                if bindings.FPDFPage_Flatten(*page, FLAT_NORMALDISPLAY) == FLATTEN_FAIL {
                    return Err("Quill couldn't flatten this PDF.".into());
                }
            }
        }
        save_copy(bindings, document, !matches!(mode, SaveMode::Keep))
    })();
    close_pages(bindings, form, &pages);
    saved
}

fn wants_checked(value: &str) -> bool {
    let trimmed = value.trim();
    !trimmed.is_empty() && !trimmed.eq_ignore_ascii_case("off") && trimmed != "0"
}

unsafe fn write_text(
    bindings: &dyn PdfiumLibraryBindings,
    form: FPDF_FORMHANDLE,
    pages: &[FPDF_PAGE],
    name: &str,
    value: &str,
) -> bool {
    let Some((page, annot)) = find_widget(bindings, form, pages, name, Some(FORMFIELD_TEXT)) else {
        return false;
    };
    let focused = bindings.FORM_SetFocusedAnnot(form, annot);
    bindings.FPDFPage_CloseAnnot(annot);
    if !bindings.is_true(focused) {
        return false;
    }
    let _ = bindings.FORM_SelectAllText(form, page);
    let wide = wide_string(value);
    bindings.FORM_ReplaceSelection(form, page, wide.as_ptr() as FPDF_WIDESTRING);
    let _ = bindings.FORM_ForceToKillFocus(form);
    true
}

unsafe fn write_checkbox(
    bindings: &dyn PdfiumLibraryBindings,
    form: FPDF_FORMHANDLE,
    pages: &[FPDF_PAGE],
    name: &str,
    checked: bool,
) -> bool {
    let Some((page, annot)) = find_widget(bindings, form, pages, name, Some(FORMFIELD_CHECKBOX)) else {
        return false;
    };
    let already = bindings.is_true(bindings.FPDFAnnot_IsChecked(form, annot));
    if already == checked {
        bindings.FPDFPage_CloseAnnot(annot);
        return true;
    }
    let mut rect = FS_RECTF {
        left: 0.0,
        top: 0.0,
        right: 0.0,
        bottom: 0.0,
    };
    let has_rect = bindings.is_true(bindings.FPDFAnnot_GetRect(annot, &mut rect));
    bindings.FPDFPage_CloseAnnot(annot);
    if !has_rect {
        return false;
    }
    let x = f64::from(rect.left + rect.right) / 2.0;
    let y = f64::from(rect.top + rect.bottom) / 2.0;
    let _ = bindings.FORM_OnLButtonDown(form, page, 0, x, y);
    let _ = bindings.FORM_OnLButtonUp(form, page, 0, x, y);
    let _ = bindings.FORM_ForceToKillFocus(form);
    true
}

unsafe fn find_widget(
    bindings: &dyn PdfiumLibraryBindings,
    form: FPDF_FORMHANDLE,
    pages: &[FPDF_PAGE],
    name: &str,
    field_type: Option<c_int>,
) -> Option<(FPDF_PAGE, FPDF_ANNOTATION)> {
    for page in pages {
        let count = bindings.FPDFPage_GetAnnotCount(*page);
        for index in 0..count {
            let annot = bindings.FPDFPage_GetAnnot(*page, index);
            if annot.is_null() {
                continue;
            }
            if bindings.FPDFAnnot_GetSubtype(annot) != ANNOT_WIDGET {
                bindings.FPDFPage_CloseAnnot(annot);
                continue;
            }
            if let Some(expected) = field_type {
                let actual = bindings.FPDFAnnot_GetFormFieldType(form, annot);
                if actual != expected && actual >= 0 {
                    bindings.FPDFPage_CloseAnnot(annot);
                    continue;
                }
            }
            let found = read_wide(|buffer, len| bindings.FPDFAnnot_GetFormFieldName(form, annot, buffer, len));
            if found == name {
                return Some((*page, annot));
            }
            bindings.FPDFPage_CloseAnnot(annot);
        }
    }
    None
}

unsafe fn read_wide(mut load: impl FnMut(*mut FPDF_WCHAR, c_ulong) -> c_ulong) -> String {
    let length = load(ptr::null_mut(), 0);
    if length <= 2 {
        return String::new();
    }
    let mut buffer = vec![0u8; length as usize];
    let written = load(buffer.as_mut_ptr() as *mut FPDF_WCHAR, length);
    if written == 0 {
        return String::new();
    }
    let units: Vec<u16> = buffer
        .chunks_exact(2)
        .map(|pair| u16::from_le_bytes([pair[0], pair[1]]))
        .take_while(|unit| *unit != 0)
        .collect();
    String::from_utf16_lossy(&units)
}

unsafe fn close_pages(bindings: &dyn PdfiumLibraryBindings, form: FPDF_FORMHANDLE, pages: &[FPDF_PAGE]) {
    for page in pages.iter().rev() {
        bindings.FORM_OnBeforeClosePage(*page, form);
        bindings.FPDF_ClosePage(*page);
    }
}

unsafe fn save_copy(
    bindings: &dyn PdfiumLibraryBindings,
    document: FPDF_DOCUMENT,
    remove_security: bool,
) -> Result<Vec<u8>, String> {
    let mut cursor = io::Cursor::new(Vec::new());
    let mut writer = FileWriter {
        version: 1,
        write_block: Some(write_block),
        output: &mut cursor,
    };
    // 3 is FPDF_REMOVE_SECURITY. 0 keeps the owner lock.
    let flags = if remove_security { 3 } else { 0 };
    let ok = bindings.FPDF_SaveAsCopy(document, writer.as_file_write(), flags);
    if !bindings.is_true(ok) {
        let code = bindings.FPDF_GetLastError() as u64;
        let detail = if code == 0 { String::new() } else { format!(" ({code})") };
        return Err(format!("Quill couldn't save this locked PDF{detail}."));
    }
    cursor
        .flush()
        .map_err(|err| format!("Quill couldn't save this locked PDF ({err})."))?;
    let bytes = cursor.into_inner();
    if bytes.len() < 8 || &bytes[..4] != b"%PDF" {
        return Err("Quill couldn't save this locked PDF.".into());
    }
    Ok(bytes)
}

fn wide_string(text: &str) -> Vec<u16> {
    text.encode_utf16().chain(std::iter::once(0)).collect()
}

#[repr(C)]
struct FileWriter<'a> {
    version: c_int,
    write_block: Option<unsafe extern "C" fn(*mut FileWriter, *const c_void, c_ulong) -> c_int>,
    output: &'a mut io::Cursor<Vec<u8>>,
}

impl<'a> FileWriter<'a> {
    fn as_file_write(&mut self) -> *mut FPDF_FILEWRITE {
        self as *mut FileWriter as *mut FPDF_FILEWRITE
    }
}

unsafe extern "C" fn write_block(writer: *mut FileWriter, data: *const c_void, size: c_ulong) -> c_int {
    if writer.is_null() || data.is_null() {
        return 0;
    }
    let slice = std::slice::from_raw_parts(data as *const u8, size as usize);
    match (*writer).output.write_all(slice) {
        Ok(()) => 1,
        Err(_) => 0,
    }
}
