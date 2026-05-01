import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = join(__dirname, "..", "..");

function readRepoFile(relativePath: string): string {
  return readFileSync(join(repoRoot, relativePath), "utf8").replace(/\r\n/g, "\n");
}

describe("app shell configuration", () => {
  it("opens the desktop window at the larger Windows-friendly default size", () => {
    const mainSource = readRepoFile("src/main/index.ts");

    expect(mainSource).toContain("width: 1600");
    expect(mainSource).toContain("height: 1000");
    expect(mainSource).toContain("minWidth: 1120");
    expect(mainSource).toContain("minHeight: 760");
  });

  it("keeps package metadata aligned with the V1 release version", () => {
    const packageJson = JSON.parse(readRepoFile("package.json")) as { version?: string };
    const packageLock = JSON.parse(readRepoFile("package-lock.json")) as {
      version?: string;
      packages?: { "": { version?: string } };
    };

    expect(packageJson.version).toBe("1.0.0");
    expect(packageLock.version).toBe("1.0.0");
    expect(packageLock.packages?.[""].version).toBe("1.0.0");
  });
});
