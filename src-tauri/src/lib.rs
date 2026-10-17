use notes_core::{Folder, Note, NoteSummary, Scope, Store, Tag};
use std::sync::Mutex;
use tauri::{Manager, State};

struct Db(Mutex<Store>);

type CmdResult<T> = Result<T, String>;

fn with<T>(db: &State<Db>, f: impl FnOnce(&Store) -> notes_core::Result<T>) -> CmdResult<T> {
    let store = db.0.lock().map_err(|_| "database lock poisoned".to_string())?;
    f(&store).map_err(|e| e.to_string())
}

#[tauri::command]
fn list_folders(db: State<Db>) -> CmdResult<Vec<Folder>> {
    with(&db, |s| s.list_folders())
}

#[tauri::command]
fn create_folder(db: State<Db>, name: String, parent_id: Option<String>) -> CmdResult<Folder> {
    with(&db, |s| s.create_folder(&name, parent_id.as_deref()))
}

#[tauri::command]
fn rename_folder(db: State<Db>, id: String, name: String) -> CmdResult<()> {
    with(&db, |s| s.rename_folder(&id, &name))
}

#[tauri::command]
fn delete_folder(db: State<Db>, id: String) -> CmdResult<()> {
    with(&db, |s| s.delete_folder(&id))
}

#[tauri::command]
fn list_notes(db: State<Db>, scope: Scope) -> CmdResult<Vec<NoteSummary>> {
    with(&db, |s| s.list_notes(&scope))
}

#[tauri::command]
fn search(db: State<Db>, query: String) -> CmdResult<Vec<NoteSummary>> {
    with(&db, |s| s.search(&query))
}

#[tauri::command]
fn get_note(db: State<Db>, id: String) -> CmdResult<Note> {
    with(&db, |s| s.get_note(&id))
}

#[tauri::command]
fn create_note(db: State<Db>, folder_id: String) -> CmdResult<Note> {
    with(&db, |s| s.create_note(&folder_id))
}

#[tauri::command]
fn update_note(db: State<Db>, id: String, body: String, plaintext: String) -> CmdResult<NoteSummary> {
    with(&db, |s| s.update_note(&id, &body, &plaintext))
}

#[tauri::command]
fn set_pinned(db: State<Db>, id: String, pinned: bool) -> CmdResult<()> {
    with(&db, |s| s.set_pinned(&id, pinned))
}

#[tauri::command]
fn move_note(db: State<Db>, id: String, folder_id: String) -> CmdResult<()> {
    with(&db, |s| s.move_note(&id, &folder_id))
}

#[tauri::command]
fn trash_note(db: State<Db>, id: String) -> CmdResult<()> {
    with(&db, |s| s.trash_note(&id))
}

#[tauri::command]
fn restore_note(db: State<Db>, id: String) -> CmdResult<()> {
    with(&db, |s| s.restore_note(&id))
}

#[tauri::command]
fn purge_note(db: State<Db>, id: String) -> CmdResult<()> {
    with(&db, |s| s.purge_note(&id))
}

#[tauri::command]
fn empty_trash(db: State<Db>) -> CmdResult<usize> {
    with(&db, |s| s.empty_trash())
}

#[tauri::command]
fn list_tags(db: State<Db>) -> CmdResult<Vec<Tag>> {
    with(&db, |s| s.list_tags())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&dir)?;
            let store = Store::open(dir.join("margin.db"))?;
            app.manage(Db(Mutex::new(store)));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_folders,
            create_folder,
            rename_folder,
            delete_folder,
            list_notes,
            search,
            get_note,
            create_note,
            update_note,
            set_pinned,
            move_note,
            trash_note,
            restore_note,
            purge_note,
            empty_trash,
            list_tags
        ])
        .run(tauri::generate_context!())
        .expect("error while running Margin");
}
