import { createRequire } from 'node:module';
const require = createRequire(new URL('../../study-log-web/package.json', import.meta.url));
const { expect } = require('@playwright/test');
export async function workspacePage(application) {
  await expect.poll(() => application.context().pages().some(page => !page.isClosed() && (/^https?:/.test(page.url()) || page.url().includes('connection.html'))), { timeout: 60000 }).toBe(true);
  const chooser = application.context().pages().find(page => !page.isClosed() && page.url().includes('connection.html'));
  if (chooser) {
    if (await chooser.getByRole('heading', { name: '选择使用方式' }).isVisible()) {
      await chooser.getByText('在这台电脑使用', { exact: false }).click();
      const { root } = await chooser.evaluate(() => window.connection.read());
      await application.evaluate(({ dialog }, root) => { globalThis.originalFolderDialog = dialog.showOpenDialog; dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [root] }); }, root);
      await chooser.getByRole('button', { name: '选择文件夹', exact: true }).click();
      await application.evaluate(({ dialog }) => { dialog.showOpenDialog = globalThis.originalFolderDialog; });
      if (await chooser.getByRole('button', { name: '继续', exact: true }).isVisible()) {
        await chooser.getByRole('button', { name: '继续', exact: true }).click();
        await chooser.getByRole('button', { name: '稍后设置', exact: true }).click();
      } else await chooser.getByRole('button', { name: '打开本地工作台', exact: true }).click();
    } else await chooser.getByRole('button', { name: '打开本地工作台', exact: true }).click();
  }
  await expect.poll(() => application.context().pages().some(page => !page.isClosed() && /^https?:\/\//.test(page.url())), { timeout: 60000 }).toBe(true);
  const page = application.context().pages().find(page => !page.isClosed() && /^https?:\/\//.test(page.url()));
  page.on('dialog', () => {});
  await expect(page.locator('.workspace')).toBeVisible({ timeout: 60000 });
  return page;
}
