#!/usr/bin/env node

// Per-repository verification — example skeleton. Replace with your
// repository's real checks. Must exit non-zero on failure.
// SKIPs honestly while the adopter has not added a check.js yet.

import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const checkScript = path.join(dir, "check.js");
if (!existsSync(checkScript)) {
  console.log("  [SKIP] example repository: add a check.js to activate its checks");
  process.exit(0);
}

const result = spawnSync(process.execPath, [checkScript], { stdio: "inherit" });
process.exit(result.error ? 1 : (result.status ?? 1));
