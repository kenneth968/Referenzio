import { expect, test } from '@playwright/test';
import { closeReferenzio, launchReferenzio, withTestRoot } from './fixtures';

test('launches the packaged Referenzio shell', async () => {
  await withTestRoot(async (localAppData) => {
    let app: Awaited<ReturnType<typeof launchReferenzio>> | undefined;
    try {
      app = await launchReferenzio(localAppData);
      const page = await app.firstWindow();
      await expect(page).toHaveTitle('Referenzio');
      await expect(page.getByTestId('canvas-host')).toBeVisible();
    } finally { await closeReferenzio(app); }
  });
});
