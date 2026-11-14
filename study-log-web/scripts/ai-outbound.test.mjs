import assert from "node:assert/strict";
import dns from "node:dns/promises";
import { syncBuiltinESMExports } from "node:module";
import { createServer } from "node:net";
import test from "node:test";
import { Agent, MockAgent } from "undici";
import { publicDnsLookup, remoteEndpointAllowed, remoteSafeFetch } from "../lib/ai-outbound.ts";

const envFor = (...urls) => ({ AI_SETTINGS_ALLOWED_ENDPOINTS: JSON.stringify(urls) });
const target = "https://model.example.invalid/v1/chat/completions?instance=synthetic";
const official = "https://api.deepseek.com/chat/completions";

test("remote endpoints require an exact HTTPS URL and do not accept credentials or special addresses", async () => {
  const env = envFor(target, official);
  assert.equal(remoteEndpointAllowed(target, env), true);
  for (const url of [target.split("?")[0], target + "&next=1", target + "#fragment",
    target.replace("https", "http"), target.replace("/v1/", "/v2/"), target.replace("model.", "other."),
    "https://key@model.example.invalid/v1/chat/completions", "https://127.1/v1", "https://2130706433/v1",
    "https://[::ffff:127.0.0.1]/v1", "https://169.254.169.254/v1", "https://[fd00:ec2::254]/v1",
    "https://[2001:db8::1]/v1", "https://localhost/v1", "https://service.local/v1",
  ]) {
    assert.equal(remoteEndpointAllowed(url, env), false, url);
    await assert.rejects(remoteSafeFetch(url, undefined, env), /地址未获准/);
  }
  assert.equal(remoteEndpointAllowed(target, { AI_SETTINGS_ALLOWED_ENDPOINTS: "malformed" }), false);
  for (const url of ["https://127.1/v1", "https://[::ffff:127.0.0.1]/v1", "https://169.254.169.254/v1"]) {
    assert.equal(remoteEndpointAllowed(url, envFor(url)), false);
  }
});

function resolveForSocket(resolve, options = { all: true }) {
  const pinned = publicDnsLookup(resolve);
  return new Promise((res, reject) => pinned("model.example.invalid", options, (error, address, family) => {
    if (error) reject(error);
    else res({ address, family });
  }));
}

test("socket lookup returns the same validated DNS answer without a second resolution", async () => {
  let resolutions = 0;
  const addresses = [{ address: "8.8.4.4", family: 4 }, { address: "2606:4700:4700::1111", family: 6 }];
  const resolve = async hostname => {
    assert.equal(hostname, "model.example.invalid");
    return ++resolutions === 1 ? addresses : [{ address: "127.0.0.1", family: 4 }];
  };
  assert.deepEqual(await resolveForSocket(resolve), { address: addresses, family: undefined });
  assert.equal(resolutions, 1);
  await assert.rejects(resolveForSocket(resolve), { code: "AI_ENDPOINT_DNS" });
  assert.deepEqual(await resolveForSocket(async () => addresses, { family: 6 }), { address: addresses[1].address, family: 6 });
});

test("a mixed public and private DNS result is rejected before selecting an address", async () => {
  for (const [address, family] of [["10.0.0.1", 4], ["100.100.100.200", 4], ["169.254.169.254", 4],
    ["192.168.0.2", 4], ["224.0.0.1", 4], ["::1", 6], ["::ffff:8.8.8.8", 6],
    ["fe80::a%2", 6], ["64:ff9b::a00:1", 6], ["2002:a00:1::", 6], ["3fff::1", 6],
  ]) {
    await assert.rejects(resolveForSocket(async () => [{ address: "8.8.8.8", family: 4 }, { address, family }], { family: 4 }), { code: "AI_ENDPOINT_DNS" });
  }
  await assert.rejects(resolveForSocket(async () => []), { code: "AI_ENDPOINT_DNS" });
  await assert.rejects(resolveForSocket(async () => { throw new Error("synthetic DNS error"); }), { code: "AI_ENDPOINT_DNS" });
});

test("real dispatch rejects private DNS before a socket receives a connection", async t => {
  let connections = 0;
  const server = createServer(socket => { connections++; socket.destroy(); });
  await new Promise((res, reject) => server.once("error", reject).listen(0, "127.0.0.1", res));
  const calls = [];
  t.mock.method(dns, "lookup", async (hostname, options) => {
    calls.push({ hostname, options });
    return [{ address: "127.0.0.1", family: 4 }];
  });
  syncBuiltinESMExports();
  try {
    const url = `https://model.example.invalid:${server.address().port}/v1/chat/completions`;
    const init = { method: "POST", headers: { Authorization: "Bearer synthetic-never-sent" }, body: "{}" };
    await assert.rejects(remoteSafeFetch(url, init, envFor(url)), error => error.cause?.code === "AI_ENDPOINT_DNS");
    await assert.rejects(remoteSafeFetch("https://api.deepseek.com/models", { method: "GET" }, envFor(official)), error => error.cause?.code === "AI_ENDPOINT_DNS");
    await assert.rejects(remoteSafeFetch("https://api.deepseek.com/models", init, envFor(official)), /地址未获准/);
    assert.deepEqual(calls, ["model.example.invalid", "api.deepseek.com"].map(hostname => ({ hostname, options: { all: true } })));
    assert.equal(connections, 0);
  } finally {
    t.mock.restoreAll();
    syncBuiltinESMExports();
    await new Promise(resolve => server.close(resolve));
  }
});

test("a provider redirect is refused even when the destination is separately allowed", async t => {
  const mockTransport = new Agent();
  mockTransport.dispatch = Agent.prototype.dispatch.bind(mockTransport);
  const dispatcher = new MockAgent({ agent: mockTransport });
  dispatcher.disableNetConnect();
  const source = new URL(target);
  const redirect = "https://elsewhere.example.invalid/v1/chat/completions";
  dispatcher.get(source.origin).intercept({ method: "POST", path: source.pathname + source.search })
    .reply(307, "", { headers: { location: redirect } });
  const destinations = [];
  t.mock.method(Agent.prototype, "dispatch", function (options, handler) {
    destinations.push(String(options.origin));
    return dispatcher.dispatch(options, handler);
  });
  try {
    await assert.rejects(remoteSafeFetch(target, {
      method: "POST", redirect: "follow", headers: { Authorization: "Bearer synthetic-never-redirected" }, body: "{}",
    }, envFor(target, redirect)), error => /redirect/i.test(error.cause?.message || ""));
    assert.deepEqual(destinations, [source.origin]);
    dispatcher.assertNoPendingInterceptors();
  } finally {
    t.mock.restoreAll();
    await dispatcher.close();
  }
});
