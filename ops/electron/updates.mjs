export const releasesUrl = 'https://api.github.com/repos/Torry2022/study-log-workbench-public/releases?per_page=100';
const releasePage = 'https://github.com/Torry2022/study-log-workbench-public/releases/tag/';

export function parseVersion(value) {
  if (typeof value !== 'string' || value.length > 100) return null;
  const match = /^(?:v)?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.exec(value);
  if (!match) return null;
  const parts = match.slice(1, 4).map(Number), pre = match[4]?.split('.') || [];
  if (parts.some(n => !Number.isSafeInteger(n)) || pre.some(p => /^\d+$/.test(p) && (p.length > 1 && p[0] === '0' || !Number.isSafeInteger(Number(p))))) return null;
  return { parts, pre };
}

export function compareVersions(a, b) {
  const x = parseVersion(a), y = parseVersion(b);
  if (!x || !y) throw Error('无效版本号');
  for (let i = 0; i < 3; i++) if (x.parts[i] !== y.parts[i]) return Math.sign(x.parts[i] - y.parts[i]);
  if (!x.pre.length || !y.pre.length) return x.pre.length ? -1 : y.pre.length ? 1 : 0;
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    if (x.pre[i] === y.pre[i]) continue;
    if (x.pre[i] === undefined) return -1;
    if (y.pre[i] === undefined) return 1;
    const xn = /^\d+$/.test(x.pre[i]), yn = /^\d+$/.test(y.pre[i]);
    if (xn && yn) return Math.sign(Number(x.pre[i]) - Number(y.pre[i]));
    if (xn !== yn) return xn ? -1 : 1;
    return x.pre[i] > y.pre[i] ? 1 : -1;
  }
  return 0;
}

export async function checkForUpdate(current, request = fetch) {
  const version = parseVersion(current);
  if (!version) throw Error('无法识别当前版本，请到项目发布页面查看。');
  const response = await request(releasesUrl, { headers: { Accept: 'application/vnd.github+json' }, redirect: 'error', signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw Error(response.status === 403 || response.status === 429 ? '检查过于频繁，请稍后重试。' : '暂时无法检查更新，请稍后重试。');
  const releases = await response.json();
  if (!Array.isArray(releases)) throw Error('版本信息读取失败，请稍后重试。');
  const available = releases.filter(r => r && !r.draft && parseVersion(r.tag_name)
    && (version.pre.length || (!r.prerelease && !parseVersion(r.tag_name).pre.length))
    && Array.isArray(r.assets) && r.assets.some(a => /^study-log-desktop-[0-9A-Za-z.+-]+-x64-setup\.exe$/.test(a?.name || '')));
  available.sort((a, b) => compareVersions(b.tag_name, a.tag_name));
  const latest = available[0];
  if (!latest) throw Error('暂未找到适用的 Windows 版本，请稍后重试。');
  if (compareVersions(latest.tag_name, current) <= 0) return null;
  return { version: latest.tag_name.replace(/^v/, ''), url: releasePage + encodeURIComponent(latest.tag_name),
    notes: typeof latest.body === 'string' ? latest.body.slice(0, 4000) : '' };
}
