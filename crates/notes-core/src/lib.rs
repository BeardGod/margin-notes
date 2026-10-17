//! Storage for Margin: folders, notes, tags, search and Recently Deleted,
//! backed by a single SQLite file.

use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

pub const DEFAULT_FOLDER_ID: &str = "notes";
/// Notes in Recently Deleted are removed for good after this many days.
pub const TRASH_RETENTION_DAYS: i64 = 30;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("database error: {0}")]
    Db(#[from] rusqlite::Error),
    #[error("not found: {0}")]
    NotFound(String),
    #[error("{0}")]
    Invalid(String),
}

pub type Result<T> = std::result::Result<T, Error>;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Folder {
    pub id: String,
    pub name: String,
    pub parent_id: Option<String>,
    pub note_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct NoteSummary {
    pub id: String,
    pub folder_id: String,
    pub title: String,
    pub snippet: String,
    pub created: i64,
    pub modified: i64,
    pub pinned: bool,
    pub deleted_at: Option<i64>,
    pub has_checklist: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Note {
    #[serde(flatten)]
    pub summary: NoteSummary,
    pub body: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Tag {
    pub name: String,
    pub count: i64,
}

/// Which notes a list shows.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "kind", content = "value", rename_all = "snake_case")]
pub enum Scope {
    All,
    Folder(String),
    Tag(String),
    Trash,
}

pub struct Store {
    conn: Connection,
}

const SUMMARY_COLS: &str =
    "id, folder_id, title, snippet, created, modified, pinned, deleted_at, has_checklist";

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn new_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

fn summary_from_row(r: &Row) -> rusqlite::Result<NoteSummary> {
    Ok(NoteSummary {
        id: r.get(0)?,
        folder_id: r.get(1)?,
        title: r.get(2)?,
        snippet: r.get(3)?,
        created: r.get(4)?,
        modified: r.get(5)?,
        pinned: r.get::<_, i64>(6)? != 0,
        deleted_at: r.get(7)?,
        has_checklist: r.get::<_, i64>(8)? != 0,
    })
}

/// Title is the first non-empty line; the snippet is the text after it.
pub fn title_and_snippet(plaintext: &str) -> (String, String) {
    let mut lines = plaintext.lines().map(str::trim).filter(|l| !l.is_empty());
    let title = lines.next().unwrap_or("").chars().take(200).collect();
    let snippet: String = lines.collect::<Vec<_>>().join(" ");
    (title, snippet.chars().take(200).collect())
}

/// `#tags` in the text: letters, digits, `_` and `-`, not starting a URL
/// fragment. Returned lowercased, deduplicated, in first-seen order.
pub fn extract_tags(plaintext: &str) -> Vec<String> {
    let mut tags: Vec<String> = Vec::new();
    let chars: Vec<char> = plaintext.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        let boundary = i == 0 || chars[i - 1].is_whitespace();
        if chars[i] == '#' && boundary {
            let start = i + 1;
            let mut end = start;
            while end < chars.len()
                && (chars[end].is_alphanumeric() || chars[end] == '_' || chars[end] == '-')
            {
                end += 1;
            }
            let tag: String = chars[start..end].iter().collect::<String>().to_lowercase();
            if !tag.is_empty() && tag.chars().any(|c| c.is_alphabetic()) && !tags.contains(&tag) {
                tags.push(tag);
            }
            i = end;
        } else {
            i += 1;
        }
    }
    tags
}

/// Turns free text into an FTS5 prefix query: `foo ba` -> `"foo"* "ba"*`.
fn fts_query(q: &str) -> Option<String> {
    let terms: Vec<String> = q
        .split_whitespace()
        .map(|t| t.replace('"', ""))
        .filter(|t| !t.is_empty())
        .map(|t| format!("\"{t}\"*"))
        .collect();
    (!terms.is_empty()).then(|| terms.join(" "))
}

impl Store {
    pub fn open(path: impl AsRef<Path>) -> Result<Self> {
        Self::init(Connection::open(path)?)
    }

    pub fn open_in_memory() -> Result<Self> {
        Self::init(Connection::open_in_memory()?)
    }

    fn init(conn: Connection) -> Result<Self> {
        conn.execute_batch(
            "PRAGMA journal_mode = WAL;
             PRAGMA foreign_keys = ON;
             CREATE TABLE IF NOT EXISTS folders (
                 id TEXT PRIMARY KEY,
                 name TEXT NOT NULL,
                 parent_id TEXT REFERENCES folders(id) ON DELETE CASCADE,
                 created INTEGER NOT NULL
             );
             CREATE TABLE IF NOT EXISTS notes (
                 id TEXT PRIMARY KEY,
                 folder_id TEXT NOT NULL,
                 title TEXT NOT NULL DEFAULT '',
                 snippet TEXT NOT NULL DEFAULT '',
                 body TEXT NOT NULL DEFAULT '',
                 plaintext TEXT NOT NULL DEFAULT '',
                 created INTEGER NOT NULL,
                 modified INTEGER NOT NULL,
                 pinned INTEGER NOT NULL DEFAULT 0,
                 deleted_at INTEGER,
                 has_checklist INTEGER NOT NULL DEFAULT 0
             );
             CREATE TABLE IF NOT EXISTS note_tags (
                 note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
                 tag TEXT NOT NULL,
                 PRIMARY KEY (note_id, tag)
             );
             CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
                 title, plaintext, content='notes', content_rowid='rowid'
             );
             CREATE TRIGGER IF NOT EXISTS notes_ai AFTER INSERT ON notes BEGIN
                 INSERT INTO notes_fts(rowid, title, plaintext)
                 VALUES (new.rowid, new.title, new.plaintext);
             END;
             CREATE TRIGGER IF NOT EXISTS notes_ad AFTER DELETE ON notes BEGIN
                 INSERT INTO notes_fts(notes_fts, rowid, title, plaintext)
                 VALUES ('delete', old.rowid, old.title, old.plaintext);
             END;
             CREATE TRIGGER IF NOT EXISTS notes_au AFTER UPDATE OF title, plaintext ON notes BEGIN
                 INSERT INTO notes_fts(notes_fts, rowid, title, plaintext)
                 VALUES ('delete', old.rowid, old.title, old.plaintext);
                 INSERT INTO notes_fts(rowid, title, plaintext)
                 VALUES (new.rowid, new.title, new.plaintext);
             END;",
        )?;
        conn.execute(
            "INSERT OR IGNORE INTO folders (id, name, parent_id, created) VALUES (?1, 'Notes', NULL, ?2)",
            params![DEFAULT_FOLDER_ID, now_ms()],
        )?;
        let store = Store { conn };
        store.purge_expired(now_ms())?;
        Ok(store)
    }

    // ---- folders ----

    pub fn list_folders(&self) -> Result<Vec<Folder>> {
        let mut st = self.conn.prepare(
            "SELECT f.id, f.name, f.parent_id,
                    (SELECT COUNT(*) FROM notes n WHERE n.folder_id = f.id AND n.deleted_at IS NULL)
             FROM folders f
             ORDER BY f.id <> ?1, f.name COLLATE NOCASE",
        )?;
        let rows = st.query_map([DEFAULT_FOLDER_ID], |r| {
            Ok(Folder { id: r.get(0)?, name: r.get(1)?, parent_id: r.get(2)?, note_count: r.get(3)? })
        })?;
        Ok(rows.collect::<rusqlite::Result<_>>()?)
    }

    pub fn create_folder(&self, name: &str, parent_id: Option<&str>) -> Result<Folder> {
        let name = self.unique_folder_name(name.trim(), parent_id)?;
        if let Some(p) = parent_id {
            self.require_folder(p)?;
        }
        let id = new_id();
        self.conn.execute(
            "INSERT INTO folders (id, name, parent_id, created) VALUES (?1, ?2, ?3, ?4)",
            params![id, name, parent_id, now_ms()],
        )?;
        Ok(Folder { id, name, parent_id: parent_id.map(str::to_owned), note_count: 0 })
    }

    pub fn rename_folder(&self, id: &str, name: &str) -> Result<()> {
        let name = name.trim();
        if name.is_empty() {
            return Err(Error::Invalid("folder name cannot be empty".into()));
        }
        let n = self.conn.execute("UPDATE folders SET name = ?2 WHERE id = ?1", params![id, name])?;
        if n == 0 {
            return Err(Error::NotFound(id.into()));
        }
        Ok(())
    }

    /// Deletes a folder and its subfolders. Their notes move to Recently Deleted.
    pub fn delete_folder(&self, id: &str) -> Result<()> {
        if id == DEFAULT_FOLDER_ID {
            return Err(Error::Invalid("the Notes folder cannot be deleted".into()));
        }
        self.require_folder(id)?;
        let ids = self.folder_and_descendants(id)?;
        let tx = self.conn.unchecked_transaction()?;
        let now = now_ms();
        for fid in &ids {
            tx.execute(
                "UPDATE notes SET deleted_at = ?2, folder_id = ?3, pinned = 0
                 WHERE folder_id = ?1 AND deleted_at IS NULL",
                params![fid, now, DEFAULT_FOLDER_ID],
            )?;
            // Already-deleted notes keep restoring somewhere that exists.
            tx.execute(
                "UPDATE notes SET folder_id = ?2 WHERE folder_id = ?1",
                params![fid, DEFAULT_FOLDER_ID],
            )?;
        }
        tx.execute("DELETE FROM folders WHERE id = ?1", [id])?;
        tx.commit()?;
        Ok(())
    }

    fn folder_and_descendants(&self, id: &str) -> Result<Vec<String>> {
        let mut st = self.conn.prepare(
            "WITH RECURSIVE sub(id) AS (
                 SELECT ?1 UNION ALL SELECT f.id FROM folders f JOIN sub ON f.parent_id = sub.id
             ) SELECT id FROM sub",
        )?;
        let ids = st.query_map([id], |r| r.get(0))?.collect::<rusqlite::Result<_>>()?;
        Ok(ids)
    }

    fn require_folder(&self, id: &str) -> Result<()> {
        let exists: Option<i64> =
            self.conn.query_row("SELECT 1 FROM folders WHERE id = ?1", [id], |r| r.get(0)).optional()?;
        exists.map(|_| ()).ok_or_else(|| Error::NotFound(id.into()))
    }

    fn unique_folder_name(&self, base: &str, parent_id: Option<&str>) -> Result<String> {
        let base = if base.is_empty() { "New Folder" } else { base };
        let mut candidate = base.to_string();
        let mut n = 1;
        loop {
            let taken: Option<i64> = self
                .conn
                .query_row(
                    "SELECT 1 FROM folders WHERE name = ?1 COLLATE NOCASE AND parent_id IS ?2",
                    params![candidate, parent_id],
                    |r| r.get(0),
                )
                .optional()?;
            if taken.is_none() {
                return Ok(candidate);
            }
            n += 1;
            candidate = format!("{base} {n}");
        }
    }

    // ---- notes ----

    pub fn list_notes(&self, scope: &Scope) -> Result<Vec<NoteSummary>> {
        let (filter, arg): (&str, Option<&str>) = match scope {
            Scope::All => ("deleted_at IS NULL", None),
            Scope::Folder(id) => ("deleted_at IS NULL AND folder_id = ?1", Some(id)),
            Scope::Tag(t) => (
                "deleted_at IS NULL AND id IN (SELECT note_id FROM note_tags WHERE tag = ?1)",
                Some(t),
            ),
            Scope::Trash => ("deleted_at IS NOT NULL", None),
        };
        let order = if matches!(scope, Scope::Trash) { "deleted_at DESC" } else { "pinned DESC, modified DESC" };
        let sql = format!("SELECT {SUMMARY_COLS} FROM notes WHERE {filter} ORDER BY {order}");
        let mut st = self.conn.prepare(&sql)?;
        let rows = match arg {
            Some(a) => st.query_map([a], summary_from_row)?.collect::<rusqlite::Result<Vec<_>>>()?,
            None => st.query_map([], summary_from_row)?.collect::<rusqlite::Result<Vec<_>>>()?,
        };
        Ok(rows)
    }

    /// Full-text search across all notes not in Recently Deleted.
    pub fn search(&self, query: &str) -> Result<Vec<NoteSummary>> {
        let Some(q) = fts_query(query) else { return Ok(Vec::new()) };
        let sql = format!(
            "SELECT {} FROM notes n JOIN notes_fts f ON f.rowid = n.rowid
             WHERE notes_fts MATCH ?1 AND n.deleted_at IS NULL
             ORDER BY n.pinned DESC, n.modified DESC",
            SUMMARY_COLS.split(", ").map(|c| format!("n.{c}")).collect::<Vec<_>>().join(", ")
        );
        let mut st = self.conn.prepare(&sql)?;
        let rows = st.query_map([q], summary_from_row)?.collect::<rusqlite::Result<_>>()?;
        Ok(rows)
    }

    pub fn get_note(&self, id: &str) -> Result<Note> {
        self.conn
            .query_row(
                &format!("SELECT {SUMMARY_COLS}, body FROM notes WHERE id = ?1"),
                [id],
                |r| Ok(Note { summary: summary_from_row(r)?, body: r.get(9)? }),
            )
            .optional()?
            .ok_or_else(|| Error::NotFound(id.into()))
    }

    pub fn create_note(&self, folder_id: &str) -> Result<Note> {
        self.require_folder(folder_id)?;
        let id = new_id();
        let now = now_ms();
        self.conn.execute(
            "INSERT INTO notes (id, folder_id, created, modified) VALUES (?1, ?2, ?3, ?3)",
            params![id, folder_id, now],
        )?;
        self.get_note(&id)
    }

    /// Saves the editor's HTML and its plain text. Title, snippet, tags and the
    /// search index are derived from the plain text.
    pub fn update_note(&self, id: &str, body: &str, plaintext: &str) -> Result<NoteSummary> {
        let (title, snippet) = title_and_snippet(plaintext);
        let has_checklist = body.contains("class=\"checklist\"");
        let tx = self.conn.unchecked_transaction()?;
        let n = tx.execute(
            "UPDATE notes SET body = ?2, plaintext = ?3, title = ?4, snippet = ?5,
                              has_checklist = ?6, modified = ?7
             WHERE id = ?1",
            params![id, body, plaintext, title, snippet, has_checklist as i64, now_ms()],
        )?;
        if n == 0 {
            return Err(Error::NotFound(id.into()));
        }
        tx.execute("DELETE FROM note_tags WHERE note_id = ?1", [id])?;
        for tag in extract_tags(plaintext) {
            tx.execute("INSERT INTO note_tags (note_id, tag) VALUES (?1, ?2)", params![id, tag])?;
        }
        tx.commit()?;
        Ok(self.get_note(id)?.summary)
    }

    pub fn set_pinned(&self, id: &str, pinned: bool) -> Result<()> {
        self.touch_one("UPDATE notes SET pinned = ?2 WHERE id = ?1 AND deleted_at IS NULL", id, pinned as i64)
    }

    pub fn move_note(&self, id: &str, folder_id: &str) -> Result<()> {
        self.require_folder(folder_id)?;
        self.touch_one("UPDATE notes SET folder_id = ?2 WHERE id = ?1", id, folder_id)
    }

    /// Moves a note to Recently Deleted.
    pub fn trash_note(&self, id: &str) -> Result<()> {
        self.touch_one("UPDATE notes SET deleted_at = ?2, pinned = 0 WHERE id = ?1", id, now_ms())
    }

    pub fn restore_note(&self, id: &str) -> Result<()> {
        self.touch_one("UPDATE notes SET deleted_at = NULL WHERE id = ?1 AND ?2 = ?2", id, 0)
    }

    /// Deletes a note for good.
    pub fn purge_note(&self, id: &str) -> Result<()> {
        self.touch_one("DELETE FROM notes WHERE id = ?1 AND ?2 = ?2", id, 0)
    }

    pub fn empty_trash(&self) -> Result<usize> {
        Ok(self.conn.execute("DELETE FROM notes WHERE deleted_at IS NOT NULL", [])?)
    }

    /// Removes notes that have been in Recently Deleted longer than the retention period.
    pub fn purge_expired(&self, now: i64) -> Result<usize> {
        let cutoff = now - TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000;
        Ok(self.conn.execute("DELETE FROM notes WHERE deleted_at IS NOT NULL AND deleted_at < ?1", [cutoff])?)
    }

    pub fn list_tags(&self) -> Result<Vec<Tag>> {
        let mut st = self.conn.prepare(
            "SELECT t.tag, COUNT(*) FROM note_tags t JOIN notes n ON n.id = t.note_id
             WHERE n.deleted_at IS NULL GROUP BY t.tag ORDER BY t.tag",
        )?;
        let rows = st.query_map([], |r| Ok(Tag { name: r.get(0)?, count: r.get(1)? }))?;
        Ok(rows.collect::<rusqlite::Result<_>>()?)
    }

    fn touch_one(&self, sql: &str, id: &str, value: impl rusqlite::ToSql) -> Result<()> {
        if self.conn.execute(sql, params![id, value])? == 0 {
            return Err(Error::NotFound(id.into()));
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn store() -> Store {
        Store::open_in_memory().unwrap()
    }

    #[test]
    fn default_folder_exists() {
        let s = store();
        let f = s.list_folders().unwrap();
        assert_eq!(f[0].id, DEFAULT_FOLDER_ID);
        assert_eq!(f[0].name, "Notes");
    }

    #[test]
    fn title_snippet_and_tags_derive_from_text() {
        let s = store();
        let n = s.create_note(DEFAULT_FOLDER_ID).unwrap();
        let sum = s
            .update_note(&n.summary.id, "<div>Groceries</div>", "\n Groceries \nMilk #shopping\nEggs #Shopping #2026")
            .unwrap();
        assert_eq!(sum.title, "Groceries");
        assert_eq!(sum.snippet, "Milk #shopping Eggs #Shopping #2026");
        assert_eq!(s.list_tags().unwrap(), vec![Tag { name: "shopping".into(), count: 1 }]);
        assert_eq!(s.list_notes(&Scope::Tag("shopping".into())).unwrap().len(), 1);
    }

    #[test]
    fn tags_need_a_word_boundary() {
        assert_eq!(extract_tags("see example.com/#anchor and #work-items"), vec!["work-items"]);
    }

    #[test]
    fn pinned_notes_sort_first() {
        let s = store();
        let a = s.create_note(DEFAULT_FOLDER_ID).unwrap().summary.id;
        let b = s.create_note(DEFAULT_FOLDER_ID).unwrap().summary.id;
        s.update_note(&b, "", "b").unwrap();
        s.set_pinned(&a, true).unwrap();
        let ids: Vec<_> = s.list_notes(&Scope::All).unwrap().into_iter().map(|n| n.id).collect();
        assert_eq!(ids, vec![a, b]);
    }

    #[test]
    fn trash_restore_and_purge() {
        let s = store();
        let id = s.create_note(DEFAULT_FOLDER_ID).unwrap().summary.id;
        s.set_pinned(&id, true).unwrap();
        s.trash_note(&id).unwrap();
        assert!(s.list_notes(&Scope::All).unwrap().is_empty());
        let trashed = s.list_notes(&Scope::Trash).unwrap();
        assert!(!trashed[0].pinned && trashed[0].deleted_at.is_some());
        s.restore_note(&id).unwrap();
        assert_eq!(s.list_notes(&Scope::All).unwrap().len(), 1);
        s.trash_note(&id).unwrap();
        s.purge_note(&id).unwrap();
        assert!(matches!(s.get_note(&id), Err(Error::NotFound(_))));
    }

    #[test]
    fn expired_trash_is_purged() {
        let s = store();
        let id = s.create_note(DEFAULT_FOLDER_ID).unwrap().summary.id;
        s.trash_note(&id).unwrap();
        assert_eq!(s.purge_expired(now_ms()).unwrap(), 0);
        let later = now_ms() + (TRASH_RETENTION_DAYS + 1) * 24 * 60 * 60 * 1000;
        assert_eq!(s.purge_expired(later).unwrap(), 1);
    }

    #[test]
    fn search_matches_prefixes_and_skips_trash() {
        let s = store();
        let a = s.create_note(DEFAULT_FOLDER_ID).unwrap().summary.id;
        let b = s.create_note(DEFAULT_FOLDER_ID).unwrap().summary.id;
        s.update_note(&a, "", "Trip to Lisbon\npack sunscreen").unwrap();
        s.update_note(&b, "", "Lisbon budget").unwrap();
        assert_eq!(s.search("lis sun").unwrap().len(), 1);
        assert_eq!(s.search("lisbon").unwrap().len(), 2);
        s.trash_note(&b).unwrap();
        assert_eq!(s.search("lisbon").unwrap().len(), 1);
        assert!(s.search("  \"  ").unwrap().is_empty());
    }

    #[test]
    fn folders_get_unique_names_and_delete_moves_notes_to_trash() {
        let s = store();
        let work = s.create_folder("Work", None).unwrap();
        assert_eq!(s.create_folder("work", None).unwrap().name, "work 2");
        let sub = s.create_folder("Projects", Some(&work.id)).unwrap();
        let n = s.create_note(&sub.id).unwrap().summary.id;
        s.delete_folder(&work.id).unwrap();
        assert!(s.list_folders().unwrap().iter().all(|f| f.id != sub.id));
        let trashed = s.list_notes(&Scope::Trash).unwrap();
        assert_eq!(trashed[0].id, n);
        s.restore_note(&n).unwrap();
        assert_eq!(s.get_note(&n).unwrap().summary.folder_id, DEFAULT_FOLDER_ID);
        assert!(s.delete_folder(DEFAULT_FOLDER_ID).is_err());
    }

    #[test]
    fn checklist_flag_follows_body() {
        let s = store();
        let id = s.create_note(DEFAULT_FOLDER_ID).unwrap().summary.id;
        let sum = s.update_note(&id, "<ul class=\"checklist\"><li>a</li></ul>", "a").unwrap();
        assert!(sum.has_checklist);
    }
}
