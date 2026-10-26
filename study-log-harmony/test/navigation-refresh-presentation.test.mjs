import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const source=await readFile(new URL('../entry/src/main/ets/features/logs/components/LogNavigation.ets',import.meta.url),'utf8');
const condition=source.split('\n').find(line=>line.includes('if (this.navigationLoading &&')).trim().slice(4,-3).replace(': DaySummary','');
const placeholder=new Function(`return ${condition};`);
test('navigation refresh keeps existing current-month rows; an unread month still shows loading',()=>{
  const h={navigationLoading:true,navigationMonth:'2026-08',navigationDays:[{date:'2026-08-16'}]};
  assert.equal(placeholder.call(h),false);
  h.navigationMonth='2026-07';assert.equal(placeholder.call(h),true);
  h.navigationDays=[];assert.equal(placeholder.call(h),true);
  h.navigationLoading=false;assert.equal(placeholder.call(h),false);
  assert.ok(source.indexOf('if (this.navigationError)')<source.indexOf('if (this.navigationLoading &&'),'an error is rendered independently of the existing rows');
});
