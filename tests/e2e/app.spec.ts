import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { access, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import {
  closeReferenzio,
  launchReferenzio,
  readPersistedBoard,
  seedBoardFromDroppedFixture,
  seedBoardFromDroppedFixtures,
  seedPortraitJpegFixture,
  withTestRoot,
  writeBoardAndAssetFixture,
} from './fixtures';

async function close(app: ElectronApplication | undefined): Promise<void> { await closeReferenzio(app); }
async function waitForSaved(page: Page): Promise<void> { await expect(page.getByRole('status')).toContainText('Saved'); }
async function canvasBounds(page: Page) {
  const bounds = await page.getByTestId('board-canvas').boundingBox();
  if (!bounds) throw new Error('Canvas is not visible.');
  return bounds;
}
async function samplePixel(page: Page, x: number, y: number): Promise<[number, number, number, number]> {
  const image = sharp(await page.screenshot());
  const metadata = await image.metadata();
  const raw = await image.ensureAlpha().raw().toBuffer();
  const ratio = await page.evaluate(() => window.devicePixelRatio);
  const width = metadata.width ?? 0;
  const offset = (Math.floor(y * ratio) * width + Math.floor(x * ratio)) * 4;
  return [raw[offset], raw[offset + 1], raw[offset + 2], raw[offset + 3]];
}

test('starts an empty packaged app with secure web preferences and final chrome controls', async () => {
  await withTestRoot(async (testRoot) => {
    let app: ElectronApplication | undefined;
    try {
      app = await launchReferenzio(testRoot);
      const page = await app.firstWindow();
      await expect(page).toHaveTitle('Referenzio');
      await expect(page.getByTestId('canvas-host')).toBeVisible();
      await expect(page.getByTestId('board-canvas')).toHaveAttribute('data-item-count', '0');
      await expect(page.getByRole('button', { name: 'Toggle always on top' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Open library folder' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Minimize' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Close' })).toBeVisible();
      const preferences = await app.evaluate(({ BrowserWindow }) => {
        const window = BrowserWindow.getAllWindows()[0];
        const contents = window.webContents as unknown as { getLastWebPreferences(): Record<string, unknown> };
        return { preferences: contents.getLastWebPreferences(), resizable: window.isResizable() };
      });
      expect(preferences.preferences.contextIsolation).toBe(true);
      expect(preferences.preferences.sandbox).toBe(true);
      expect(preferences.preferences.nodeIntegration).toBe(false);
      expect(preferences.resizable).toBe(true);
    } finally { await close(app); }
  });
});

test('an imported asset remains after its original source is deleted and the app restarts', async () => {
  await withTestRoot(async (testRoot) => {
    const { source } = await seedBoardFromDroppedFixture(testRoot);
    await rm(source);
    let app: ElectronApplication | undefined;
    try {
      app = await launchReferenzio(testRoot);
      const page = await app.firstWindow();
      await expect(page.getByTestId('board-canvas')).toHaveAttribute('data-item-count', '1');
      await waitForSaved(page);
    } finally { await close(app); }
    app = await launchReferenzio(testRoot);
    try { await expect((await app.firstWindow()).getByTestId('board-canvas')).toHaveAttribute('data-item-count', '1'); }
    finally { await close(app); }
  });
});

test('recovers a valid backup, repairs the primary, and retains it on a second launch', async () => {
  await withTestRoot(async (testRoot) => {
    const { library, document } = await writeBoardAndAssetFixture(testRoot);
    await writeFile(join(library, 'board.json'), '{broken');
    await writeFile(join(library, 'board.backup.json'), JSON.stringify(document));
    let app = await launchReferenzio(testRoot);
    try {
      const page = await app.firstWindow();
      await expect(page.getByText('Recovered the board from its backup copy.')).toBeVisible();
      await expect(page.getByTestId('board-canvas')).toHaveAttribute('data-item-count', '1');
    } finally { await close(app); }
    expect(JSON.parse(await readFile(join(library, 'board.json'), 'utf8'))).toMatchObject({ revision: document.revision });
    app = await launchReferenzio(testRoot);
    try {
      const page = await app.firstWindow();
      await expect(page.getByTestId('board-canvas')).toHaveAttribute('data-item-count', '1');
      await expect(page.getByText('Recovered the board from its backup copy.')).toHaveCount(0);
    } finally { await close(app); }
  });
});

test('corrupt snapshots recover to an empty board without deleting referenced assets', async () => {
  await withTestRoot(async (testRoot) => {
    const { library, document } = await writeBoardAndAssetFixture(testRoot);
    const assetPath = join(library, 'assets', document.assets[0].filename);
    await writeFile(join(library, 'board.json'), '{broken');
    await writeFile(join(library, 'board.backup.json'), '{also broken');
    let app: ElectronApplication | undefined;
    try {
      app = await launchReferenzio(testRoot);
      const page = await app.firstWindow();
      await expect(page.getByText('Board snapshots could not be recovered. Open the library to inspect the preserved files.')).toBeVisible();
      await expect(page.getByTestId('board-canvas')).toHaveAttribute('data-item-count', '0');
    } finally { await close(app); }
    await expect(access(assetPath)).resolves.toBeUndefined();
  });
});

test('serves stored assets only through the safe asset protocol', async () => {
  await withTestRoot(async (testRoot) => {
    const { document } = await seedBoardFromDroppedFixture(testRoot);
    let app: ElectronApplication | undefined;
    try {
      app = await launchReferenzio(testRoot);
      const page = await app.firstWindow();
      const results = await page.evaluate(async (filename) => {
        const loads = (source: string) => new Promise<boolean>((resolve) => {
          const image = new Image();
          const timeout = window.setTimeout(() => resolve(false), 2_000);
          image.onload = () => { window.clearTimeout(timeout); resolve(true); };
          image.onerror = () => { window.clearTimeout(timeout); resolve(false); };
          image.src = source;
        });
        return {
          asset: await loads(`referenzio-asset://asset/${encodeURIComponent(filename)}`),
          traversal: await loads('referenzio-asset://asset/%2e%2e%2fboard.json'),
        };
      }, document.assets[0].filename);
      expect(results).toEqual({ asset: true, traversal: false });
    } finally { await close(app); }
  });
});

test('persists pin state and main-window bounds after a packaged restart', async () => {
  await withTestRoot(async (testRoot) => {
    let app = await launchReferenzio(testRoot);
    try {
      const page = await app.firstWindow();
      await page.getByRole('button', { name: 'Toggle always on top' }).click();
      await expect(page.getByRole('button', { name: 'Toggle always on top' })).toHaveAttribute('aria-pressed', 'true');
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setBounds({ x: 80, y: 90, width: 900, height: 650 }));
      await page.waitForTimeout(400);
    } finally { await close(app); }
    app = await launchReferenzio(testRoot);
    try {
      const page = await app.firstWindow();
      await expect(page.getByRole('button', { name: 'Toggle always on top' })).toHaveAttribute('aria-pressed', 'true');
      expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getNormalBounds())).toMatchObject({ width: 900, height: 650 });
    } finally { await close(app); }
  });
});

test('real canvas pointer input changes persisted geometry, camera, z-order, and survives restart', async () => {
  await withTestRoot(async (testRoot) => {
    const seeded = await seedBoardFromDroppedFixtures(testRoot, 2);
    let app: ElectronApplication | undefined;
    try {
      app = await launchReferenzio(testRoot);
      const page = await app.firstWindow();
      const faults: string[] = [];
      page.on('pageerror', (error) => faults.push(error.message));
      page.on('console', (message) => { if (message.type() === 'error') faults.push(message.text()); });
      await expect(page.locator('[data-testid="board-canvas"] canvas')).toHaveCount(2);
      // The second placement is on top of the deliberately overlapping seed.
      const first = seeded.document.items[1];
      const bounds = await canvasBounds(page);
      const firstCenter = { x: bounds.x + first.x + first.width / 2, y: bounds.y + first.y + first.height / 2 };
      await expect.poll(() => samplePixel(page, firstCenter.x, firstCenter.y).then((pixel) => pixel[3])).toBe(255);
      expect((await samplePixel(page, firstCenter.x, firstCenter.y))[2]).toBeGreaterThan(150);

      await page.mouse.move(firstCenter.x, firstCenter.y); await page.mouse.down();
      await page.mouse.move(firstCenter.x + 45, firstCenter.y + 25, { steps: 6 }); await page.mouse.up();
      await waitForSaved(page);
      let persisted = await readPersistedBoard(testRoot);
      const moved = persisted.items.find((item) => item.id === first.id)!;
      expect(moved.x).toBeGreaterThan(first.x + 30); expect(moved.y).toBeGreaterThan(first.y + 10);

      await page.mouse.wheel(0, -120); await waitForSaved(page);
      persisted = await readPersistedBoard(testRoot); expect(persisted.camera.scale).toBeGreaterThan(1);
      await page.keyboard.down('Space'); await page.mouse.move(bounds.x + 40, bounds.y + 40); await page.mouse.down();
      await page.mouse.move(bounds.x + 75, bounds.y + 55, { steps: 5 }); await page.mouse.up(); await page.keyboard.up('Space');
      await waitForSaved(page); persisted = await readPersistedBoard(testRoot); expect(persisted.camera.x).not.toBe(0);

      const panned = persisted.items.find((item) => item.id === first.id)!;
      const pannedCenter = { x: bounds.x + persisted.camera.x + (panned.x + panned.width / 2) * persisted.camera.scale, y: bounds.y + persisted.camera.y + (panned.y + panned.height / 2) * persisted.camera.scale };
      await page.mouse.click(pannedCenter.x, pannedCenter.y); await page.getByRole('button', { name: 'Send to back' }).click(); await waitForSaved(page);
      persisted = await readPersistedBoard(testRoot); expect(persisted.items.find((item) => item.id === first.id)!.zIndex).toBe(0);

      const resized = persisted.items.find((item) => item.id === first.id)!;
      const topLeft = { x: bounds.x + persisted.camera.x + resized.x * persisted.camera.scale, y: bounds.y + persisted.camera.y + resized.y * persisted.camera.scale };
      await page.mouse.move(topLeft.x, topLeft.y); await page.mouse.down();
      await page.mouse.move(topLeft.x - 24, topLeft.y - 12, { steps: 5 }); await page.mouse.up(); await waitForSaved(page);
      persisted = await readPersistedBoard(testRoot);
      const resizedPersisted = persisted.items.find((item) => item.id === first.id)!;
      expect(resizedPersisted.width).toBeGreaterThan(resized.width); expect(resizedPersisted.width / resizedPersisted.height).toBeCloseTo(2, 1);

      await page.getByRole('button', { name: 'Fit board' }).click(); await waitForSaved(page);
      await page.getByTestId('canvas-host').press('Home'); await waitForSaved(page);
      await page.getByRole('button', { name: 'Delete selected' }).click(); await waitForSaved(page);
      persisted = await readPersistedBoard(testRoot); expect(persisted.items).toHaveLength(1); expect(faults).toEqual([]);
    } finally { await close(app); }
    const persisted = await readPersistedBoard(testRoot);
    app = await launchReferenzio(testRoot);
    try {
      const page = await app.firstWindow();
      await expect(page.getByTestId('board-canvas')).toHaveAttribute('data-item-count', String(persisted.items.length));
      const restarted = await readPersistedBoard(testRoot);
      expect(restarted.camera).toEqual(persisted.camera);
      expect(restarted.items.map(({ id, x, y, width, height, zIndex }) => ({ id, x, y, width, height, zIndex })))
        .toEqual(persisted.items.map(({ id, x, y, width, height, zIndex }) => ({ id, x, y, width, height, zIndex })));
      const bounds = await canvasBounds(page);
      const visible = persisted.items[0];
      const center = {
        x: bounds.x + persisted.camera.x + (visible.x + visible.width / 2) * persisted.camera.scale,
        y: bounds.y + persisted.camera.y + (visible.y + visible.height / 2) * persisted.camera.scale,
      };
      await expect.poll(() => samplePixel(page, center.x, center.y).then((pixel) => pixel[3])).toBe(255);
    }
    finally { await close(app); }
  });
});

test('a missing placeholder can be selected and deleted through the real canvas controls', async () => {
  await withTestRoot(async (testRoot) => {
    const seeded = await seedBoardFromDroppedFixture(testRoot);
    await rm(join(seeded.library, 'assets', seeded.document.assets[0].filename));
    let app: ElectronApplication | undefined;
    try {
      app = await launchReferenzio(testRoot); const page = await app.firstWindow();
      await expect(page.getByTestId('board-canvas')).toHaveAttribute('data-missing-asset-count', '1');
      const bounds = await canvasBounds(page); const item = seeded.document.items[0];
      await page.mouse.click(bounds.x + item.x + item.width / 2, bounds.y + item.y + item.height / 2);
      await page.getByRole('button', { name: 'Delete selected' }).click(); await waitForSaved(page);
      await expect(page.getByTestId('board-canvas')).toHaveAttribute('data-item-count', '0');
    } finally { await close(app); }
  });
});

test('an EXIF-oriented portrait JPEG renders with its displayed 2:1 aspect ratio', async () => {
  await withTestRoot(async (testRoot) => {
    const seeded = await seedPortraitJpegFixture(testRoot);
    let app: ElectronApplication | undefined;
    try {
      app = await launchReferenzio(testRoot); const page = await app.firstWindow();
      await expect(page.getByTestId('board-canvas')).toHaveAttribute('data-item-count', '1');
      const item = seeded.document.items[0]; expect(item.width / item.height).toBeCloseTo(2, 5);
      const bounds = await canvasBounds(page);
      await expect.poll(() => samplePixel(page, bounds.x + 500, bounds.y + 350).then((pixel) => pixel[3])).toBe(255);
    } finally { await close(app); }
  });
});
