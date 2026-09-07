# Referenzio

Referenzio is a persistent floating image-reference canvas for Windows 10 and 11 (x64). It keeps one local board in `%LOCALAPPDATA%\Referenzio\library`.

## Use

- Paste a copied raster image with `Ctrl+V`.
- Drop local PNG, JPEG (`.jpg`/`.jpeg`), or WebP files onto the board. Each file must be at most 100 MiB and no more than 40,000,000 pixels.
- Click an image to select it, drag to move it, and use the corner handles to resize proportionally. Use the controls to change stacking order or delete the selected placement.
- Scroll to zoom under the pointer. Hold Space while dragging to pan. `Home` or **Fit board** frames every placement.
- Use **Pin** to keep the window on top, **Library** to open the local library folder, and `Ctrl+Shift+Space` to show or hide the window. If Windows has already reserved that shortcut, Referenzio shows a warning and remains usable from its taskbar window.

The board, camera, placement changes, pin state, and window bounds save automatically. Referenzio writes complete board snapshots and retains a backup snapshot for recovery. If the primary snapshot is damaged, it recovers from a valid backup when possible. Imported files are copied into the library before placements reference them, so a source file can be deleted after import. Deleting a placement does not remove its imported asset.

This release does not include cloud sync, remote image fetching, clipboard monitoring, named boards, undo/redo, crop, rotate, drawing, text, annotations, grouping, search, or asset garbage collection.

## Development and verification

```powershell
npm ci
npm run typecheck
npm run test:unit
npm run package:test
npm run test:e2e
npm run test:acceptance
npm run make
npm run verify:package
```

`test:acceptance` rebuilds a test-only package and launches its packaged `Referenzio.exe` through Playwright with a fresh `LOCALAPPDATA` folder for each test. It never writes to the system clipboard. `verify:package` only inspects artifacts; it never installs or launches them.

## Manual Windows acceptance checklist

Record the Windows version, display scale, and generated installer path before testing. Mark every row `PASS`, `FAIL`, or `NOT RUN` in the Task 10 report.

1. Install the generated Squirrel setup executable, launch Referenzio, then close and reopen it.
2. In Snipping Tool, copy an image, paste it with `Ctrl+V`; then copy an image from a browser and paste it too. This validates the real system clipboard without automation changing it.
3. Focus another application, press `Ctrl+Shift+Space`, and confirm Referenzio shows or hides. Record a collision warning as a separate result if Windows reserves the shortcut.
4. Drag local PNG, JPEG, and WebP files from Explorer. Move, resize, reorder, and delete them; resize and pin the window; then close and reopen it.
5. Delete a source image after dropping it, reopen Referenzio, and confirm the copied board asset remains.
6. Import 50 ordinary 1920×1080 screenshots in one drop. Confirm progress reaches 50, every image appears, and pan/zoom still works while batches complete. After warm-up, record a 10-second pan/zoom trace: p95 frame interval must be below 50 ms and no UI stall may exceed 500 ms. Record the computer hardware and display scale.
7. Inspect `%LOCALAPPDATA%\Referenzio\library`. Copy the entire library to a separate backup folder, corrupt the live `board.json`, and reopen Referenzio. Confirm the recovery message reports that the board was recovered from its backup copy.
8. Confirm native Explorer drop delivery, the actual global shortcut, title-bar dragging, and window-edge resizing on Windows. These are OS-level checks and are not substituted by unit or browser mocks.
