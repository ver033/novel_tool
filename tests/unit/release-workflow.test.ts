import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = join(__dirname, "..", "..");

function readRepoFile(relativePath: string): string {
  return readFileSync(join(repoRoot, relativePath), "utf8").replace(/\r\n/g, "\n");
}

describe("release workflow hardening", () => {
  it("pins official GitHub actions to immutable SHAs", () => {
    for (const workflowPath of [".github/workflows/package-windows.yml", ".github/workflows/release-windows.yml"]) {
      const workflow = readRepoFile(workflowPath);
      const officialActionUses = workflow.matchAll(/uses:\s+(actions\/[^\s@]+)@([^\s#]+)/g);

      for (const [, action, ref] of officialActionUses) {
        expect(ref, `${workflowPath} ${action}`).toMatch(/^[0-9a-f]{40}$/);
      }
    }
  });

  it("keeps release write permissions out of the Windows build job", () => {
    const workflow = readRepoFile(".github/workflows/release-windows.yml");
    const buildJobIndex = workflow.indexOf("  build-windows:");
    const releaseJobIndex = workflow.indexOf("  create-draft-release:");
    const writePermissionIndex = workflow.indexOf("      contents: write");
    const makeIndex = workflow.indexOf("npm run make:windows");
    const downloadIndex = workflow.indexOf("actions/download-artifact@");

    expect(workflow).toContain("permissions:\n  contents: read");
    expect(buildJobIndex).toBeGreaterThanOrEqual(0);
    expect(releaseJobIndex).toBeGreaterThan(buildJobIndex);
    expect(workflow).toContain("needs:\n      - build-windows");
    expect(writePermissionIndex).toBeGreaterThan(releaseJobIndex);
    expect(makeIndex).toBeGreaterThan(buildJobIndex);
    expect(makeIndex).toBeLessThan(releaseJobIndex);
    expect(downloadIndex).toBeGreaterThan(releaseJobIndex);
  });

  it("passes the repository explicitly to gh in the release job", () => {
    const workflow = readRepoFile(".github/workflows/release-windows.yml");
    const ghReleaseViewIndex = workflow.indexOf("gh release view");
    const ghReleaseCreateIndex = workflow.indexOf("gh @ghArgs");
    const repoEnvMatches = workflow.match(/GH_REPO:\s+\$\{\{\s*github\.repository\s*\}\}/g) ?? [];

    expect(ghReleaseViewIndex).toBeGreaterThanOrEqual(0);
    expect(ghReleaseCreateIndex).toBeGreaterThanOrEqual(0);
    expect(repoEnvMatches).toHaveLength(2);
  });

  it("runs lockfile safety checks before npm install can execute lifecycle scripts", () => {
    for (const workflowPath of [".github/workflows/package-windows.yml", ".github/workflows/release-windows.yml"]) {
      const workflow = readRepoFile(workflowPath);
      const safetyIndex = workflow.indexOf("node scripts/check-lockfile-safety.mjs");
      const installIndex = workflow.indexOf("npm ci");

      expect(safetyIndex, workflowPath).toBeGreaterThanOrEqual(0);
      expect(installIndex, workflowPath).toBeGreaterThanOrEqual(0);
      expect(safetyIndex, workflowPath).toBeLessThan(installIndex);
    }
  });

  it("runs the test suite before packaging Windows artifacts", () => {
    const packageJson = JSON.parse(readRepoFile("package.json")) as { scripts?: Record<string, string> };

    expect(packageJson.scripts?.test).toContain("--testTimeout=30000");

    for (const workflowPath of [".github/workflows/package-windows.yml", ".github/workflows/release-windows.yml"]) {
      const workflow = readRepoFile(workflowPath);
      const testIndex = workflow.indexOf("npm test");
      const makeIndex = workflow.indexOf("npm run make:windows");

      expect(testIndex, workflowPath).toBeGreaterThanOrEqual(0);
      expect(makeIndex, workflowPath).toBeGreaterThanOrEqual(0);
      expect(testIndex, workflowPath).toBeLessThan(makeIndex);
    }
  });

  it("uses Electron Forge make without an invalid short --targets override", () => {
    const packageJson = JSON.parse(readRepoFile("package.json")) as { scripts?: Record<string, string> };

    expect(packageJson.scripts?.["premake:windows"]).toBe("npm run rebuild:electron");
    expect(packageJson.scripts?.["make:windows"]).toBe("electron-forge make --platform=win32 --arch=x64");
    expect(packageJson.scripts?.["make:windows"]).not.toContain("--targets=squirrel");

    for (const workflowPath of [".github/workflows/package-windows.yml", ".github/workflows/release-windows.yml"]) {
      const workflow = readRepoFile(workflowPath);

      expect(workflow, workflowPath).toContain("npm run make:windows");
      expect(workflow, workflowPath).not.toContain("npm run make\n");
      expect(workflow, workflowPath).toContain("scripts/stage-windows-artifacts.ps1");
    }

    const stagingScript = readRepoFile("scripts/stage-windows-artifacts.ps1");
    expect(stagingScript).not.toContain("*-win32-x64");
    expect(stagingScript).not.toContain("Compress-Archive");
    expect(stagingScript).not.toContain("portable.zip");
  });

  it("stages Windows artifacts only from the actual Forge make output", () => {
    for (const workflowPath of [".github/workflows/package-windows.yml", ".github/workflows/release-windows.yml"]) {
      const workflow = readRepoFile(workflowPath);
      const stagingScript = readRepoFile("scripts/stage-windows-artifacts.ps1");

      expect(stagingScript, workflowPath).toContain('Join-Path $PWD "out\\make"');
      expect(stagingScript, workflowPath).toContain('Join-Path $PWD "out"');
      expect(stagingScript, workflowPath).toContain("Electron Forge output tree:");
      expect(stagingScript, workflowPath).toContain('Join-Path $PWD "out\\artifacts\\windows-package"');
      expect(stagingScript, workflowPath).toContain("Expected Electron Forge make output directory was not created");
      expect(workflow, workflowPath).toContain("out/artifacts/windows-package/**");
      expect(workflow, workflowPath).not.toContain("out/make/squirrel.windows/**");
    }
  });

  it("keeps tests versionable", () => {
    const gitignore = readRepoFile(".gitignore");

    expect(gitignore).not.toMatch(/^tests\/$/m);
  });

  it("checks nested lockfile package paths instead of only top-level node_modules entries", () => {
    const script = readRepoFile("scripts/check-lockfile-safety.mjs");

    expect(script).toContain('split("node_modules/").at(-1)');
  });
});
