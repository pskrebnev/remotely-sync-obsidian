// Fails when a runtime dependency has a high or critical advisory
// that is not reviewed in scripts/audit-allowlist.json.
// Usage: node scripts/check-audit.mjs
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const BLOCKING = new Set(["high", "critical"]);

const allowlist = JSON.parse(
  readFileSync(new URL("./audit-allowlist.json", import.meta.url), "utf8")
);
const allowed = new Map(allowlist.advisories.map((a) => [a.url, a]));

let raw;
try {
  raw = execFileSync("npm", ["audit", "--omit=dev", "--json"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
} catch (e) {
  // npm audit exits non-zero when it finds anything
  raw = e.stdout;
}
const report = JSON.parse(raw);
if (report.error) {
  console.error(`npm audit failed: ${JSON.stringify(report.error)}`);
  process.exit(2);
}

const advisories = new Map();
for (const v of Object.values(report.vulnerabilities ?? {})) {
  for (const via of v.via) {
    if (typeof via === "object" && !advisories.has(via.url)) {
      advisories.set(via.url, via);
    }
  }
}

const blocking = [];
for (const a of advisories.values()) {
  const status = !BLOCKING.has(a.severity)
    ? "info"
    : allowed.has(a.url)
      ? "accepted"
      : "BLOCKING";
  console.log(
    `${status.padEnd(9)} ${a.severity.padEnd(9)} ${a.name}: ${a.title} (${a.url})`
  );
  if (status === "BLOCKING") {
    blocking.push(a);
  }
}
for (const url of allowed.keys()) {
  if (!advisories.has(url)) {
    console.log(
      `note: allowlisted advisory no longer reported, remove it: ${url}`
    );
  }
}

if (blocking.length > 0) {
  console.error(
    `\n${blocking.length} unreviewed high/critical advisory(ies). Fix them, or review and add them to scripts/audit-allowlist.json.`
  );
  process.exit(1);
}
console.log(
  "\naudit ok: no unreviewed high/critical advisories in runtime dependencies"
);
