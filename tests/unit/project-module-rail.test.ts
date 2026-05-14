import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const rootDir = process.cwd();

function readSource(file: string): string {
  return readFileSync(join(rootDir, file), "utf8");
}

describe("project module rail", () => {
  it("defines current project modules and keeps future modules disabled", () => {
    const rail = readSource("src/renderer/layout/ProjectModuleRail.tsx");

    expect(rail).toContain('"writing"');
    expect(rail).toContain('"relationshipGraph"');
    expect(rail).toContain('"正文"');
    expect(rail).toContain('"人物关系图"');
    expect(rail).toContain('"大纲"');
    expect(rail).toContain('"资料"');
    expect(rail).toContain("disabled: true");
    expect(rail).toContain("onNavigate");
  });

  it("adds dedicated CSS for the project module rail", () => {
    const css = readSource("src/renderer/styles/globals.css");

    expect(css).toContain(".project-module-rail");
    expect(css).toContain(".project-module-button.active");
    expect(css).toContain(".project-module-button:disabled");
  });
});
