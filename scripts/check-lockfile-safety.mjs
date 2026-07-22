import { readFile } from "node:fs/promises";

const forbiddenPackages = new Set(["plain-crypto-js", "form-data-validator"]);
const forbiddenVersions = new Map([
  ["axios", new Set(["1.14.1", "0.30.4"])],
  ["lightningcss-darwin-arm64", new Set(["1.30.2"])],
  ["zod-to-json-schema", new Set(["3.25.1", "3.25.2"])],
]);
const requiredVersions = new Map([
  ["@earendil-works/pi-agent-core", new Set(["0.80.10"])],
  ["@earendil-works/pi-ai", new Set(["0.80.10"])],
  ["axios", new Set(["1.18.1"])],
  ["vite", new Set(["8.1.5"])],
  ["zod-to-json-schema", new Set(["3.25.0"])],
]);
const allowedInstallScripts = new Map([
  ["@google/genai", new Set(["1.52.0"])],
  ["better-sqlite3", new Set(["12.8.0"])],
  ["electron", new Set(["41.1.1"])],
  ["electron-winstaller", new Set(["5.4.0"])],
  ["fs-xattr", new Set(["0.3.1"])],
  ["fsevents", new Set(["2.3.2", "2.3.3"])],
  ["macos-alias", new Set(["0.2.12"])],
  ["protobufjs", new Set(["7.6.5"])],
]);
const npmRegistryPrefix = "https://registry.npmjs.org/";

const lockfilePath = new URL("../package-lock.json", import.meta.url);
const raw = await readFile(lockfilePath, "utf8");
const lockfile = JSON.parse(raw);
const packages = lockfile.packages ?? {};

const failures = [];

function packageNameFromLockPath(path) {
  if (!path || path === "") {
    return "";
  }
  return path.includes("node_modules/")
    ? path.split("node_modules/").at(-1)
    : path;
}

for (const [path, entry] of Object.entries(packages)) {
  const packageName = packageNameFromLockPath(path);
  const version = entry?.version;

  if (forbiddenPackages.has(packageName)) {
    failures.push(`Forbidden package present: ${packageName}@${version ?? "unknown"}`);
  }

  if (forbiddenVersions.get(packageName)?.has(version)) {
    failures.push(`Forbidden package version present: ${packageName}@${version}`);
  }

  const allowedVersions = requiredVersions.get(packageName);
  if (allowedVersions && !allowedVersions.has(version)) {
    failures.push(
      `${packageName} must be one of ${[...allowedVersions].join(", ")}; found ${version ?? "unknown"}`,
    );
  }

  if (entry?.resolved) {
    if (!entry.resolved.startsWith(npmRegistryPrefix)) {
      failures.push(`Non-registry dependency source: ${packageName}@${version} -> ${entry.resolved}`);
    }
    if (!entry.integrity) {
      failures.push(`Registry dependency is missing integrity: ${packageName}@${version}`);
    }
  }

  if (entry?.hasInstallScript && !allowedInstallScripts.get(packageName)?.has(version)) {
    failures.push(`Unreviewed install script: ${packageName}@${version ?? "unknown"}`);
  }
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log("Lockfile safety scan passed.");
