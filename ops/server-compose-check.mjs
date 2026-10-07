import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

// Parse both real Compose entrypoints; do not start containers or read instance secrets.
const execute = promisify(execFile);
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "study-log-compose-check-"));
const emptyEnv = path.join(temporary, "empty.env");
await fs.writeFile(emptyEnv, "");
const env = { ...process.env, IMAGE_PREFIX: "example.invalid/study-log", RELEASE_VERSION: "test-fixed",
  INSTANCE_PARENT: temporary, INSTANCE_ROOT: path.join(temporary, "instance"), WEB_PORT: "3560" };
const config = async (file, environment = env) => JSON.parse((await execute("docker", ["compose", "--env-file", emptyEnv,
  "--profile", "*", "-p", "study-log-compose-check", "-f", file, "config", "--no-env-resolution", "--format", "json"],
  { env: environment, windowsHide: true, maxBuffer: 1024 * 1024 })).stdout);
try {
  const source = await config("compose.yaml"), release = await config("deploy/compose.yaml");
  assert.deepEqual(Object.keys(release.services).sort(), Object.keys(source.services).sort());
  for (const [name, service] of Object.entries(release.services)) {
    assert.equal(service.build, undefined, "User entry must never build source");
    assert.equal(service.image, `example.invalid/study-log/${name === "study-log-mcp" ? "mcp" : name}:test-fixed`);
    const original = { ...source.services[name] };
    delete original.build; delete original.image;
    const runtime = { ...service }; delete runtime.image;
    assert.deepEqual(runtime, original, `${name}: runtime settings drifted from source Compose`);
  }
  assert.equal(release.services.web.ports[0].host_ip, "127.0.0.1");
  assert.equal(release.services["study-log-mcp"].ports, undefined);
  for (const variable of ["IMAGE_PREFIX", "RELEASE_VERSION", "INSTANCE_ROOT", "INSTANCE_PARENT"]) {
    await assert.rejects(config("deploy/compose.yaml", { ...env, [variable]: "" }), variable);
  }
  console.log("PASS prebuilt-only Compose, paired version, runtime parity, loopback isolation and required settings");
} finally { await fs.unlink(emptyEnv); await fs.rmdir(temporary); }
