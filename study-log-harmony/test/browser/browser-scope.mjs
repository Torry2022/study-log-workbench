import { after } from 'node:test';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../../study-log-web/package.json', import.meta.url));
const engine = process.env.BROWSER_ENGINE || 'chromium';
if (!['chromium', 'webkit'].includes(engine)) throw Error('Unknown test browser');
const launcher = require('@playwright/test')[engine];
let browserPromise;
after(async () => { if (browserPromise) await (await browserPromise).close(); });
export async function createBrowserScope() {
  browserPromise ||= launcher.launch({ headless: true });
  const browser = await browserPromise, contexts = [];
  return {
    async newPage(options = {}) {
      const context = await browser.newContext({ ...options, serviceWorkers: 'block' });
      contexts.push(context); await context.route(/^https?:\/\//, route => route.abort());
      return context.newPage();
    },
    async close() { await Promise.all(contexts.splice(0).map(context => context.close())); }
  };
}
