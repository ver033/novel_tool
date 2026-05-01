import { readFile } from "node:fs/promises";

const forbiddenPackages = new Set(["plain-crypto-js", "form-data-validator"]);
const forbiddenAxiosVersions = new Set(["1.14.1", "0.30.4"]);
const allowedAxiosVersion = "1.15.2";

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

  if (packageName === "axios") {
    if (version !== allowedAxiosVersion) {
      failures.push(`Axios must be ${allowedAxiosVersion}; found ${version ?? "unknown"}`);
    }
    if (forbiddenAxiosVersions.has(version)) {
      failures.push(`Known malicious Axios version present: axios@${version}`);
    }
  }
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log("Lockfile safety scan passed.");
