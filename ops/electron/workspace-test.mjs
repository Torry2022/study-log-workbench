import { createRequire } from 'node:module';
const require = createRequire(new URL('../../study-log-web/package.json', import.meta.url));
const { expect } = require('@playwright/test');
export async function workspacePage(application) {
  await expect.poll(() => application.context().pages().some(page => !page.isClosed() && (/^https?:/.test(page.url()) || page.url().includes('connection.html'))), { timeout: 60000 }).toBe(true);
  const chooser = application.context().pages().find(page => !page.isClosed() && page.url().includes('connection.html'));
  if (chooser) { await chooser.locator('input[value=local]').check(); await chooser.getByRole('button', {name:'打开本地工作台', exact:true}).click(); }
  await expect.poll(() => application.context().pages().some(page => !page.isClosed() && /^https?:\/\//.test(page.url())), { timeout: 60000 }).toBe(true);
  const page = application.context().pages().find(page => !page.isClosed() && /^https?:\/\//.test(page.url()));
  page.on('dialog', () => {});
  await expect(page.locator('.workspace')).toBeVisible({ timeout: 60000 });
  return page;
}
