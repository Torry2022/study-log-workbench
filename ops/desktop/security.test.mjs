import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { atomicPrivateFile, privateDirectory, privateFile } from './security.mjs';

const execute = promisify(execFile);
async function fixture(t) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'study-log-private-write-'));
  t.after(async () => {
    assert.equal(path.dirname(base), path.resolve(os.tmpdir()));
    assert.match(path.basename(base), /^study-log-private-write-/);
    await fs.rm(base, { recursive: true, force: true });
  });
  return base;
}
test('atomic private replacement retains contents and cleans its temporary file', async t => {
  const base = await fixture(t), file = path.join(base, '窗口配置-演示.json');
  await atomicPrivateFile(file, 'first'); await atomicPrivateFile(file, 'second');
  assert.equal(await fs.readFile(file, 'utf8'), 'second');
  assert.deepEqual(await fs.readdir(base), [path.basename(file)]);
});
test('a failed rename preserves the destination and removes its empty-file candidate', async t => {
  const base = await fixture(t), destination = path.join(base, 'directory'); await fs.mkdir(destination);
  await assert.rejects(atomicPrivateFile(destination, 'synthetic'));
  assert.deepEqual(await fs.readdir(base), ['directory']); assert.deepEqual(await fs.readdir(destination), []);
});
test('fresh atomic files have exactly the same protected current-user ACL as the existing full ACL setter', { skip: process.platform !== 'win32' }, async t => {
  const base = await fixture(t); await privateDirectory(base);
  await execute('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    "$ErrorActionPreference='Stop'; $acl=[IO.Directory]::GetAccessControl($env:STUDY_LOG_ACL_TEST); $everyone=New-Object Security.Principal.SecurityIdentifier('S-1-1-0'); $rule=New-Object Security.AccessControl.FileSystemAccessRule($everyone,'ReadAndExecute','ContainerInherit,ObjectInherit','None','Allow'); $acl.AddAccessRule($rule); [IO.Directory]::SetAccessControl($env:STUDY_LOG_ACL_TEST,$acl)"
  ], { windowsHide: true, env: { ...process.env, STUDY_LOG_ACL_TEST: base } });
  const native = path.join(base, '新建配置.json'), reference = path.join(base, '旧方法.json');
  await atomicPrivateFile(native, 'synthetic'); await fs.writeFile(reference, 'synthetic'); await privateFile(reference);
  const { stdout } = await execute('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    "$ErrorActionPreference='Stop'; $sid=[Security.Principal.WindowsIdentity]::GetCurrent().User; $result=@(foreach($name in @('新建配置.json','旧方法.json')) { $acl=[IO.File]::GetAccessControl((Join-Path $env:STUDY_LOG_ACL_TEST $name)); $rules=@($acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])); @{protected=$acl.AreAccessRulesProtected; count=$rules.Count; currentUser=($rules[0].IdentityReference -eq $sid); rights=$rules[0].FileSystemRights.ToString(); access=$acl.GetSecurityDescriptorSddlForm([Security.AccessControl.AccessControlSections]::Access)} }); ConvertTo-Json -InputObject $result -Compress"
  ], { windowsHide: true, env: { ...process.env, STUDY_LOG_ACL_TEST: base } });
  const [actual, expected] = JSON.parse(stdout); assert.deepEqual(actual, expected);
  assert.equal(actual.protected, true); assert.equal(actual.count, 1); assert.equal(actual.currentUser, true); assert.equal(actual.rights, 'FullControl');
});
