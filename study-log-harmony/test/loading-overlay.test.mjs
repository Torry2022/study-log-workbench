import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../entry/src/main/ets/app/components/WorkspaceSurface.ets', import.meta.url), 'utf8').then(value => value.replaceAll('\r\n', '\n'));

test('workspace content and preparation hints yield to navigation, search and taxonomy on all sizes', () => {
  const block = source.match(/if \((!this\.sidebar\.navigationOpen && !this\.searchOpen && !this\.modules\.taxonomyOpen)\) \{([\s\S]*?)\n      \}\n      if \(this\.readingTransition\.snapshot\)/);
  assert.ok(block, 'all workspace hints share an overlay visibility boundary');
  assert.equal((block[2].match(/DelayedLoadingHint\(/g) || []).length, 6);
  const visible = new Function(`return (${block[1]});`);
  const state = { sidebar: { navigationOpen: false }, searchOpen: false, modules: { taxonomyOpen: false } };
  assert.equal(visible.call(state), true);
  for (const target of [state.sidebar, state, state.modules]) {
    const key = target === state.sidebar ? 'navigationOpen' : target === state ? 'searchOpen' : 'taxonomyOpen';
    target[key] = true;
    assert.equal(visible.call(state), false);
    target[key] = false;
    assert.equal(visible.call(state), true, 'closing the cover restores still-active content feedback');
  }
  assert.doesNotMatch(block[2], /(?:\.loading\s*=|\.cancel\(|\.clear\()/);
  assert.ok(source.includes('this.navigationOverlay()'));
  assert.ok(source.includes('this.searchOverlay()'));
});

test('content hint anchors and sidebar-owned loading remain mounted independently of the cover', async () => {
  const reader = await readFile(new URL('../entry/src/main/ets/features/logs/LogsReaderPage.ets', import.meta.url), 'utf8');
  const navigation = await readFile(new URL('../entry/src/main/ets/features/logs/components/LogNavigation.ets', import.meta.url), 'utf8');
  assert.ok(reader.includes('LoadingHintAnchor({ loading: true,'));
  assert.ok(reader.includes('onChange: (placement: LoadingHintPlacement) => this.logLoadingHint = placement'));
  assert.ok(navigation.includes('this.navigationLoading'));
  assert.ok(navigation.includes('正在读取'));
});
