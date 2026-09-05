import { defineConfig } from '@playwright/test';

export default defineConfig({ testDir: './tests/e2e', testMatch: '**/*.spec.ts', timeout: 30_000, workers: 1 });
