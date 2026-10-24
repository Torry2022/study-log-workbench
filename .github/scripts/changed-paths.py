import os
import re
import subprocess

base = os.environ.get("BASE_SHA", "")
full = not re.fullmatch(r"[0-9a-f]{40}", base) or base == "0" * 40
if not full:
    full = subprocess.run(["git", "cat-file", "-e", base + "^{commit}"], capture_output=True).returncode != 0
paths = [] if full else subprocess.check_output(["git", "diff", "--no-renames", "--name-only", "-z", base, "HEAD"]).decode("utf-8").split("\0")[:-1]
full = full or any(p.startswith(".github/") or p in {"AGENTS.md", "package.json", "package-lock.json"} for p in paths)
shared = {"ops/instance.mjs", "ops/archive.mjs", "ops/archive-cli.mjs", "ops/service.mjs", "ops/serve.mjs"}
web = full or any(p.startswith(("study-log-web/", "study-log-mcp/", "prompts/")) or p in shared for p in paths)
mcp = full or any(p.startswith("study-log-mcp/") for p in paths)
harmony = full or any(p.startswith(("study-log-harmony/", "study-log-web/lib/", "study-log-web/app/api/")) for p in paths)
ops = full or any(p.startswith(("ops/", "prompts/", "study-log-web/lib/")) for p in paths)
with open(os.environ["GITHUB_OUTPUT"], "a", encoding="utf-8") as output:
    for name, enabled in {"web": web, "mcp": mcp, "harmony": harmony, "ops": ops}.items():
        output.write(f"{name}={str(enabled).lower()}\n")
print({"full": full, "paths": paths, "web": web, "mcp": mcp, "harmony": harmony, "ops": ops})
