# Margin

A fast, local note-taking app for Windows and Android, built with Tauri and SQLite. Its layout and behaviour follow the familiar three-pane notes design: folders on the left, a date-grouped note list in the middle, and a rich-text editor on the right.

Margin is an independent project. It is not affiliated with or endorsed by Apple, and it contains no Apple code, icons or fonts.

## Features

- Folders and subfolders, with note counts, inline rename and drag-to-move
- Note list grouped by Pinned, Today, Yesterday, Previous 7 Days, Previous 30 Days, month and year
- List and gallery views
- Rich text: Title, Heading, Subheading, Body, Monospaced, bold/italic/underline/strikethrough
- Bulleted, dashed and numbered lists, checklists with round checkboxes, and tables (Tab moves between cells and adds rows)
- `#tags` collected automatically into the sidebar
- Instant full-text search (SQLite FTS5, prefix matching)
- Pinned notes
- Recently Deleted, with Recover and automatic removal after 30 days
- Empty new notes are discarded automatically
- Light and dark themes following Windows
- Pasted content is cleaned down to safe formatting

## Keyboard shortcuts

| Action | Shortcut |
|---|---|
| New note | Ctrl+N |
| New folder | Ctrl+Shift+N |
| Search | Ctrl+F |
| Checklist | Ctrl+Shift+L |
| Table | Ctrl+Alt+T |
| Title / Heading / Subheading / Body / Monospaced | Ctrl+Shift+T / H / J / B / M |
| Numbered / bulleted list | Ctrl+Shift+7 / 8 |
| Indent / outdent list item | Tab / Shift+Tab |
| Delete selected note (note list focused) | Delete |

## Layout

| Path | What it is |
|---|---|
| `crates/notes-core` | Storage and logic: folders, notes, tags, search, Recently Deleted. Plain Rust with tests. |
| `src-tauri` | The desktop shell; exposes `notes-core` to the interface. |
| `ui` | The interface: plain HTML, CSS and JavaScript, no build step. |

Notes are stored in `%APPDATA%\app.margin.notes\margin.db`.

## Development

Requirements: Rust (stable), Node.js 22, and on Windows the WebView2 runtime (preinstalled on Windows 10/11).

```bash
npm ci
npm run dev                 # run the app
cargo test -p notes-core    # storage tests
npm run build               # installers in target/release/bundle/{nsis,msi}
```

Opening `ui/index.html` through any local web server shows the interface with sample notes stored in the browser, which is handy for working on the design.

## Builds

Every push to `main` runs the tests and builds, in GitHub Actions:

- **Windows** installers (`.exe` and `.msi`): the run's **margin-windows-installers** artifact.
- **Android** APK for 64-bit ARM phones: the run's **margin-android-apk** artifact. Install it by opening the file on the phone and allowing installs from that app when Android asks.

On phones the interface shows one pane at a time (folders, list, note) with back buttons; on wider screens such as an unfolded foldable, the list and note sit side by side and folders slide in from the left.

### Android signing

So that each new APK installs as an update (keeping your notes), add two repository secrets under **Settings → Secrets and variables → Actions**:

- `ANDROID_KEYSTORE_BASE64`: a keystore file, base64-encoded
- `ANDROID_KEYSTORE_PASSWORD`: its password

Create one with:

```bash
keytool -genkeypair -keystore margin.jks -alias margin -keyalg RSA -keysize 2048 -validity 10000
base64 -w0 margin.jks
```

Without the secrets, each build is signed with a throwaway key, and Android will refuse to install a new build over an old one; uninstalling first deletes the notes stored on the phone.
