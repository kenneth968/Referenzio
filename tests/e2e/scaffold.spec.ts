import { _electron as electron, expect, test } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

test('launches the packaged Referenzio shell', async () => {
  const localAppData = await mkdtemp(path.join(tmpdir(), 'referenzio-e2e-'));
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined;
  try {
    app = await electron.launch({
      executablePath: path.resolve('out', 'Referenzio-win32-x64', 'Referenzio.exe'),
      env: { ...process.env, LOCALAPPDATA: localAppData },
    });
    const page = await app.firstWindow();
    await expect(page).toHaveTitle('Referenzio');
    await expect(page.getByText('Referenzio')).toBeVisible();
  } finally {
    await app?.close();
    await rm(localAppData, { recursive: true, force: true });
  }
});
