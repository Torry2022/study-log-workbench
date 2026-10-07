import { createRequire } from 'node:module';
const require = createRequire(new URL('../../study-log-web/package.json', import.meta.url));
const { expect } = require('@playwright/test');
export async function workspacePage(application) {
  await expect.poll(() => application.context().pages().some(page => !page.isClosed() && /^http:\/\//.test(page.url())), { timeout: 60000 }).toBe(true);
  const page = application.context().pages().find(page => !page.isClosed() && /^http:\/\//.test(page.url()));
  page.on('dialog', () => {});
  await expect(page.locator('.workspace')).toBeVisible({ timeout: 60000 });
  return page;
}
