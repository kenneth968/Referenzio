# Referenzio Image Canvas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and package a Windows Electron desktop reference board where copied or dropped raster images can be arranged on one persistent, crash-recoverable infinite canvas.

**Architecture:** The Electron main process owns all privileged concerns: lifecycle, a single window, global shortcut, clipboard and file ingestion, a narrow asset protocol, and a serialized persistence service. A context-isolated preload bridge validates and forwards a small typed IPC surface. The React renderer owns board interaction state; `react-konva` renders the board from the serializable shared document model, never from serialized Konva state.

**Tech Stack:** Electron 44.2.0; Electron Forge 7.11.2 with Vite 8.2.2; TypeScript 7.0.2; React/react-dom 19.2.8; Konva 10.3.2 and react-konva 19.2.5; Sharp 0.35.4; Zod 4.5.4; Vitest 5.0.0 + jsdom 30.0.1; Testing Library React 16.3.3, jest-dom 7.0.1, user-event 14.6.7; Playwright 1.62.1.

**Spec:** `docs/superpowers/specs/2026-09-04-referenzio-image-canvas-design.md`

## Global Constraints

- Target Windows 10/11 on x64 for version 1; use Electron 44.2.0 and Electron Forge packages 7.11.2 exactly, with no `^` or `~` version ranges.
- Use TypeScript 7.0.2 across main, preload, shared, renderer, and test code. Renderer Node integration is `false`; context isolation and sandboxing are `true`.
- Release packages keep `EnableNodeCliInspectArguments` disabled. Only `npm run package:test`, identified by `REFERENZIO_E2E_BUILD=1`, enables that fuse so Playwright can attach; no release artifact is made or accepted with the test fuse enabled.
- Use exactly React/react-dom 19.2.8, Konva 10.3.2, react-konva 19.2.5, Sharp 0.35.4, and Zod 4.5.4. No remote image fetching, clipboard monitoring, cloud service, telemetry, named board, undo/redo, crop, rotate, drawing, text, annotations, grouping, search, or asset garbage collection belongs in this release.
- The sole persistent board is `%LOCALAPPDATA%\\Referenzio\\library\\board.json`; `board.backup.json`, `settings.json`, and `assets\\<id>.<png|jpg|webp>` live beside it. The renderer never receives a writable filesystem capability and never stores external source paths.
- Accept clipboard raster content by an explicit `Ctrl+V`, and dropped regular local PNG, JPEG (`.jpg` or `.jpeg`), or WebP files no larger than 104,857,600 bytes. Reject every other input per file. Clipboard data is always stored as PNG.
- Reject decoded images above 40,000,000 pixels before allocation; this still admits ordinary screenshots through 8K resolution while bounding malformed or extreme inputs.
- Board snapshots are full, versioned JSON documents. Item deletion removes only the placement; imported asset files are retained. A document can only reference an asset after its final asset file is flushed, closed, and renamed into place.
- Every board write is serialized and same-directory atomic: flush a temporary file, replace a validated backup through its own temporary file, then replace the primary. A stale revision must never overwrite a newer revision.
- A frameless, resizable floating window has a custom top strip with drag region, pin, minimize, close, and library-folder controls. `Ctrl+Shift+Space` toggles show/hide; shortcut collision is a non-fatal visible warning. Use a single-instance lock and clamp restored bounds to a current display work area.
- Camera is `{ x, y, scale }`, canvas space is unbounded, scale is clamped to `[0.1, 4]`, and wheel zoom remains centered under the pointer. Persist completed mutations immediately; debounce camera and resize/move window persistence for 300 ms and flush them during normal close.
- Use a fresh, sequential `gpt-5.6-terra` implementer and a fresh `gpt-5.6-terra` reviewer for every numbered task. Never run two implementation tasks concurrently. Each initial task dispatch creates exactly one independently reviewable commit; every required fix round creates exactly one additional focused fix commit. Do not commit generated output, test artifacts, `node_modules`, packaged installers, or SDD scratch files.
- An implementer uses the listed Terra thinking level. A reviewer uses `gpt-5.6-terra` at `high` effort for Tasks 3–10 and `medium` for Tasks 1–2. Fix rounds 1–3 resume the implementer; rounds 4–5 use a fresh `gpt-5.6-terra` implementer at `high` effort. The whole-branch review uses `gpt-5.6-terra` at `xhigh` effort.

## Owned File Map

| File | First owner | Responsibility |
| --- | ---: | --- |
| `package.json`, `forge.config.ts`, `vite.*.config.ts`, `tsconfig*.json`, `vitest.config.ts`, `playwright.config.ts`, `.gitignore`, `src/forge-env.d.ts` | 1 | Reproducible Electron Forge/Vite/test/package toolchain and Forge-generated global declarations. |
| `src/shared/contracts.ts`, `src/shared/board.ts` | 2 | Versioned document schemas, IPC DTO schemas, pure board/camera/item commands. |
| `src/main/persistence/{paths,atomic-file,board-store,settings-store,index}.ts`, `src/main/persistence/persistence.test.ts` | 3 | Durable paths and writes, recovery, serialized board snapshots, and settings. |
| `src/main/assets/{image-inspector,asset-service,index}.ts`, `src/main/assets/assets.test.ts` | 4 | Image decoding, clipboard/file import, and durable app-owned asset copies. |
| `src/main/index.ts`, `src/main/window/{bounds,controller,controller.test}.ts`, `src/main/security/{asset-protocol,content-security-policy}.ts` | 5 | Main lifecycle, single instance, one window, shortcut, saved window state, CSP, safe asset serving. |
| `src/main/ipc.ts`, `src/preload/index.ts`, `src/renderer/vite-env.d.ts`, `src/main/ipc.test.ts` | 6 | Validated IPC handlers and typed renderer bridge. |
| `src/renderer/board-controller.ts`, `src/renderer/board-controller.test.ts` | 7 | Renderer document/session state, save scheduling, command orchestration. |
| `src/renderer/BoardCanvas.tsx`, `src/renderer/BoardCanvas.test.tsx`, `src/renderer/konva-image.ts` | 8 | Konva camera, selection, pan, wheel zoom, move, aspect-locked resize, missing-asset rendering. |
| `src/renderer/App.tsx`, `src/renderer/main.tsx`, `src/renderer/app.css`, `src/renderer/App.test.tsx`, `src/renderer/ui/{TitleBar,NoticeCenter}.tsx` | 9 | Chrome, keyboard and drop ingestion, status/error UI, composed application. |
| `tests/e2e/app.spec.ts`, `tests/e2e/fixtures.ts`, `README.md`, `scripts/verify-package.ps1` | 10 | Automated acceptance, packaged-app verification instructions, operator documentation. |

`src/renderer/index.html` and `src/renderer/test-setup.ts` are scaffolded in Task 1; later tasks may change only the imports or test setup required by their explicit files. `src/main/index.ts` is scaffolded in Task 1 and is owned by Task 5 thereafter. No task changes a file outside its Files section without recording a plan ruling in the SDD ledger first.

## Shared Contract Decisions

These are binding decisions, introduced in Task 2 and used verbatim throughout the sequence.

```ts
export const BOARD_SCHEMA_VERSION = 1 as const;
export const MIN_SCALE = 0.1;
export const MAX_SCALE = 4;
export const MAX_IMPORT_BYTES = 104_857_600;
export const MAX_IMPORT_PIXELS = 40_000_000;

export type Camera = { x: number; y: number; scale: number };
export type Asset = {
  id: string; filename: string; mediaType: 'image/png' | 'image/jpeg' | 'image/webp';
  pixelWidth: number; pixelHeight: number; byteSize: number; importedAt: string;
};
export type BoardItem = {
  id: string; assetId: string; x: number; y: number; width: number; height: number;
  zIndex: number; createdAt: string; updatedAt: string;
};
export type BoardDocument = {
  schemaVersion: 1; revision: number; camera: Camera; assets: Asset[]; items: BoardItem[];
};
export type WindowSettings = {
  bounds: { x: number; y: number; width: number; height: number }; alwaysOnTop: boolean;
};
export type ShortcutStatus = { registered: boolean; message: string | null };
export type RuntimeStatus = { alwaysOnTop: boolean; shortcut: ShortcutStatus };
export type Result<T> = { ok: true; value: T } | { ok: false; error: UserError };
export type UserError = {
  code: string;
  message: string;
  action: 'retry-save' | 'retry-close' | 'retry-open-library' | 'open-library' | 'dismiss';
};
export type ImportRejection = { sourceName: string; code: string; message: string };
export type ImportBatchResult = { imported: Asset[]; rejected: ImportRejection[] };
export type LoadBoardResult = {
  document: BoardDocument;
  recovery: 'primary' | 'backup' | 'empty';
  recoveryMessage: string | null;
  missingAssetIds: string[];
};
export type Point = { x: number; y: number };
```

All UUIDs are generated with `crypto.randomUUID()`. `importedAt`, `createdAt`, and `updatedAt` are ISO-8601 UTC strings from `new Date().toISOString()`. New board documents begin at revision `0`; each persisted renderer transition increments it exactly once before it calls `saveBoard`. A recovered document retains its revision. `zIndex` values are contiguous integers from `0` (back) through `items.length - 1` (front), and every reorder command renormalizes the entire list. An empty board has camera `{ x: 0, y: 0, scale: 1 }`.

## SDD Execution Protocol

This plan is intentionally sequential because each task produces a contract used by the next one.

1. Before Task 1, create or verify an isolated worktree using `superpowers:using-git-worktrees`. In PowerShell, set `$plan = 'docs/superpowers/plans/2026-09-04-referenzio-image-canvas.md'`, resolve `$sddSkill` from the installed `superpowers:subagent-driven-development` skill directory, and record `$branchBase = git rev-parse HEAD` as `BRANCH_BASE` in the ledger. Because the installed helpers are Bash scripts, resolve the scratch directory with `$workspace = bash "$sddSkill/scripts/sdd-workspace" $plan`. Create `$workspace/progress.md` with first line `# SDD ledger — plan: docs/superpowers/plans/2026-09-04-referenzio-image-canvas.md`. Read the plan and its spec, create ten controller todos, and write the required preflight table: one row for every shared file/interface pair in the Owned File Map plus one self-consistency row for each task. Record any decision as `Ruling: <decision> — <why> — <cost if wrong>`.
2. For each task, set `$taskNumber` to its integer, record `$taskBase = git rev-parse HEAD`, set `$brief = Join-Path $workspace "task-$taskNumber-brief.md"`, and run `bash "$sddSkill/scripts/task-brief" $plan $taskNumber $brief`. Then set `$report = $brief -replace '-brief\.md$', '-report.md'`. Dispatch exactly one new `gpt-5.6-terra` implementer at the effort listed in that task. Its prompt contains only: where the task fits, `$brief` introduced as the single source of requirements, the exact earlier interfaces named in the task's Consumes block, any ledger ruling that touches those files, `$report`, and this report contract: write files changed, tests and output, commit hash, self-review result, and unresolved concerns; return only status, commit, one-line test summary, and concerns. On its initial dispatch the implementer may not dispatch agents, alter scope, push, merge, or create more than the single task commit; a later resumed fix round creates its separately reviewed fix commit under step 4.
3. On `DONE` or `DONE_WITH_CONCERNS`, set `$head = git rev-parse HEAD`, `$baseShort = git rev-parse --short $taskBase`, `$headShort = git rev-parse --short $head`, and `$reviewPackage = Join-Path $workspace "review-$baseShort..$headShort.diff"`; run `bash "$sddSkill/scripts/review-package" $plan $taskBase $head $reviewPackage`. Give a fresh Terra reviewer `$brief`, `$report`, `$reviewPackage`, `$taskBase`, `$head`, and the Global Constraints. The reviewer must separately state `Spec: PASS|FAIL` and `Quality: APPROVED|CHANGES_REQUESTED`, give severity and concrete reproduction for every finding, and distinguish diff-unverifiable cross-task items. Do not accept a task without both verdicts. On `NEEDS_CONTEXT` supply only missing interface/ruling context; on `BLOCKED`, record the cause, correct the brief/ruling if needed, then re-dispatch with a substantive change.
4. Critical, Important, spec-fail, and confirmed diff-unverifiable gaps enter the five-round fix loop. Record deferred minor findings immediately. Rounds 1–3 resume the original implementer; rounds 4–5 use a fresh Terra-high implementer. Each round appends to the same report, runs its covering tests, creates no extra commit beyond its fix commit, and receives a scoped re-review package from the prior review head. At round five, adjudicate each residual in the ledger; park only non-load-bearing findings with a stated cost. Complete a task with `Task N: complete (commits <BASE>..<HEAD>, review clean)` or the equivalent parked-ruling line.
5. After Task 10, create one full-range review package from the ledger's `BRANCH_BASE` to `HEAD`, dispatch the Terra-xhigh whole-branch reviewer, run at most one consolidated fix dispatch and one scoped re-review, and collect every `Ruling:` ledger line for the final handoff. Delete only this plan's SDD scratch directory after the final review is clean, then use `superpowers:finishing-a-development-branch` to present integration/worktree choices. Never push, publish, or merge without explicit user authorization.

## Primary Documentation

- [OpenAI GPT-5.6 Terra model and supported reasoning levels](https://developers.openai.com/api/docs/models/gpt-5.6-terra)
- [Electron Forge Vite plugin](https://www.electronforge.io/config/plugins/vite)
- [Electron BrowserWindow](https://www.electronjs.org/docs/latest/api/browser-window)
- [Electron window customization](https://www.electronjs.org/docs/latest/tutorial/window-customization)
- [Electron clipboard](https://www.electronjs.org/docs/latest/api/clipboard)
- [Electron globalShortcut](https://www.electronjs.org/docs/latest/api/global-shortcut)
- [Electron webUtils.getPathForFile](https://www.electronjs.org/docs/latest/api/web-utils)
- [Electron context isolation and IPC security](https://www.electronjs.org/docs/latest/tutorial/context-isolation)
- [Electron protocol API](https://www.electronjs.org/docs/latest/api/protocol)
- [Konva pointer-centered zoom](https://konvajs.org/docs/sandbox/Zooming_Relative_To_Pointer.html)
- [Konva image resize with Transformer](https://konvajs.org/docs/sandbox/Image_Resize.html)
- [Playwright Electron automation](https://playwright.dev/docs/api/class-electron)

---

### Task 1: Scaffold the Windows Electron application

**Terra routing:** implementer `gpt-5.6-terra` / `medium`; reviewer `gpt-5.6-terra` / `medium`.

**Files:**

- Create: `package.json`
- Create: `forge.config.ts`
- Create: `vite.main.config.ts`, `vite.preload.config.ts`, `vite.renderer.config.ts`
- Create: `tsconfig.json`, `tsconfig.main.json`, `tsconfig.renderer.json`, `vitest.config.ts`, `playwright.config.ts`, `.gitignore`
- Create: `src/forge-env.d.ts`, `src/main/index.ts`, `src/preload/index.ts`, `src/renderer/index.html`, `src/renderer/main.tsx`, `src/renderer/App.tsx`, `src/renderer/app.css`, `src/renderer/test-setup.ts`
- Create: `tests/scaffold/config.test.ts`, `tests/e2e/scaffold.spec.ts`
- Modify: none

**Consumes:** The Global Constraints only.

**Produces:** A launchable, context-isolated Forge/Vite shell and stable commands: `npm run start`, `npm run typecheck`, `npm run test:unit`, `npm run test:e2e`, `npm run package`, and `npm run make`. Later tasks import `src/main/index.ts`, `src/preload/index.ts`, `src/renderer/App.tsx`, and use the test commands unchanged.

- [ ] **Step 1: Write the failing manifest/configuration test.**

```ts
// tests/scaffold/config.test.ts
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const pkg = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8')) as {
  scripts: Record<string, string>; dependencies: Record<string, string>; devDependencies: Record<string, string>;
};

describe('application scaffold', () => {
  it('pins the desktop runtime and exposes the required gates', () => {
    expect(pkg.scripts).toMatchObject({
      start: 'electron-forge start', typecheck: 'tsc -b', 'test:unit': 'vitest run',
      'test:e2e': 'playwright test', package: 'electron-forge package',
      'package:test': 'cross-env REFERENZIO_E2E_BUILD=1 electron-forge package --arch=x64',
      make: 'electron-forge make',
    });
    expect(pkg.devDependencies.electron).toBe('44.2.0');
    expect(pkg.dependencies.react).toBe('19.2.8');
    expect(pkg.dependencies['react-konva']).toBe('19.2.5');
  });
});
```

- [ ] **Step 2: Run the focused test to prove the scaffold is absent.**

Run: `npm run test:unit -- tests/scaffold/config.test.ts`

Expected: FAIL because `package.json` does not yet exist.

- [ ] **Step 3: Create the Forge, Vite, TypeScript, test, and entrypoint scaffold.**

Pin these production dependencies exactly: `electron-squirrel-startup` `1.0.1`, `konva` `10.3.2`, `react` `19.2.8`, `react-dom` `19.2.8`, `react-konva` `19.2.5`, `sharp` `0.35.4`, and `zod` `4.5.4`. Pin these dev dependencies exactly: `@electron-forge/cli`, `@electron-forge/core`, `@electron-forge/maker-squirrel`, `@electron-forge/maker-zip`, `@electron-forge/plugin-auto-unpack-natives`, `@electron-forge/plugin-fuses`, and `@electron-forge/plugin-vite` at `7.11.2`; Forge-compatible `@electron/fuses` `1.8.0`; `@playwright/test` and `playwright` `1.62.1`; `@testing-library/jest-dom` `7.0.1`, `@testing-library/react` `16.3.3`, `@testing-library/user-event` `14.6.7`; `@types/electron-squirrel-startup` `1.0.2`, `@types/node` `26.4.1`, `@types/react` `19.2.18`, `@types/react-dom` `19.2.7`; `@vitejs/plugin-react` `6.1.1`; `cross-env` `10.1.0`; `electron` `44.2.0`; `jsdom` `30.0.1`; `typescript` `7.0.2`; `vite` `8.2.2`; and `vitest` `5.0.0`.

Set `package.json` fields to `name: "referenzio"`, `productName: "Referenzio"`, `version: "0.1.0"`, `description: "A persistent floating image reference canvas for Windows."`, `author: "Kenneth"`, `private: true`, and `main: ".vite/build/main.js"`. Install with `npm install --save-exact` so the manifest values tested below contain no ranges. `vite.main.config.ts` leaves `electron` and `sharp` external so Sharp's native binary is packaged and unpacked by `AutoUnpackNativesPlugin`; `vite.preload.config.ts` leaves `electron` external and emits one CommonJS preload file; `vite.renderer.config.ts` uses `@vitejs/plugin-react` with root `src/renderer`.

```ts
// forge.config.ts (essential policy)
packagerConfig: { asar: true },
makers: [new MakerSquirrel({ name: 'referenzio' }), new MakerZIP({}, ['win32'])],
plugins: [
  new VitePlugin({ build: [
    { entry: 'src/main/index.ts', config: 'vite.main.config.ts' },
    { entry: 'src/preload/index.ts', config: 'vite.preload.config.ts' },
  ], renderer: [{ name: 'main_window', config: 'vite.renderer.config.ts' }] }),
  new AutoUnpackNativesPlugin(),
  new FusesPlugin({
    version: FuseVersion.V1,
    [FuseV1Options.RunAsNode]: false,
    [FuseV1Options.EnableCookieEncryption]: true,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    [FuseV1Options.EnableNodeCliInspectArguments]: process.env.REFERENZIO_E2E_BUILD === '1',
    [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
    [FuseV1Options.OnlyLoadAppFromAsar]: true,
  }),
],
```

`src/forge-env.d.ts` references `@electron-forge/plugin-vite/forge-vite-env` and declares `MAIN_WINDOW_VITE_DEV_SERVER_URL` and `MAIN_WINDOW_VITE_NAME`. `src/main/index.ts` must initially create one `BrowserWindow` with `webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, preload: path.join(__dirname, 'preload.js') }`; its temporary title is `Referenzio`. Use those Forge Vite globals to load the development URL or `path.join(__dirname, '../renderer', MAIN_WINDOW_VITE_NAME, 'index.html')`. `src/preload/index.ts` contains no bridge yet. `src/renderer/main.tsx` mounts `<App />` in `#root`, and the initial app renders `<main>Referenzio</main>`.

Configure Vitest with two inline projects: `node` uses environment `node` for `src/main/**/*.test.ts`, `src/shared/**/*.test.ts`, and `tests/scaffold/**/*.test.ts`; `renderer` uses the React Vite plugin plus environment `jsdom`, setup file `src/renderer/test-setup.ts`, and `src/renderer/**/*.test.{ts,tsx}`. Neither project includes `tests/e2e`. Configure Playwright `testDir: './tests/e2e'`, `testMatch: '**/*.spec.ts'`, `timeout: 30_000`, and `workers: 1`. `.gitignore` includes `node_modules/`, `out/`, `.vite/`, `playwright-report/`, `test-results/`, and `.superpowers/sdd/`.

- [ ] **Step 4: Run the toolchain gates.**

Run: `npm install`

Run: `npm run typecheck`

Run: `npm run test:unit -- tests/scaffold/config.test.ts`

Expected: installation succeeds, TypeScript exits `0`, and the focused test passes.

- [ ] **Step 5: Verify the packaged shell launches without a blocking dev-server process.**

Create `tests/e2e/scaffold.spec.ts` that launches `out\\Referenzio-win32-x64\\Referenzio.exe` with Playwright `_electron`, awaits `firstWindow()`, asserts `await page.title()` is `Referenzio` and visible text `Referenzio` exists, and closes the `ElectronApplication` in `finally`.

Run: `npm run package:test`

Run: `npm run test:e2e -- tests/e2e/scaffold.spec.ts`

Expected: the test-only package build exits `0`; the Playwright smoke launches one packaged window, makes both assertions, closes it, and exits `0`. Confirm the Forge log identifies `REFERENZIO_E2E_BUILD=1`; `npm run make` later rebuilds with the inspect fuse disabled.

- [ ] **Step 6: Commit the independently reviewable scaffold.**

```powershell
git add package.json package-lock.json forge.config.ts vite.main.config.ts vite.preload.config.ts vite.renderer.config.ts tsconfig.json tsconfig.main.json tsconfig.renderer.json vitest.config.ts playwright.config.ts .gitignore src tests
git commit -m "chore: scaffold Referenzio desktop app"
```

### Task 2: Define versioned domain and IPC contracts

**Terra routing:** implementer `gpt-5.6-terra` / `medium`; reviewer `gpt-5.6-terra` / `medium`.

**Files:**

- Create: `src/shared/contracts.ts`, `src/shared/board.ts`, `src/shared/board.test.ts`
- Modify: none

**Consumes:** Task 1's TypeScript/Vitest setup and the Shared Contract Decisions above.

**Produces:** `BoardDocumentSchema`, `WindowSettingsSchema`, request schemas, `emptyBoard()`, `assertBoardDocument(value)`, `worldPointForScreenPoint(camera, point)`, `zoomAtPoint(camera, pointer, nextScale)`, `fitInitialImageSize(asset, camera)`, `addItems(document, assets, point)`, `moveItem(document, itemId, point)`, `resizeItem(document, itemId, transform)`, `deleteItem(document, itemId)`, and `reorderItem(document, itemId, direction)`. The resize `transform` is `{ x: number; y: number; width: number }`. Tasks 3–9 use these names and types exactly.

- [ ] **Step 1: Write failing pure-domain tests.**

```ts
import { describe, expect, it } from 'vitest';
import { emptyBoard, zoomAtPoint, reorderItem } from './board';

describe('board commands', () => {
  it('keeps the world coordinate under the pointer while zooming', () => {
    expect(zoomAtPoint({ x: 10, y: 20, scale: 1 }, { x: 110, y: 220 }, 2))
      .toEqual({ x: -90, y: -180, scale: 2 });
  });
  it('renormalizes z-index when moving an item to the front', () => {
    const doc = emptyBoard();
    const seeded = { ...doc, items: [
      { id: 'a', assetId: 'asset-a', x: 0, y: 0, width: 100, height: 50, zIndex: 0, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
      { id: 'b', assetId: 'asset-b', x: 0, y: 0, width: 100, height: 50, zIndex: 1, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
    ] };
    expect(reorderItem(seeded, 'a', 'front').items.map(({ id, zIndex }) => [id, zIndex]))
      .toEqual([['b', 0], ['a', 1]]);
  });
});
```

- [ ] **Step 2: Run the test and prove the contract module is absent.**

Run: `npm run test:unit -- src/shared/board.test.ts`

Expected: FAIL with module-not-found for `./board`.

- [ ] **Step 3: Implement schemas and deterministic immutable commands.**

```ts
// src/shared/contracts.ts
export const BoardDocumentSchema = z.object({
  schemaVersion: z.literal(1), revision: z.number().int().min(0),
  camera: z.object({ x: z.number().finite(), y: z.number().finite(), scale: z.number().min(MIN_SCALE).max(MAX_SCALE) }),
  assets: z.array(AssetSchema), items: z.array(BoardItemSchema),
}).superRefine((document, ctx) => {
  const assetIds = new Set(document.assets.map((asset) => asset.id));
  document.items.forEach((item, index) => {
    if (!assetIds.has(item.assetId)) ctx.addIssue({ code: 'custom', path: ['items', index, 'assetId'], message: 'item references an unknown asset' });
    if (item.zIndex !== index) ctx.addIssue({ code: 'custom', path: ['items', index, 'zIndex'], message: 'z-index must match sorted item position' });
  });
});
```

Define `LoadBoardResult`, `ImportBatchResult`, `PasteRequest`, `DropRequest`, `SaveBoardRequest`, `SetPinnedRequest`, `ShortcutStatus`, `RuntimeStatus`, `UserErrorSchema`, `FlushResponseSchema`, and the event schemas as Zod schemas and inferred types. `FlushResponseSchema` is `{ token: uuid, result: Result<{ revision: nonnegative integer }> }`. `DropRequest` permits 1–32 Windows drive-letter absolute paths matching `^[A-Za-z]:[\\/]`, rejects UNC/device prefixes, and caps every path at 32,767 characters. `AssetSchema` requires canonical UUID `id`, positive integer dimensions/byte size, ISO timestamp, and a generated filename whose UUID stem equals `id` and whose extension matches `mediaType`; `BoardItemSchema` requires a canonical UUID, positive dimensions, finite coordinates, and ISO timestamps. `BoardDocumentSchema` rejects duplicate asset or item IDs, unknown asset references, and non-contiguous z-index order. A `LoadBoardResult` contains `document`, `recovery: 'primary' | 'backup' | 'empty'`, `recoveryMessage: string | null`, and `missingAssetIds: string[]`. Board command functions return new documents, preserve every untouched value, increment `revision` by one, and throw an `Error` for unknown IDs. `resizeItem` receives `{ x, y, width }`, validates finite coordinates, clamps width to at least `24`, calculates height from the existing `width / height` ratio, and persists x/y/width/height in the same revision. `fitInitialImageSize` uses `factor = min(1, 640 / (pixelWidth * camera.scale), 480 / (pixelHeight * camera.scale))`, preserving aspect ratio and never upscaling the source. `addItems` centers each fitted image on the supplied world point, offsets later batch items by `index * 24` on both axes, and starts their contiguous z-indexes at `existing items.length`.

- [ ] **Step 4: Add schema rejection and every command-boundary test.**

Include tests that reject schema version `2`, reject duplicate asset IDs, reject non-contiguous z-index values, reject UNC/device/relative drop paths and a 33-path batch, clamp zoom to `0.1` and `4`, preserve an arbitrary pointer's world coordinate, fit both a 4000×1000 image and a 1000×4000 image inside the 640×480 on-screen bounds without upscaling, center a paste around its world point, persist changed x/y from a top-left resize while retaining source aspect ratio, delete only the item, and increment revision once per command.

- [ ] **Step 5: Run the shared-domain gates.**

Run: `npm run typecheck`

Run: `npm run test:unit -- src/shared/board.test.ts`

Expected: both commands exit `0`; all schema and command tests pass.

- [ ] **Step 6: Commit the shared contract boundary.**

```powershell
git add src/shared
git commit -m "feat: define board domain contracts"
```

### Task 3: Build durable board and settings persistence

**Terra routing:** implementer `gpt-5.6-terra` / `high`; reviewer `gpt-5.6-terra` / `high`.

**Files:**

- Create: `src/main/persistence/paths.ts`, `src/main/persistence/atomic-file.ts`, `src/main/persistence/board-store.ts`, `src/main/persistence/settings-store.ts`, `src/main/persistence/index.ts`, `src/main/persistence/persistence.test.ts`
- Modify: none

**Consumes:** Task 2's `BoardDocumentSchema`, `WindowSettingsSchema`, `LoadBoardResult`, `Result<T>`, `emptyBoard()`, and `UserError` contract.

**Produces:** `createPersistenceService({ libraryRoot, now })` returning `initialize(): Promise<void>`, `loadBoard(): Promise<LoadBoardResult>`, `saveBoard(document: BoardDocument): Promise<Result<{ revision: number }>>`, `loadSettings(): Promise<WindowSettings>`, `saveSettings(settings: WindowSettings): Promise<Result<void>>`, `writeAsset(filename: string, bytes: Uint8Array): Promise<Result<void>>`, `flush(): Promise<Result<void>>`, `assetPath(filename: string): string`, and `libraryRoot: string`. Tasks 4–6 use this service rather than implementing their own durable writes or filesystem paths.

- [ ] **Step 1: Write failing persistence/recovery tests with a temporary library.**

```ts
it('recovers a valid backup and preserves an invalid primary for inspection', async () => {
  await writeFile(join(root, 'board.json'), '{not-json');
  await writeFile(join(root, 'board.backup.json'), JSON.stringify(validBoard({ revision: 7 })));
  const result = await service.loadBoard();
  expect(result.recovery).toBe('backup');
  expect(result.document.revision).toBe(7);
  await expect(readdir(root)).resolves.toContain('board.invalid-2026-09-04T12-00-00-000Z.json');
});

it('never allows a stale queued snapshot to replace a newer revision', async () => {
  await Promise.all([service.saveBoard(validBoard({ revision: 2 })), service.saveBoard(validBoard({ revision: 3 }))]);
  expect(JSON.parse(await readFile(join(root, 'board.json'), 'utf8')).revision).toBe(3);
});
```

- [ ] **Step 2: Run the focused persistence tests.**

Run: `npm run test:unit -- src/main/persistence/persistence.test.ts`

Expected: FAIL with module-not-found for `./index`.

- [ ] **Step 3: Implement the serialized, same-directory atomic service.**

`paths.ts` constructs and returns the five fixed paths below an injected library root. `atomic-file.ts` owns durable byte/JSON replacement. `board-store.ts` owns validation, recovery, backup promotion, revision serialization, and missing-asset discovery. `settings-store.ts` owns validated settings/defaults. `index.ts` composes those focused units behind `createPersistenceService`.

Use `fs/promises`, injected `libraryRoot`, and `mkdir(libraryRoot, { recursive: true })` plus `mkdir(join(libraryRoot, 'assets'), { recursive: true })`. Name temporary files `.${basename}.${randomUUID()}.tmp` in the destination directory. `writeDurableJson(path, text)` must open with exclusive flag `'wx'`, write UTF-8, call `handle.sync()`, close in `finally`, then `rename(temp, path)`; on error it removes only its own fully resolved temp file. The plan does not require directory-handle `fsync`, which Node does not expose portably on Windows; the accepted durability boundary is flushed file data followed by same-directory replacement and a separately replaced valid backup.

```ts
async saveBoard(document: BoardDocument): Promise<Result<{ revision: number }>> {
  const parsed = BoardDocumentSchema.safeParse(document);
  if (!parsed.success) return failure('BOARD_INVALID', 'The board data is invalid and was not saved.', 'dismiss');
  return this.enqueue(async () => {
    if (parsed.data.revision <= this.lastCommittedRevision) return success({ revision: this.lastCommittedRevision });
    const primary = await this.readValidBoard(primaryPath);
    if (primary) await this.writeDurableJson(backupPath, JSON.stringify(primary));
    await this.writeDurableJson(primaryPath, JSON.stringify(parsed.data));
    this.lastCommittedRevision = parsed.data.revision;
    return success({ revision: parsed.data.revision });
  });
}
```

`enqueue` appends work to one private promise chain and converts filesystem exceptions to the relevant failed `Result` before the next queued operation begins. Track `highestRequestedRevision` separately from `lastCommittedRevision`; advance the latter only after primary replacement succeeds. `flush()` waits for the queue and returns `BOARD_SAVE_FAILED` while the highest requested revision is not committed, allowing the window controller to cancel close. `loadBoard` first validates `board.json`; if it fails parsing or validation, renames it to `board.invalid-<timestamp-with-colons-replaced-by-hyphens>.json`, appending `-1`, `-2`, and so on before `.json` if that name exists, then validates `board.backup.json`. Return `primary`, `backup`, or `empty` exactly as declared; when both are unusable, leave all assets and damaged snapshots in place and return an empty board with an `open-library` recovery message. Set `lastCommittedRevision` and `highestRequestedRevision` from whichever valid document loads, or `0` for the empty board. Validate missing assets by `access(assetPath(filename), F_OK)` and include only absent asset IDs. Settings defaults are `{ bounds: { x: 100, y: 100, width: 1200, height: 800 }, alwaysOnTop: false }`; invalid or absent `settings.json` yields these defaults without deleting any file. Both `assetPath` and `writeAsset` reject filenames outside the canonical UUID plus `.png`, `.jpg`, or `.webp` pattern before joining a path. `writeAsset` uses the same `writeDurableBytes` helper as JSON snapshots and never accepts a directory from its caller.

- [ ] **Step 4: Add the write ordering and backup tests.**

Test an initial primary save, a second valid save that leaves the first document in `board.backup.json`, malformed write rejection with no primary replacement, primary/backup/empty selection, same-directory temporary cleanup after a simulated write failure, settings default/load/save, missing-asset reporting, `flush()` waiting for the last queued revision, and `flush()` returning `BOARD_SAVE_FAILED` when the newest requested revision did not commit.

- [ ] **Step 5: Run persistence verification.**

Run: `npm run typecheck`

Run: `npm run test:unit -- src/main/persistence/persistence.test.ts`

Expected: both commands exit `0` and all persistence tests pass.

- [ ] **Step 6: Commit persistence as one review surface.**

```powershell
git add src/main/persistence
git commit -m "feat: persist board snapshots safely"
```

### Task 4: Import durable app-owned image assets

**Terra routing:** implementer `gpt-5.6-terra` / `high`; reviewer `gpt-5.6-terra` / `high`.

**Files:**

- Create: `src/main/assets/image-inspector.ts`, `src/main/assets/asset-service.ts`, `src/main/assets/index.ts`, `src/main/assets/assets.test.ts`
- Modify: none

**Consumes:** Task 2's `Asset`, `ImportBatchResult`, `MAX_IMPORT_BYTES`, `MAX_IMPORT_PIXELS`, and `UserError`; Task 3's persistence service methods `writeAsset(filename, bytes)` and `assetPath(filename)`.

**Produces:** `createAssetService({ persistence, clipboard, now, createId })` returning `pasteClipboardImage(): Promise<Result<Asset>>` and `importDroppedImages(paths: string[]): Promise<ImportBatchResult>`. Task 6 invokes only these methods; it never opens source files itself.

- [ ] **Step 1: Write failing asset ingestion tests.**

```ts
it('copies a verified PNG before reporting it as imported', async () => {
  const result = await assets.importDroppedImages([fixture('one-pixel.png')]);
  expect(result.imported).toHaveLength(1);
  const asset = result.imported[0];
  await expect(readFile(persistence.assetPath(asset.filename))).resolves.toEqual(await readFile(fixture('one-pixel.png')));
  expect(asset).toMatchObject({
    id: '00000000-0000-4000-8000-000000000001',
    filename: '00000000-0000-4000-8000-000000000001.png',
    mediaType: 'image/png', pixelWidth: 1, pixelHeight: 1,
  });
});

it('allows a good file beside a rejected one', async () => {
  const result = await assets.importDroppedImages([fixture('one-pixel.png'), fixture('not-an-image.png')]);
  expect(result.imported).toHaveLength(1);
  expect(result.rejected).toEqual([{ sourceName: 'not-an-image.png', code: 'DECODE_FAILED', message: 'The file is not a valid PNG image.' }]);
});
```

- [ ] **Step 2: Run the importer tests before implementation.**

Run: `npm run test:unit -- src/main/assets/assets.test.ts`

Expected: FAIL with module-not-found for `./asset-service`.

- [ ] **Step 3: Implement strict clipboard and file import.**

`image-inspector.ts` owns extension/media mapping, the 100 MiB limit, Sharp decoding, and trusted dimensions. `asset-service.ts` owns clipboard/file adapters, ID/timestamp generation, durable write ordering, and batch error mapping. `index.ts` re-exports only the service factory and its dependency types.

For a file path, call `lstat`; require `stats.isFile()`, require `stats.size <= MAX_IMPORT_BYTES`, map extension to claimed media type, and read bytes. Construct `const decoder = sharp(bytes, { failOn: 'error', limitInputPixels: MAX_IMPORT_PIXELS })`; read `decoder.metadata()`, require its format to equal the claimed extension's format (`png`, `jpeg`, or `webp`), then force a complete decode with `await decoder.clone().raw().toBuffer()` and discard those raw bytes. Only after both operations succeed may the service generate `id`, extension (`png`, `jpg`, or `webp`), final filename, and metadata. Call Task 3's `persistence.writeAsset(filename, bytes)` and return no `Asset` until that durable call succeeds. Preserve JPEG source bytes with a `.jpg` filename. Return one rejection for each invalid path and continue the remaining batch.

For clipboard import, use `clipboard.readImage()`. If `isEmpty()` is true, return `{ ok: false, error: { code: 'CLIPBOARD_EMPTY', message: 'Copy an image, then paste it onto the canvas.', action: 'dismiss' } }`. Otherwise call `toPNG()`, apply the same metadata, pixel-limit, and full-decode checks to the PNG buffer, set `const id = createId()` and `const filename = id + '.png'`, call `persistence.writeAsset(filename, buffer)`, and return `mediaType: 'image/png'` only on success. A failed write returns `ASSET_WRITE_FAILED` and never returns an asset. A file with a mismatched extension returns `TYPE_MISMATCH`; unknown extension returns `UNSUPPORTED_FORMAT`; too large returns `FILE_TOO_LARGE`; decoded pixel excess returns `IMAGE_TOO_LARGE`; non-regular or unreadable input returns `FILE_UNREADABLE`.

- [ ] **Step 4: Add negative and durability tests.**

Cover empty clipboard, a valid clipboard PNG, the pure size guard accepting exactly 104,857,600 and rejecting 104,857,601 without allocating those buffers, the 40,000,000-pixel boundary, symlink/directory rejection through a mocked `lstat`, JPEG and WebP success with small real fixtures, extension-byte mismatch, a valid header with a truncated/corrupt pixel payload returning `DECODE_FAILED` without calling `writeAsset`, destination write failure with no result asset, generated filename never containing a source directory, and source deletion after return leaving the app-owned copy readable.

- [ ] **Step 5: Run asset verification.**

Run: `npm run typecheck`

Run: `npm run test:unit -- src/main/assets/assets.test.ts`

Expected: both commands exit `0`; all ingestion, partial-success, and durable-copy tests pass.

- [ ] **Step 6: Commit the importer.**

```powershell
git add src/main/assets
git commit -m "feat: import clipboard and dropped image assets"
```

### Task 5: Add main-process lifecycle, floating window, shortcut, and asset protocol

**Terra routing:** implementer `gpt-5.6-terra` / `high`; reviewer `gpt-5.6-terra` / `high`.

**Files:**

- Create: `src/main/window/bounds.ts`, `src/main/window/controller.ts`, `src/main/window/controller.test.ts`, `src/main/security/asset-protocol.ts`, `src/main/security/content-security-policy.ts`
- Modify: `src/main/index.ts`

**Consumes:** Task 2's `WindowSettings`, `RuntimeStatus`, and `Result`; Task 3's persistence service; Task 4's asset service. Task 1's Forge-provided `MAIN_WINDOW_VITE_DEV_SERVER_URL` and `MAIN_WINDOW_VITE_NAME` declarations plus the generated sibling preload bundle at `path.join(__dirname, 'preload.js')`.

**Produces:** `createWindowController({ BrowserWindow, screen, globalShortcut, persistence, notifyShortcut, notifyError, flushRenderer })` with `createOrFocus(): Promise<BrowserWindow>`, `toggleVisibility(): void`, `setPinned(value: boolean): Promise<Result<void>>`, `minimize(): void`, `requestClose(): Promise<Result<void>>`, `flushWindowState(): Promise<Result<void>>`, and `getRuntimeStatus(): RuntimeStatus`; `registerAssetProtocol({ protocol, net, persistence })`; `installContentSecurityPolicy(session, isPackaged)`; and `bootstrapApp()`. Task 6 supplies the real renderer-flush coordinator and wires the two typed renderer event callbacks.

- [ ] **Step 1: Write focused controller tests using Electron fakes.**

```ts
it('clamps saved bounds to the primary work area when no saved rectangle intersects a display', async () => {
  persistence.loadSettings.mockResolvedValue({ bounds: { x: 50_000, y: 50_000, width: 1200, height: 800 }, alwaysOnTop: true });
  await controller.createOrFocus();
  expect(BrowserWindow).toHaveBeenCalledWith(expect.objectContaining({ x: 0, y: 0, width: 1200, height: 800, alwaysOnTop: true, frame: false, resizable: true }));
});

it('warns but starts when the fixed shortcut cannot register', async () => {
  globalShortcut.register.mockReturnValue(false);
  await controller.createOrFocus();
  expect(notifyShortcut).toHaveBeenCalledWith({ registered: false, message: 'Ctrl+Shift+Space is unavailable; use the Referenzio taskbar window.' });
});
```

- [ ] **Step 2: Run the focused window tests.**

Run: `npm run test:unit -- src/main/window/controller.test.ts`

Expected: FAIL with module-not-found for `./controller`.

- [ ] **Step 3: Implement lifecycle and one-window behavior.**

`window/bounds.ts` owns the pure display-clamping algorithm. `window/controller.ts` owns the window instance, settings debounce, shortcut state, and durable close. `security/asset-protocol.ts` owns only opaque library-asset reads. `security/content-security-policy.ts` owns only header policy. `main/index.ts` composes these units and owns Electron lifecycle events.

Call `protocol.registerSchemesAsPrivileged` before `app.whenReady()` for scheme `referenzio-asset` with `{ standard: true, secure: true, supportFetchAPI: true }`. In `bootstrapApp`, call `app.requestSingleInstanceLock()` before readiness; if false call `app.quit()`. On `second-instance`, call `createOrFocus()`, `show()`, `restore()` if minimized, and `focus()`. Create only one `BrowserWindow` with `frame: false`, `resizable: true`, `thickFrame: true`, `minWidth: 640`, `minHeight: 480`, `show: false`, and `webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, navigateOnDragDrop: false }`. On `ready-to-show`, call `show()` and `focus()`. On all window `move` and `resize` events, capture `getBounds()` and debounce settings persistence for exactly 300 ms.

At startup, require a non-empty `process.env.LOCALAPPDATA` and construct the only library root as `path.join(process.env.LOCALAPPDATA, 'Referenzio', 'library')`; initialize Task 3's persistence service before loading the board or creating the window. If the variable is missing, show a fatal startup error naming `LOCALAPPDATA` and quit without creating an alternate storage location. Construct Task 4's asset service with Electron's main-process `clipboard`, then register the asset protocol and IPC dependencies around those single service instances.

Register `Ctrl+Shift+Space` once after readiness. Store `{ registered: true, message: null }` when registration succeeds; otherwise store and publish `{ registered: false, message: 'Ctrl+Shift+Space is unavailable; use the Referenzio taskbar window.' }`. The callback calls `toggleVisibility()`. `getRuntimeStatus()` returns the remembered pin state plus this stored shortcut status so a renderer that subscribes after registration still receives the initial truth. On close requested through `requestClose`, await `flushRenderer()`, `persistence.flush()`, and `flushWindowState()` in that order and inspect every `Result`. If any fails, keep the window open, copy its code/message into a `UserError` with action `retry-close`, publish that mapped error, and return it; otherwise call `globalShortcut.unregisterAll()`, set a private `allowDestroy` guard, destroy the window, call `app.quit()`, and return success. The BrowserWindow `close` event calls `preventDefault()` and starts `requestClose()` whenever `allowDestroy` is false, so Alt+F4 uses this same path without recursion. Task 5 tests use an injected successful renderer flush; Task 6 replaces it with the IPC handshake.

`installContentSecurityPolicy` sets response headers on the main session. Production uses `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob: referenzio-asset:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'`. Development adds only Vite's local `http:` origin, `ws:` connection, and `'unsafe-eval'` script allowance. Neither policy permits a remote image origin.

`clampBounds` uses the saved rectangle only when it intersects a display `workArea`; otherwise it uses the primary display at top-left and constrains width/height to that work area. It preserves a visible 64-pixel strip when a partially intersecting saved rectangle is restored. `toggleVisibility` hides a focused visible window; otherwise it calls show/restore/focus. `setPinned` calls `window.setAlwaysOnTop(value)`, immediately persists settings, and returns its `Result`.

```ts
// src/main/security/asset-protocol.ts
protocol.handle('referenzio-asset', async (request) => {
  const filename = decodeURIComponent(new URL(request.url).pathname.slice(1));
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(png|jpg|webp)$/i.test(filename)) return new Response('Not found', { status: 404 });
  const path = persistence.assetPath(filename);
  try { await access(path); return net.fetch(pathToFileURL(path).toString()); }
  catch { return new Response('Not found', { status: 404 }); }
});
```

- [ ] **Step 4: Add lifecycle, protocol, and CSP coverage.**

Test second-instance focus, visible/focused toggle-to-hide and hidden toggle-to-show, pin persistence, 300 ms move debounce plus close flush, renderer flush occurring before disk/settings flush, close remaining open after any failed flush, native edge resize remaining enabled, successful and failed shortcut registration, `getRuntimeStatus()` returning initial pin/shortcut truth, `unregisterAll` on successful close, production/development CSP values, and the asset protocol rejecting traversal/invalid filenames while serving a valid app-owned filename only.

- [ ] **Step 5: Run the lifecycle gates.**

Run: `npm run typecheck`

Run: `npm run test:unit -- src/main/window/controller.test.ts`

Expected: both commands exit `0`; controller and protocol tests pass.

- [ ] **Step 6: Commit the main-process shell.**

```powershell
git add src/main/index.ts src/main/window src/main/security
git commit -m "feat: add Referenzio window lifecycle"
```

### Task 6: Expose a validated, typed preload and IPC boundary

**Terra routing:** implementer `gpt-5.6-terra` / `high`; reviewer `gpt-5.6-terra` / `high`.

**Files:**

- Create: `src/main/ipc.ts`, `src/main/ipc.test.ts`
- Create: `src/renderer/vite-env.d.ts`
- Modify: `src/preload/index.ts`, `src/main/index.ts`

**Consumes:** Task 2's `LoadBoardResult`, request schemas, `Result<T>`, and error types; Task 3's persistence methods; Task 4's asset methods; Task 5's window-controller methods.

**Produces:** `window.referenzio` with exactly these methods: `loadBoard(): Promise<Result<LoadBoardResult>>`, `getRuntimeStatus(): Promise<Result<RuntimeStatus>>`, `pasteClipboardImage(): Promise<Result<Asset>>`, `importDroppedImages(files: File[]): Promise<Result<ImportBatchResult>>`, `saveBoard(document: BoardDocument): Promise<Result<{ revision: number }>>`, `setPinned(value: boolean): Promise<Result<void>>`, `openLibraryFolder(): Promise<Result<void>>`, `minimizeWindow(): Promise<Result<void>>`, `closeWindow(): Promise<Result<void>>`, `onShortcutStatus(listener: (status: ShortcutStatus) => void): () => void`, `onMainError(listener: (error: UserError) => void): () => void`, and `onFlushRequest(listener: () => Promise<Result<{ revision: number }>>): () => void`. Task 7 imports this global type; Task 9 calls only this surface.

- [ ] **Step 1: Write failing IPC validation tests.**

```ts
it('rejects a renderer save with an unknown asset reference before persistence runs', async () => {
  const handler = registeredHandlers.get('board:save')!;
  await expect(handler(trustedEvent(), { ...validBoard(), items: [invalidItem()] })).resolves.toEqual({
    ok: false, error: { code: 'REQUEST_INVALID', message: 'The request is invalid.', action: 'dismiss' },
  });
  expect(persistence.saveBoard).not.toHaveBeenCalled();
});

it('does not expose ipcRenderer or filesystem APIs to window', () => {
  expect(exposedApi).toEqual(expect.objectContaining({ loadBoard: expect.any(Function), importDroppedImages: expect.any(Function) }));
  expect(exposedApi).not.toHaveProperty('ipcRenderer');
  expect(exposedApi).not.toHaveProperty('require');
});
```

- [ ] **Step 2: Run the focused IPC test before implementation.**

Run: `npm run test:unit -- src/main/ipc.test.ts`

Expected: FAIL with module-not-found for `./ipc`.

- [ ] **Step 3: Register narrow schemas-first handlers and the bridge.**

Use channels exactly `board:load`, `app:runtime-status`, `clipboard:paste`, `assets:import-drop`, `board:save`, `window:set-pinned`, `shell:open-library`, `window:minimize`, `window:close`, plus events `app:shortcut-status`, `app:error`, `app:flush-request`, and `app:flush-response`. Every invoke handler returns `Result<T>`. Before parsing a request, reject a sender whose `event.senderFrame.url` is not the exact Vite development origin during development or the packaged renderer's expected `file:` URL; return `UNTRUSTED_SENDER` without calling a service. Each handler then parses its input with the Task 2 Zod schema before calling a service. A parse failure returns the literal `REQUEST_INVALID` `Result`, never throws. `assets:import-drop` accepts a maximum of 32 normalized non-empty string paths; main wraps Task 4's batch as a successful result after filesystem validation. `shell:open-library` calls `shell.openPath(persistence.libraryRoot)` and returns `OPEN_LIBRARY_FAILED` with action `retry-open-library` when Electron returns a non-empty error string.

```ts
// src/preload/index.ts
contextBridge.exposeInMainWorld('referenzio', {
  loadBoard: () => ipcRenderer.invoke('board:load'),
  getRuntimeStatus: () => ipcRenderer.invoke('app:runtime-status'),
  pasteClipboardImage: () => ipcRenderer.invoke('clipboard:paste'),
  importDroppedImages: (files: File[]) => {
    const paths = files.map((file) => webUtils.getPathForFile(file)).filter(Boolean);
    return ipcRenderer.invoke('assets:import-drop', paths);
  },
  saveBoard: (document: BoardDocument) => ipcRenderer.invoke('board:save', document),
  setPinned: (value: boolean) => ipcRenderer.invoke('window:set-pinned', { value }),
  openLibraryFolder: () => ipcRenderer.invoke('shell:open-library'),
  minimizeWindow: () => ipcRenderer.invoke('window:minimize'),
  closeWindow: () => ipcRenderer.invoke('window:close'),
  onShortcutStatus: (listener: (status: ShortcutStatus) => void) => {
    const callback = (_: Electron.IpcRendererEvent, value: ShortcutStatus) => listener(value);
    ipcRenderer.on('app:shortcut-status', callback);
    return () => ipcRenderer.removeListener('app:shortcut-status', callback);
  },
  onMainError: (listener: (error: UserError) => void) => {
    const callback = (_: Electron.IpcRendererEvent, value: UserError) => listener(value);
    ipcRenderer.on('app:error', callback);
    return () => ipcRenderer.removeListener('app:error', callback);
  },
  onFlushRequest: (listener: () => Promise<Result<{ revision: number }>>) => {
    const callback = async (_: Electron.IpcRendererEvent, token: string) => {
      const result = await listener();
      ipcRenderer.send('app:flush-response', { token, result });
    };
    ipcRenderer.on('app:flush-request', callback);
    return () => ipcRenderer.removeListener('app:flush-request', callback);
  },
});
```

Implement `createRendererFlushCoordinator(ipcMain, getWindow)` in `src/main/ipc.ts`. For each close request it creates a UUID token, installs one trusted-sender response entry in a `Map`, sends `app:flush-request`, and resolves with the matching validated `Result` from `app:flush-response`. A 5,000 ms timeout removes the entry and returns `RENDERER_FLUSH_TIMEOUT` with action `retry-close`; a response for any other token or sender is ignored. Wire this coordinator into Task 5's `flushRenderer` dependency. Wire shortcut and close-save-error notifications to `mainWindow.webContents.send('app:shortcut-status', status)` and `mainWindow.webContents.send('app:error', error)` only after web contents exists. Intercept the BrowserWindow `close` event until `requestClose()` has flushed successfully so Alt+F4 follows the same durable-close path as the custom button. Parse every incoming event payload with Task 2's schema before invoking a renderer listener. Add `Window.referenzio` declarations to `vite-env.d.ts`; no renderer imports Electron.

- [ ] **Step 4: Add all handler and preload tests.**

Test every channel's valid call, untrusted sender rejection, malformed body rejection, 33 paths rejection, rejected asset batches returned intact, initial runtime status, window method delegation, shell failure, one shortcut notification, one main-error notification, both ordinary listener cleanups, matching flush request/response, forged token/sender rejection, the 5,000 ms flush timeout, and flush-listener cleanup. Test `importDroppedImages(files)` calls `webUtils.getPathForFile` inside preload, filters empty returned paths, and sends only the resulting string array over IPC; it must never return paths to the renderer, read bytes, or expose Node APIs.

- [ ] **Step 5: Run IPC verification.**

Run: `npm run typecheck`

Run: `npm run test:unit -- src/main/ipc.test.ts`

Expected: both commands exit `0`; all handler and bridge tests pass.

- [ ] **Step 6: Commit the capability boundary.**

```powershell
git add src/main/index.ts src/main/ipc.ts src/main/ipc.test.ts src/preload/index.ts src/renderer/vite-env.d.ts
git commit -m "feat: expose validated renderer IPC bridge"
```

### Task 7: Create the renderer board controller and save policy

**Terra routing:** implementer `gpt-5.6-terra` / `high`; reviewer `gpt-5.6-terra` / `high`.

**Files:**

- Create: `src/renderer/board-controller.ts`, `src/renderer/board-controller.test.ts`
- Modify: none

**Consumes:** Task 2's board commands/types and Task 6's `window.referenzio` API exactly.

**Produces:** `useBoardController()` returning `{ document, selectedItemId, missingAssetIds, loadState, saveState, shortcutStatus, alwaysOnTop, errors, selectItem, clearSelection, panCamera, zoomCameraAt, addImportedAssets, pasteClipboard(point), importDroppedFiles(files, point), moveItem, resizeItem, deleteSelected, reorderSelected, retrySave, flushPendingSave, openLibraryFolder, runErrorAction, dismissError, setPinned, dispose }`. `loadState` is `'loading' | 'ready' | 'recovered' | 'error'`; `saveState` is `'saved' | 'saving' | 'unsaved'`. Task 8 receives callbacks and Task 9 binds chrome/ingestion controls to these exact members.

- [ ] **Step 1: Write a failing controller test for immediate/debounced saves.**

```ts
it('saves a completed drag immediately but coalesces camera changes for 300 ms', async () => {
  const { result } = renderHook(() => useBoardController());
  await waitFor(() => expect(result.current.loadState).toBe('ready'));
  act(() => result.current.moveItem('item-a', { x: 30, y: 40 }));
  await waitFor(() => expect(window.referenzio.saveBoard).toHaveBeenCalledTimes(1));
  act(() => result.current.panCamera({ x: 1, y: 0 }));
  act(() => result.current.panCamera({ x: 2, y: 0 }));
  expect(window.referenzio.saveBoard).toHaveBeenCalledTimes(1);
  await advanceTimersByTimeAsync(300);
  expect(window.referenzio.saveBoard).toHaveBeenCalledTimes(2);
});
```

- [ ] **Step 2: Run the controller test before implementation.**

Run: `npm run test:unit -- src/renderer/board-controller.test.ts`

Expected: FAIL with module-not-found for `./board-controller`.

- [ ] **Step 3: Implement controller state and save sequencing.**

Call `window.referenzio.loadBoard()` and `window.referenzio.getRuntimeStatus()` once on mount and unwrap both `Result` values. Either failure sets `loadState: 'error'` and appends the returned `UserError`; no fallback document is invented in the renderer. Set `loadState` to `recovered` when a successful board load reports `recovery` as `backup` or `empty` with a non-null `recoveryMessage`; otherwise set `ready`. Store `missingAssetIds`, initial `alwaysOnTop`, and initial shortcut status. Subscribe to `onShortcutStatus`, `onMainError`, and `onFlushRequest`, returning all three unsubscribe functions from the effect. The flush listener calls `flushPendingSave()`. Every command uses a Task 2 pure function; item mutations call `requestSave('immediate')`; `panCamera` and `zoomCameraAt` call `requestSave('debounced')` with a 300 ms timer.

Keep `lastRequestedRevision` and only accept an `ok` save result when `result.value.revision >= lastRequestedRevision`; this prevents an older response changing a newer in-memory state to saved. A failed result sets `saveState: 'unsaved'`, stores its `UserError`, schedules retry after 1,000 ms then doubles delay through 2,000, 4,000, 8,000, 16,000, and 30,000 ms maximum while the state remains unsaved, and keeps interaction enabled. `retrySave` cancels the pending delay and attempts immediately. `flushPendingSave` cancels camera/retry timers and awaits `saveBoard` for the latest in-memory document, returning its exact `Result`; when the current revision is already acknowledged it returns that saved revision without another write. `dispose` only clears timers and unsubscribes because the close handshake owns durable shutdown. `pasteClipboard(point)` asks the bridge first; on success it invokes `addImportedAssets([asset], point)`; on failure it exposes the returned error without changing the document. `importDroppedFiles(files, point)` passes the DOM `File[]` to the preload bridge, unwraps the outer `Result`, displays individual batch rejections, and adds only imported assets at the supplied world point. `setPinned` updates `alwaysOnTop` only after the main-process call succeeds; a failure enters `errors`. `openLibraryFolder` calls the bridge and appends a failed result to `errors`. `runErrorAction(error)` maps `retry-save` to `retrySave()`, `retry-close` to `window.referenzio.closeWindow()`, `retry-open-library` and `open-library` to `openLibraryFolder()`, and `dismiss` to `dismissError(error)`; no error action is inferred from free-form message text.

- [ ] **Step 4: Add controller behavior coverage.**

Test load of primary and recovered board, initial runtime status, missing asset propagation, revision monotonicity, failed save preserving interaction/document then retrying at 1,000 ms, immediate retry, one 300 ms camera write for many camera updates, a flush request cancelling the debounce and awaiting the current revision, a flush failure returning the same `UserError`, paste failure changing no revision, partial drop adding only successes, selected-item deletion clearing selection, pin success/failure, library-open failure, every explicit error-action mapping, all three event subscriptions, and all subscription cleanups.

- [ ] **Step 5: Run controller verification.**

Run: `npm run typecheck`

Run: `npm run test:unit -- src/renderer/board-controller.test.ts`

Expected: both commands exit `0`; fake-timer persistence tests pass.

- [ ] **Step 6: Commit the renderer state boundary.**

```powershell
git add src/renderer/board-controller.ts src/renderer/board-controller.test.ts
git commit -m "feat: add renderer board controller"
```

### Task 8: Render and manipulate the Konva infinite canvas

**Terra routing:** implementer `gpt-5.6-terra` / `high`; reviewer `gpt-5.6-terra` / `high`.

**Files:**

- Create: `src/renderer/BoardCanvas.tsx`, `src/renderer/BoardCanvas.test.tsx`, `src/renderer/konva-image.ts`
- Modify: none

**Consumes:** Task 2's `Camera`, `BoardDocument`, and coordinate functions; Task 7's controller output/callback signatures; Task 5's `referenzio-asset://` protocol convention.

**Produces:** `<BoardCanvas document={...} selectedItemId={...} missingAssetIds={...} onSelect={...} onClearSelection={...} onPan={...} onZoomAt={...} onMove={...} onResize={...} />`. Its DOM wrapper is `data-testid="board-canvas"`, carries `data-item-count` and `data-missing-asset-count`, and contains the Konva canvases; individual Konva nodes are not represented as DOM elements. Task 9 mounts this component inside a measured canvas host and supplies all callbacks.

- [ ] **Step 1: Write failing canvas interaction tests.**

```tsx
it('keeps the pointer world coordinate fixed on wheel zoom', () => {
  render(<BoardCanvas {...props} />);
  fireEvent.wheel(screen.getByTestId('board-canvas'), { clientX: 110, clientY: 220, deltaY: -1 });
  expect(props.onZoomAt).toHaveBeenCalledWith({ x: 110, y: 220 }, 1.1);
});

it('renders a visible missing-asset placeholder instead of an image request', () => {
  render(<BoardCanvas {...props} missingAssetIds={new Set(['asset-a'])} />);
  expect(screen.getByText('Missing asset: asset-a')).toBeVisible();
  expect(createImage).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run canvas tests before implementation.**

Run: `npm run test:unit -- src/renderer/BoardCanvas.test.tsx`

Expected: FAIL with module-not-found for `./BoardCanvas`.

- [ ] **Step 3: Implement camera and item interaction.**

`konva-image.ts` exports `loadCanvasImage(source: string): Promise<HTMLImageElement>` with `image.decoding = 'async'`, and a testable image-cache reset function. `BoardCanvas` wraps one `Stage` in a real DOM element carrying the three test attributes defined above. The Stage has a world `Layer` whose `x`, `y`, `scaleX`, and `scaleY` equal `document.camera`, an image layer, and a top selection layer. It fills its host via `ResizeObserver`; it never allocates an unbounded bitmap. Empty-stage pointer down begins a pan, pointer move reports delta in screen pixels to `onPan`, and pointer up ends it. Clicking an image stops propagation and calls `onSelect(item.id)`; empty click calls `onClearSelection()`.

For wheel interaction, prevent browser scrolling and calculate `nextScale = clamp(camera.scale * (event.evt.deltaY > 0 ? 0.9 : 1.1), MIN_SCALE, MAX_SCALE)`, then call `onZoomAt(stage.getPointerPosition()!, nextScale)`. Do not use Konva's own serialized stage transform. An image drag-end calls `onMove(item.id, { x: node.x(), y: node.y() })`. Attach one `Transformer` only to the selected image, configure `enabledAnchors` as `['top-left', 'top-right', 'bottom-left', 'bottom-right']`, `keepRatio: true`, `flipEnabled: false`, and a `boundBoxFunc` that refuses dimensions under `24`. On transform end, capture `x = node.x()`, `y = node.y()`, and `width = node.width() * node.scaleX()` before resetting `scaleX/scaleY` to `1`, then call `onResize(item.id, { x, y, width })`. Render missing assets as a red outlined `Group` with the literal label `Missing asset: <assetId>` at the saved bounds.

- [ ] **Step 4: Add full canvas behavior coverage.**

In `BoardCanvas.test.tsx`, mock `react-konva` with small DOM wrappers that retain event props, expose the Stage wrapper as `data-testid="konva-stage"`, and render Konva `Text` content into a `<span>`; this makes the interaction assertions independent of jsdom's missing Canvas implementation. Test selection versus empty clearing, 0.1/4 wheel clamp, screen-to-world delta behavior during pan, drag-end coordinates, four-only Transformer handles, scale reset after transform, a top-left transform emitting changed x/y and aspect-preserving width in one callback, minimum size, z-order sorted rendering, asset URL exactly `referenzio-asset://asset/<encoded generated filename>`, DOM item/missing counts, and missing-asset placeholder.

- [ ] **Step 5: Run canvas verification.**

Run: `npm run typecheck`

Run: `npm run test:unit -- src/renderer/BoardCanvas.test.tsx`

Expected: both commands exit `0`; all canvas interaction tests pass.

- [ ] **Step 6: Commit the canvas interaction layer.**

```powershell
git add src/renderer/BoardCanvas.tsx src/renderer/BoardCanvas.test.tsx src/renderer/konva-image.ts
git commit -m "feat: add interactive Konva canvas"
```

### Task 9: Compose ingestion, window chrome, and user feedback

**Terra routing:** implementer `gpt-5.6-terra` / `high`; reviewer `gpt-5.6-terra` / `high`.

**Files:**

- Create: `src/renderer/App.test.tsx`, `src/renderer/ui/TitleBar.tsx`, `src/renderer/ui/NoticeCenter.tsx`
- Modify: `src/renderer/App.tsx`, `src/renderer/main.tsx`, `src/renderer/app.css`

**Consumes:** Task 6's bridge; Task 7's `useBoardController`; Task 8's `BoardCanvas`; Task 5's top-strip/native-window behavior.

**Produces:** The complete interactive renderer used by the packaged app, including `data-testid="canvas-host"`, `data-testid="board-canvas"`, a native drag region, non-drag controls, and non-blocking status/error messages. Task 10 drives these stable test IDs and visible button labels.

- [ ] **Step 1: Write failing composition tests.**

```tsx
it('pastes only on Ctrl+V and leaves the board unchanged for an empty clipboard', async () => {
  render(<App />);
  await userEvent.keyboard('{Control>}v{/Control}');
  await waitFor(() => expect(window.referenzio.pasteClipboardImage).toHaveBeenCalledOnce());
  expect(screen.getByText('Copy an image, then paste it onto the canvas.')).toBeVisible();
});

it('converts a multi-file drop to local paths and preserves partial success feedback', async () => {
  render(<App />);
  fireEvent.drop(screen.getByTestId('canvas-host'), dropEventWith(['ok.png', 'bad.gif'], { clientX: 200, clientY: 120 }));
  await waitFor(() => expect(window.referenzio.importDroppedImages).toHaveBeenCalledWith(expect.arrayContaining([
    expect.objectContaining({ name: 'ok.png' }), expect.objectContaining({ name: 'bad.gif' }),
  ])));
  expect(screen.getByText('bad.gif: GIF files are not supported.')).toBeVisible();
});
```

- [ ] **Step 2: Run the composition tests before implementation.**

Run: `npm run test:unit -- src/renderer/App.test.tsx`

Expected: FAIL because the scaffold `App` has no canvas host, bridge interaction, or feedback.

- [ ] **Step 3: Implement the complete renderer composition.**

`ui/TitleBar.tsx` owns the five native-window controls and drag/no-drag regions. `ui/NoticeCenter.tsx` owns saved/saving/unsaved status plus actionable error, recovery, and shortcut messages. `App.tsx` owns focus, keyboard/drop routing, selected-item controls, and composition; it does not duplicate controller persistence or board commands.

Render a 36-pixel top strip with `data-testid="titlebar"` and CSS `app-region: drag`. Its controls use `app-region: no-drag`, exact accessible names `Toggle always on top`, `Open library folder`, `Minimize`, and `Close`; the pin button has `aria-pressed={alwaysOnTop}` and calls `setPinned(!alwaysOnTop)`, the folder calls the controller's error-capturing library action, and minimize/close call their bridge methods. A close failure arrives once through `onMainError`; do not append the returned failure a second time. The content below is `#canvas-host`, has `tabIndex={0}`, receives drop events, and contains `BoardCanvas`. Focus the host after initial load and whenever its canvas receives pointer input, so immediate paste works but a focused title-bar control does not trigger a canvas paste. Render compact selected-item buttons with labels `Send backward`, `Bring forward`, `Send to back`, `Bring to front`, and `Delete selected`; disable all five when no item is selected.

Attach `keydown` to the canvas host, not `window`. Process only `Ctrl+V` (case-insensitive) and `Delete`/`Backspace`; ignore modified delete keys and events from an `HTMLInputElement`, `HTMLTextAreaElement`, button, or contenteditable element. Call `preventDefault()` for handled keys. Paste uses the current visible center calculated by `worldPointForScreenPoint(document.camera, { x: host.clientWidth / 2, y: host.clientHeight / 2 })` and calls `pasteClipboard(point)`. On drag over, prevent default. On drop, prevent default, collect `const files = Array.from(event.dataTransfer.files)` without resolving paths, calculate host-relative screen point `{ x: event.clientX - hostRect.left, y: event.clientY - hostRect.top }`, convert it with the shared function, and call `importDroppedFiles(files, point)`.

Show one `role="status"` line: `Saved`, `Saving…`, or `Unsaved — Retry save` (the last is a button calling `retrySave`). Render errors as `role="alert"` with their literal message and an exact action button: `Retry save`, `Retry close`, `Retry open library`, `Open library folder`, or `Dismiss`; each calls `runErrorAction(error)`. Render a recovery warning and shortcut warning as dismissible alerts. Use high-contrast selected controls and a neutral dark canvas, but no toolbars, dialog, source list, URL input, or feature outside the Scope.

- [ ] **Step 4: Add keyboard, chrome, and feedback coverage.**

Test no automatic clipboard access on render, initial canvas focus, Ctrl+V only while the canvas host owns focus, delete only with selection, disabled z-order controls, restored `aria-pressed` pin state, visible recovery/shortcut warning, close failure feedback, minimize/pin/folder delegation, title bar/controls drag CSS values, host-relative drop coordinate conversion, accepted image placement offset from Task 2, status transitions, error action buttons, and no URL-input or text/annotation controls in the DOM.

- [ ] **Step 5: Run renderer verification.**

Run: `npm run typecheck`

Run: `npm run test:unit -- src/renderer/App.test.tsx`

Expected: both commands exit `0`; all composition and accessibility tests pass.

- [ ] **Step 6: Commit the finished user-facing composition.**

```powershell
git add src/renderer/App.tsx src/renderer/App.test.tsx src/renderer/main.tsx src/renderer/app.css src/renderer/ui
git commit -m "feat: compose Referenzio canvas interface"
```

### Task 10: Prove acceptance and package the Windows app

**Terra routing:** implementer `gpt-5.6-terra` / `high`; reviewer `gpt-5.6-terra` / `high`; final whole-branch reviewer `gpt-5.6-terra` / `xhigh`.

**Files:**

- Create: `tests/e2e/fixtures.ts`, `tests/e2e/app.spec.ts`, `scripts/verify-package.ps1`, `README.md`
- Modify: `package.json`, `playwright.config.ts`

**Consumes:** Tasks 1–9's packaged application, user-visible control labels, `data-testid` values, all shared contracts, and the acceptance requirements from the Spec Verification section.

**Produces:** One commandable acceptance suite and documented installation/verification procedure. `npm run test:acceptance` runs the packaged Electron app through Playwright serially; `npm run verify:package` verifies the unpacked executable and Squirrel installer artifacts without installing them. No later task consumes implementation code.

- [ ] **Step 1: Write focused Electron acceptance tests first.**

```ts
test('an imported asset remains after its original source is deleted and the app restarts', async () => {
  const { source } = await seedBoardFromDroppedFixture(testRoot);
  await rm(source);
  const app = await launchReferenzio({ localAppDataDir: testRoot });
  const page = await app.firstWindow();
  await expect(page.getByTestId('board-canvas')).toHaveAttribute('data-item-count', '1');
  await app.close();
});

test('corrupt primary recovery retains a valid backup', async () => {
  const library = join(testRoot, 'Referenzio', 'library');
  const seeded = await writeBoardAndAssetFixture(library);
  await writeFile(join(library, 'board.json'), '{broken');
  await writeFile(join(library, 'board.backup.json'), JSON.stringify(seeded));
  const app = await launchReferenzio({ localAppDataDir: testRoot });
  const page = await app.firstWindow();
  await expect(page.getByRole('alert')).toContainText('recovered');
  await expect(page.getByTestId('board-canvas')).toHaveAttribute('data-item-count', '1');
  await app.close();
});
```

- [ ] **Step 2: Run the new acceptance file and prove it is absent.**

Run: `npm run test:e2e -- tests/e2e/app.spec.ts`

Expected: FAIL because `tests/e2e/app.spec.ts` does not yet exist.

- [ ] **Step 3: Implement deterministic Electron fixtures and all acceptance cases.**

`fixtures.ts` launches `out\\Referenzio-win32-x64\\Referenzio.exe` with `_electron.launch({ executablePath, env: { ...process.env, LOCALAPPDATA: localAppDataDir } })`, has a deterministic 1×1 PNG byte fixture, exports the exact `unwrap`, `seedBoardFromDroppedFixture`, and `writeBoardAndAssetFixture` helpers used above, and removes only its own `mkdtemp` directory in `afterEach`. `seedBoardFromDroppedFixture` instantiates the real Task 3 persistence service at `path.join(testRoot, 'Referenzio', 'library')`, imports the source through the real Task 4 asset service, builds the item with Task 2's `addItems`, saves and flushes the board, and returns the source path. Do not use Chromium's `--user-data-dir`; the application library contract is driven by `LOCALAPPDATA`. Add `pretest:acceptance` equal to `npm run package:test` and `test:acceptance` equal to `playwright test tests/e2e/app.spec.ts --workers=1`. Do not change the system clipboard in automation: Task 4 unit-tests the native clipboard adapter and the README requires a manual real-clipboard validation.

Automate these exact cases with the packaged Electron executable: empty first launch; a board seeded through the real asset and persistence services, source deletion, and restart; board/item/camera persistence after restart; window bounds and pin-state persistence after restart; corrupt-primary/valid-backup recovery; corrupt-primary/corrupt-backup empty recovery without deleting assets; safe asset-protocol success and traversal rejection; a missing asset producing `data-missing-asset-count="1"`; custom top-strip control labels; and a main-process check where `webContents.getLastWebPreferences()` shows context isolation/sandbox enabled and Node integration disabled while `BrowserWindow.isResizable()` is true. Task 4 unit tests prove invalid/oversized rejection, Task 6 unit tests prove real IPC import mapping, Task 5's constructor-option test proves `frame: false` and the global shortcut callback, and Task 8 unit tests prove pointer interactions. The real OS shortcut, clipboard, drag/drop, transform handles, and window-edge hit testing remain explicit manual Windows checks because Playwright cannot prove those OS-level paths without changing global desktop state.

`verify-package.ps1` is non-destructive: it does not install or launch anything. It resolves the repository root from `$PSScriptRoot`, requires exactly one `out\\make\\squirrel.windows\\x64\\*Setup.exe`, requires `out\\Referenzio-win32-x64\\Referenzio.exe`, prints both absolute paths, and exits nonzero with a concrete error if either artifact is absent. Add `verify:package` equal to `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/verify-package.ps1`. `README.md` documents supported import types/size, `Ctrl+Shift+Space`, `Ctrl+V`, drag/drop, selection controls, auto-save/recovery semantics, Open library folder, unreferenced-asset retention, all excluded features, development/test commands, and this manual Windows acceptance checklist: install the generated Squirrel setup; launch it; copy an image in Snipping Tool and then a browser; show Referenzio from another focused app with the shortcut; paste each image; drag in a local PNG/JPEG/WebP; drag/resize/reorder/delete; resize and pin the window; close/reopen; delete a dropped source and reopen; import 50 ordinary 1920×1080 screenshots and confirm pan/zoom remain responsive; inspect the library; copy the entire library to a separate backup folder, corrupt the live `board.json`, and confirm automatic recovery from `board.backup.json`. The manual run records Windows version, installer path, and every item as `PASS` or `FAIL` in the Task 10 report.

- [ ] **Step 4: Run every automated gate and package.**

Run: `npm run typecheck`

Run: `npm run test:unit`

Run: `npm run test:acceptance`

Run: `npm run make`

Run: `npm run verify:package`

Expected: every command exits `0`, unit and acceptance suites have no failures, exactly one Squirrel setup executable plus `out\\Referenzio-win32-x64\\Referenzio.exe` exist, and the verification script prints both absolute paths.

- [ ] **Step 5: Complete the manual Windows acceptance pass.**

Perform every README checklist action on Windows. Record each result in the Task 10 report as `PASS` or `FAIL`, including the exact recovery message and installer path. A `FAIL` enters the normal task review/fix loop; do not label the task complete with a failed acceptance item.

- [ ] **Step 6: Commit verification and documentation.**

```powershell
git add package.json playwright.config.ts tests/e2e scripts/verify-package.ps1 README.md
git commit -m "test: verify Referenzio acceptance and packaging"
```

## Spec Traceability

| Spec requirement | Plan tasks and proof |
| --- | --- |
| One effectively infinite persistent board; serializable own model | 2 defines `BoardDocument`; 3 saves/recovers it; 8 renders camera-transformed independent images; 10 restart tests. |
| Explicit clipboard paste and local raster drop | 4 validates durable input; 6 narrows bridge; 7 schedules commands; 9 keyboard/drop UI; 10 acceptance. |
| PNG/JPEG/WebP only, ≤100 MiB, copied before item references it | 2 constants/contracts; 4 validates, flushes, copies, and tests ordering; 10 deletes source after import. |
| Selection, move, proportional resize, delete placement, front/back | 2 immutable commands/tests; 7 controller; 8 Konva Transformer; 9 controls; 10 restart interaction tests. |
| Pan and pointer-centered clamped zoom | 2 math/tests; 7 state persistence; 8 wheel/pan behavior/tests; 10 restart proof. |
| Frameless resizable window, custom controls, pin, remembered bounds | 3 settings; 5 controller/bounds; 6 bridge; 9 chrome CSS; 10 app/manual packaging validation. |
| Single instance and `Ctrl+Shift+Space`, collision warning | 5 lifecycle and tests; 6 event bridge; 7 subscription; 9 alert; 10 focused controller and manual test. |
| Crash-resistant full-board snapshots and backup recovery | 3 atomic queue/recovery/integration tests; 4 asset durability; 7 unsaved retry; 10 corrupt/interrupted recovery. |
| Safe privileged boundary and library-folder action | 5 asset protocol; 6 Zod IPC/preload/no Node tests; 9 action/error UI; 10 package test. |
| Missing assets, partial imports, actionable errors, no blocking | 3 missing asset discovery; 4 per-file result; 7 save retry; 8 placeholder; 9 alerts/actions; 10 acceptance. |
| Windows install/launch/close/reopen completion boundary | 1 Forge scaffold; 10 Electron tests, installer smoke script, manual pass, and README. |

## Plan Self-Review

- Spec coverage is complete: every Scope, Architecture, Data Model, Library Layout, Ingestion, Canvas Interaction, Window Behavior, Persistence/Recovery, Error Handling, Performance Boundary, Verification, and Completion Boundary requirement maps to a numbered task and a test or manual proof in the traceability table.
- Interface consistency is complete: all later task method names and data shapes are declared in Task 2, Task 3, Task 5, Task 6, or Task 7 before first use, and each cross-task dependency appears in its Consumes/Produces blocks.
- The task sequence has one scaffold task, one domain task, one persistence task, one asset task, one lifecycle/protocol task, one IPC/preload task, one renderer controller task, one Konva task, one composition task, and one acceptance/packaging task. It contains no parallel implementation phase and each task has one commit command.
