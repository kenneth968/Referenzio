# Referenzio Image Canvas — Version 1 Design

Date: 2026-09-04  
Status: Approved in chat

## Goal

Referenzio is a lightweight Windows desktop reference board. The user can copy an image from Windows Snipping Tool or a browser, paste it into a floating canvas, arrange and resize it, and trust that the canvas will return exactly as it was after closing or crashing.

Version 1 optimizes for a short path from capture to safely stored reference:

1. Capture or copy an image.
2. Bring Referenzio forward with a global shortcut.
3. Press `Ctrl+V`, or drop a local image file on the canvas.
4. Move or resize the image.
5. Close the app without performing an explicit save.

## Scope

Version 1 provides:

- One persistent, effectively infinite canvas.
- Explicit clipboard-image paste with `Ctrl+V`.
- Drag-and-drop import for local raster image files.
- App-owned copies of all imported images.
- Canvas pan and pointer-centered zoom.
- Image selection, movement, aspect-ratio-preserving resize, deletion, and front/back ordering.
- A resizable frameless floating window with an optional always-on-top state.
- A fixed global show/hide shortcut: `Ctrl+Shift+Space`.
- Automatic, crash-resistant persistence with recovery from a backup snapshot.
- Remembered canvas camera, window bounds, and pin state.
- An “Open library folder” action.

Version 1 deliberately excludes:

- Multiple boards or named projects.
- Pasted-URL downloading or direct remote-image fetching.
- Cropping, rotation, drawing, text, annotations, grouping, or search.
- Undo/redo history.
- Cloud synchronization, accounts, collaboration, or telemetry.
- Automatic clipboard monitoring.
- Automatic deletion of unused asset files.

Deleting an image removes its placement from the canvas but leaves the underlying asset in the library. This favors recoverability over automatic cleanup.

## Technology

The application will use:

- Electron for the Windows application shell and native integration.
- TypeScript throughout the main process, preload bridge, and renderer.
- React for the renderer UI.
- Konva through `react-konva` for the interactive canvas.
- Vitest for unit and renderer-level tests.
- Playwright's Electron support for focused application-level tests where practical.

Electron is selected because its native window, clipboard, filesystem, and global-shortcut APIs keep the floating-panel feature small. Konva provides the required canvas interactions without building selection and transformation behavior from scratch. The larger package and memory footprint compared with Tauri are accepted for version 1 in exchange for lower implementation complexity.

## Architecture

The app has four boundaries:

### Main process

The Electron main process owns privileged operations:

- Application and single-instance lifecycle.
- Window creation, remembered bounds, pin state, and show/hide behavior.
- Global shortcut registration and cleanup.
- Clipboard image extraction and PNG encoding.
- Validation and copying of dropped image files.
- Library paths, asset writes, board snapshots, settings, and recovery.
- Opening the library directory in Windows Explorer.

The main process never accepts arbitrary filesystem paths or commands from the renderer. Every exposed operation has a narrow request and validated response.

### Preload bridge

A small preload script exposes a typed API through Electron's context bridge. It contains only the operations the renderer needs, such as:

- `loadBoard()`
- `pasteClipboardImage(placement)`
- `importDroppedImages(files)`
- `saveBoard(board)`
- `setPinned(value)`
- `openLibraryFolder()`
- `minimizeWindow()`
- `closeWindow()`

Node integration remains disabled in the renderer and context isolation remains enabled.

### Renderer

React owns UI state and renders the current document. Konva owns pointer hit-testing and visual transforms. The renderer is responsible for:

- The camera transform: canvas offset and scale.
- Image placement and selection.
- Drag, resize, delete, and z-order commands.
- Translating drop-screen coordinates into canvas coordinates.
- Requesting persistence after completed state transitions.
- Displaying non-blocking success, warning, and retry states.

Konva objects are a rendering detail. The application serializes its own board model instead of serializing the Konva stage.

### Persistence service

A single main-process persistence service serializes all writes. It provides durable asset import, queued board snapshots, settings snapshots, validation, and startup recovery. No renderer code writes directly to disk.

## Data Model

The board document is versioned JSON with this conceptual structure:

```text
BoardDocument
  schemaVersion
  revision
  camera: { x, y, scale }
  assets[]
    id
    filename
    mediaType
    pixelWidth
    pixelHeight
    byteSize
    importedAt
  items[]
    id
    assetId
    x
    y
    width
    height
    zIndex
    createdAt
    updatedAt
```

Asset metadata records the generated asset identifier, stored filename, media type, pixel dimensions, byte size, and import time. Board items refer only to asset identifiers; they never contain image bytes or external source paths.

Window settings are stored separately from the board and include normal window bounds and the remembered always-on-top state.

## Library Layout

The library lives under `%LOCALAPPDATA%\Referenzio\library`:

```text
library/
  assets/
    <generated-id>.png
    <generated-id>.jpg
    <generated-id>.webp
  board.json
  board.backup.json
  settings.json
```

Temporary files use generated names in the same directory as their final target so replacement does not cross filesystems. The library is reachable through the application toolbar.

## Image Ingestion

### Clipboard paste

When the focused canvas receives `Ctrl+V`, the renderer asks the main process for the current clipboard image. The main process:

1. Confirms that supported image data is present.
2. Reads and encodes the clipboard bitmap as PNG.
3. Writes the bytes to a temporary asset file.
4. Flushes and closes the file, then renames it to its final generated name.
5. Returns validated metadata to the renderer.

The renderer adds the item at the center of the visible canvas, scales very large images to a sensible initial on-screen size without changing the stored source, and immediately requests a board save.

### File drop

The renderer captures the drop location. The preload bridge converts each dropped `File` to a local path with Electron's `webUtils.getPathForFile` and passes only those paths to the main process. The main process accepts PNG, JPEG, and WebP raster files up to 100 MiB, verifies both that each input is a readable regular file and that its bytes decode as the claimed image type, copies each file into the asset directory using a generated filename, and returns its metadata. The original path is never retained as a dependency. GIF, SVG, and other formats are rejected in version 1.

Each imported item is positioned at the translated canvas drop point with a small offset when several files are dropped together. Partial success is allowed: valid files appear while rejected files are reported clearly.

## Canvas Interaction

- Dragging empty canvas space pans the camera.
- The mouse wheel or trackpad zooms around the pointer, clamped to a safe minimum and maximum.
- Clicking an image selects it and exposes corner resize handles.
- Dragging a selected image moves it.
- Corner resizing preserves the source aspect ratio.
- Clicking empty space clears selection.
- `Delete` removes the selected item placement but not its asset file.
- Compact controls move the selected item forward, backward, to front, or to back.
- Paste places an image in the visible center; file drop uses the drop position.

Camera changes are persisted after an interaction settles. Item changes are persisted on paste, import completion, drag end, transform end, deletion, and z-order change rather than on every pointer-move frame.

## Window Behavior

The window is frameless but retains native edge resizing. A narrow custom top strip provides:

- A drag region.
- Always-on-top pin/unpin.
- Minimize.
- Close.
- Open library folder.

The global `Ctrl+Shift+Space` shortcut toggles the window between shown/focused and hidden. If registration fails because another application owns the shortcut, Referenzio stays usable through its normal taskbar entry and displays a clear warning. Window bounds are clamped to the available displays at startup so a changed monitor layout cannot strand the window off-screen.

The app uses a single-instance lock. Launching Referenzio again focuses the existing canvas rather than creating a competing writer.

## Persistence and Recovery

There is no Save button. All durable writes pass through one serialized queue.

For a board save, the persistence service:

1. Validates and serializes a complete document snapshot.
2. Writes it to a same-directory temporary file.
3. Flushes and closes the temporary file.
4. If the existing primary snapshot is valid, writes it through a temporary file and atomically replaces `board.backup.json`.
5. Atomically replaces `board.json` with the completed temporary file.
6. Reports the saved revision to the renderer.

Rapid state changes may be coalesced, but a newer revision can never be overwritten by an older queued save. Paste, drop, delete, and completed transforms request an immediate save. Camera and window changes use a short debounce and flush when the window closes normally.

On startup, Referenzio validates `board.json`. If it is absent, the app creates an empty in-memory board. If it is invalid, the app validates and loads `board.backup.json`, preserves the damaged file for inspection, and informs the user that recovery occurred. If both snapshots are invalid, the app opens an empty board without deleting any assets and reports where the damaged files are located.

A crash between asset creation and board commit can leave an unreferenced asset, which is harmless and intentionally retained. A board snapshot is never committed before all assets it references are durable.

## Error Handling

- An empty or unsupported clipboard shows a brief message and changes nothing.
- Unsupported, unreadable, or oversized dropped files are rejected individually.
- Failed asset writes do not create board items.
- A failed board save leaves the latest state in memory, marks the canvas as unsaved, and retries without blocking interaction.
- Missing asset files render a visible placeholder with the asset identifier; the remaining board still loads.
- A global shortcut collision produces a warning but does not stop startup.
- Errors include a useful action—retry, open library folder, or dismiss—rather than silently failing.

No remote content is fetched in version 1, which removes URL validation, network failure, and remote-content security concerns from the initial release.

## Performance Boundaries

The canvas is mathematically unbounded but does not allocate one enormous bitmap. It stores independent image objects under a camera transform.

Version 1 should remain responsive with dozens of ordinary screenshots. Source images remain on disk and are decoded for display as needed. Initial display dimensions are bounded. If testing exposes memory pressure, viewport-based loading and generated thumbnails are the first planned optimization; they are not preemptively included unless the acceptance dataset requires them.

## Verification

Unit tests cover:

- Board schema validation and migration rejection behavior.
- Coordinate conversion and pointer-centered zoom math.
- Item creation, movement, resize normalization, deletion, and z-order commands.
- Revision ordering and save coalescing.
- Startup selection of primary, backup, or empty recovery state.
- File-type and import validation.

Integration tests use temporary directories to cover:

- Asset copied before board commit.
- Atomic board replacement and backup retention.
- Interrupted or corrupt snapshot recovery.
- Source-file deletion after a drop.
- Missing assets and partial multi-file imports.
- Typed IPC request validation.

Focused Electron tests and a Windows acceptance pass cover:

1. A Snipping Tool or browser-copied image appears after `Ctrl+V`.
2. A dropped local image remains available after its source is deleted.
3. Items, z-order, camera, window bounds, and pin state survive restart.
4. Paste, move, resize, delete, and zoom interactions save at their defined boundaries.
5. A simulated interrupted save loads either the last primary or backup without losing both.
6. `Ctrl+Shift+Space` shows and hides the window, including when another app has focus.
7. Invalid clipboard and drop input produces an actionable error without changing the board.
8. Frameless drag and native edge resizing do not conflict with canvas interactions.

## Completion Boundary

Version 1 is complete when the acceptance checks above pass on Windows and the packaged application can be installed, launched, closed, and reopened without manual data setup. Features listed as excluded remain outside the implementation plan even if they appear convenient during development.
