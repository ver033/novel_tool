import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const rootDir = process.cwd();

function readSource(file: string): string {
  return readFileSync(join(rootDir, file), "utf8");
}

describe("settings page scope", () => {
  it("only exposes implemented settings sections in the navigation", () => {
    const settings = readSource("src/renderer/routes/SettingsPage.tsx");
    const app = readSource("src/renderer/App.tsx");

    expect(settings).toContain('const visibleCategories = ["AI 服务", "提示词预设"] as const satisfies readonly SettingsCategory[];');
    expect(settings).toContain("visibleCategories.map");
    expect(settings).toContain("activeVisibleCategory");
    expect(app).toContain('useState<SettingsCategory>("AI 服务")');
  });

  it("does not show disabled placeholder AI behavior controls in the visible AI settings", () => {
    const settings = readSource("src/renderer/routes/SettingsPage.tsx");

    expect(settings).not.toContain("默认 AI 行为");
    expect(settings).not.toContain("默认行动风格");
    expect(settings).not.toContain("上下文范围");
  });
});
