import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { workspacePage } from './workspace-test.mjs';
const require = createRequire(new URL('../../study-log-web/package.json', import.meta.url));
const { _electron: electron } = require('@playwright/test');
const er = createRequire(new URL('./package.json', import.meta.url));
const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'exit-reopen-'));
const evidence = path.resolve('.local', `exit-reopen-${Date.now()}`);
await fs.mkdir(evidence);
const env = { ...process.env, STUDY_LOG_DESKTOP_PROFILE: profile }; delete env.ELECTRON_RUN_AS_NODE;
const launch = () => electron.launch({ executablePath: process.argv[2] || er('electron'), args: process.argv[2] ? [] : [path.resolve('ops/electron')], env, timeout: 60000 });
let app;
try {
  app = await launch(); const page = await workspacePage(app);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1280, 800));
  const resultFile = path.join(evidence, 'lifecycle.json');
  await app.evaluate(async ({ app, BrowserWindow }, resultFile) => {
    const fs = process.getBuiltinModule('fs');
    const result = { errors: [], relaunches: 0, allWindowsClosed: false };
    // Exercise the real handler exactly after destruction, while shutdown is pending.
    BrowserWindow.getAllWindows()[0].once('closed', () => {
      for (let i = 0; i < 3; i++) {
        try { app.emit('second-instance', {}, [], process.cwd()); }
        catch (error) { result.errors.push(error.message); }
      }
      fs.writeFileSync(resultFile, JSON.stringify(result));
    });
    // Capture relaunch intent without leaving an unattended acceptance process.
    app.relaunch = () => {
      result.relaunches++;
      result.allWindowsClosed = BrowserWindow.getAllWindows().length === 0;
      fs.writeFileSync(resultFile, JSON.stringify(result));
    };
  }, resultFile);
  const closed = app.waitForEvent('close', { timeout: 60000 });
  await page.getByRole('button', { name: '退出', exact: true }).click();
  await closed; app = null;
  const lifecycle = JSON.parse(await fs.readFile(resultFile, 'utf8'));
  assert.deepEqual(lifecycle.errors, []);
  assert.equal(lifecycle.relaunches, 1);
  assert.equal(lifecycle.allWindowsClosed, true);
  // A real subsequent launch of the same instance verifies normal lock release.
  app = await launch(); await workspacePage(app);
  await app.evaluate(({ app }) => app.emit('second-instance', {}, [], process.cwd()));
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 1);
  await fs.writeFile(path.join(evidence, 'report.json'), JSON.stringify({ passed: true, lifecycle, profile }));
  console.log(evidence);
} finally {
  if (app) { const closed = app.waitForEvent('close', { timeout: 60000 }); await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(w => w.close())); await closed; }
}
