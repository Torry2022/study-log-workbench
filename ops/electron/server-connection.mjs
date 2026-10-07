// Keep URL policy aligned with Harmony common/network/InstanceConfig.ts.
export function normalizeOrigin(input, allowLocalHttp = false) {
  if (typeof input !== 'string') throw Error('请输入服务器地址');
  const match = /^(https?):\/\/([a-zA-Z0-9.-]+|\[::1\])(?::(\d{1,5}))?(?:\/study-log)?\/?$/.exec(input.trim());
  if (!match) throw new Error('请输入 HTTPS 服务器地址，可包含 /study-log，不含账号或查询参数');
  const host = match[2].toLowerCase();
  if (host.startsWith('.') || host.endsWith('.') || host.includes('..')) throw new Error('服务器地址无效');
  const port = match[3] ? Number(match[3]) : 0;
  if (match[3] && (port < 1 || port > 65535)) throw new Error('端口无效');
  const octets = host.split('.');
  const ipv4 = octets.length === 4 && octets.every((part) => /^(0|[1-9][0-9]{0,2})$/.test(part) && Number(part) <= 255);
  const local = host === 'localhost' || host === '[::1]' || (ipv4 && (Number(octets[0]) === 127 ||
    Number(octets[0]) === 10 || (Number(octets[0]) === 192 && Number(octets[1]) === 168) ||
    (Number(octets[0]) === 172 && Number(octets[1]) >= 16 && Number(octets[1]) <= 31)));
  if (match[1] === 'http' && (!allowLocalHttp || !local)) throw new Error('HTTP 仅允许明确启用的本地或局域网测试地址');
  return `${match[1]}://${host}${port && !((match[1] === 'https' && port === 443) || (match[1] === 'http' && port === 80)) ? ':' + port : ''}`;
}

export function checkCapabilities(value) {
 return value?.apiContractVersion === 1 && /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(value.instanceId || '')
   && ['aiWriting','aiHighlighting','aiNoteExtraction','aiTaxonomy','rag'].every(key => typeof value.features?.[key]?.supported === 'boolean' && typeof value.features?.[key]?.configured === 'boolean');
}
export async function connectServer(value) {
 const origin = normalizeOrigin(value.origin, value.localHttp === true);
 if (typeof value.password !== 'string' || !value.password) throw Error('请输入服务器的访问密码。');
 let response;
 try { response = await fetch(origin + '/study-log/api/auth/login', {method:'POST',redirect:'error',signal:AbortSignal.timeout(10000),headers:{'Content-Type':'application/json'},body:JSON.stringify({password:value.password})}); }
 catch { throw Error('无法连接服务器，请检查地址、网络和 HTTPS 证书。'); }
 if (response.status === 401) throw Error('密码错误，请重新输入。');
 const header = response.headers.get('set-cookie');
 const cookie = header?.split(';')[0];
 const maxAge = Number(/max-age=(\d+)/i.exec(header || '')?.[1] || 0);
 if (!response.ok || !cookie?.startsWith('study_log_session=')) throw Error('服务器登录响应无效。');
 let capabilities;
 try { const result = await fetch(origin + '/study-log/api/capabilities',{redirect:'error',signal:AbortSignal.timeout(10000),headers:{cookie}}); capabilities=result.ok ? await result.json() : null; }
 catch { throw Error('无法读取服务器信息，请稍后重试。'); }
 if (!checkCapabilities(capabilities)) throw Error('服务器不支持当前公开版接口。');
 return {origin,instanceId:capabilities.instanceId,cookie:cookie.slice(cookie.indexOf('=')+1),expirationDate:maxAge > 0 ? Date.now()/1000 + maxAge : undefined};
}
