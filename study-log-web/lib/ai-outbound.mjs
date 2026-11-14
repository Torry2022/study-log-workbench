import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import { Agent, fetch as undiciFetch } from "undici";

const deepseekChat = "https://api.deepseek.com/chat/completions";
const deepseekModels = "https://api.deepseek.com/models";
const blockedIPv4 = new BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
  ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24],
  ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24],
  ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
]) blockedIPv4.addSubnet(address, prefix);

const globalIPv6 = new BlockList();
globalIPv6.addSubnet("2000::", 3, "ipv6");
const blockedIPv6 = new BlockList();
for (const [address, prefix] of [
  ["2001::", 23], ["2001:db8::", 32], ["2002::", 16], ["3fff::", 20],
]) blockedIPv6.addSubnet(address, prefix, "ipv6");

function publicAddress(address, family) {
  if (isIP(address) !== family || address.includes("%")) return false;
  if (family === 4) return !blockedIPv4.check(address, "ipv4");
  return family === 6 && globalIPv6.check(address, "ipv6") && !blockedIPv6.check(address, "ipv6");
}

function secureUrl(value) {
  const raw = String(value);
  if (/[\s\\#]/.test(raw) || !/^https:\/\//i.test(raw)) return undefined;
  try {
    const url = new URL(raw);
    if (url.username || url.password || url.port && Number(url.port) === 0) return undefined;
    const address = url.hostname.replace(/^\[|\]$/g, "");
    const family = isIP(address);
    if (family && !publicAddress(address, family)) return undefined;
    if (!family && (!address.includes(".") || /\.(?:localhost|local|internal)\.?$/i.test(address))) return undefined;
    return url;
  } catch { return undefined; }
}

function allowedUrls(env) {
  try {
    const values = JSON.parse(env.AI_SETTINGS_ALLOWED_ENDPOINTS || "[]");
    if (!Array.isArray(values)) return new Set();
    return new Set(values.flatMap(value => typeof value === "string" ? secureUrl(value)?.href || [] : []));
  } catch { return new Set(); }
}

/** @param {string | URL} value @param {Record<string,string | undefined>} [env] */
export function remoteEndpointAllowed(value, env = process.env) {
  const url = secureUrl(value);
  return Boolean(url && allowedUrls(env).has(url.href));
}

// Connect to the same validated addresses; do not resolve again after the check.
export function publicDnsLookup(resolve = hostname => lookup(hostname, { all: true })) {
  return (hostname, options, callback) => {
    const failure = () => callback(Object.assign(new Error("无法连接模型服务"), { code: "AI_ENDPOINT_DNS" }), "");
    void resolve(hostname).then(addresses => {
      if (!addresses.length || addresses.some(({ address, family }) => !publicAddress(address, family))) {
        failure();
        return;
      }
      const matches = options.family === 4 || options.family === 6
        ? addresses.filter(item => item.family === options.family)
        : addresses;
      if (!matches.length) { failure(); return; }
      if (options.all) callback(null, matches);
      else callback(null, matches[0].address, matches[0].family);
    }, failure);
  };
}

const directTransport = new Agent({ connect: { lookup: publicDnsLookup() } });

/** @param {string | URL} value @param {RequestInit} [init] @param {Record<string,string | undefined>} [env] @returns {Promise<Response>} */
export async function remoteSafeFetch(value, init, env = process.env) {
  const url = secureUrl(value);
  const allowed = allowedUrls(env);
  const method = (init?.method || "GET").toUpperCase();
  const officialModels = url?.href === deepseekModels && method === "GET" && allowed.has(deepseekChat);
  if (!url || !(allowed.has(url.href) || officialModels)) throw new Error("模型服务地址未获准");
  const headers = new Headers(init?.headers);
  headers.delete("host");
  return undiciFetch(url.href, { ...init, headers: Array.from(headers.entries()), redirect: "error", dispatcher: directTransport });
}
