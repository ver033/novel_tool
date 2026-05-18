import { spawn } from "node:child_process";
import { isBookFilePath, isPathInsideProjectBookFolder } from "./book-project-folder";

export type WindowsIndexSearchResult =
  | { readonly status: "unsupported"; readonly files: readonly string[] }
  | { readonly status: "completed"; readonly files: readonly string[] }
  | { readonly status: "timeout"; readonly files: readonly string[] }
  | { readonly status: "failed"; readonly files: readonly string[]; readonly error: string };

export type WindowsIndexSearchInput = {
  readonly projectName: string;
  readonly timeoutMs: number;
};

function filterBookPaths(paths: readonly string[], projectName: string): string[] {
  const seen = new Set<string>();
  const filtered: string[] = [];
  for (const filePath of paths) {
    if (!isBookFilePath(filePath) || !isPathInsideProjectBookFolder(filePath, projectName, "win32")) {
      continue;
    }
    const key = filePath.toLocaleLowerCase("en-US");
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    filtered.push(filePath);
  }
  return filtered;
}

export function searchWindowsIndexForBookFiles(input: WindowsIndexSearchInput): Promise<WindowsIndexSearchResult> {
  if (process.platform !== "win32") {
    return Promise.resolve({ status: "unsupported", files: [] });
  }

  return new Promise((resolve) => {
    const query = [
      '$ErrorActionPreference = "Stop"',
      "$connection = New-Object -ComObject ADODB.Connection",
      "$recordset = New-Object -ComObject ADODB.Recordset",
      '$connection.Open("Provider=Search.CollatorDSO;Extended Properties=\'Application=Windows\';")',
      "$sql = \"SELECT System.ItemPathDisplay FROM SYSTEMINDEX WHERE System.FileExtension = '.Book' OR System.FileExtension = '.book'\"",
      "$recordset.Open($sql, $connection)",
      "while (-not $recordset.EOF) {",
      '  $path = $recordset.Fields.Item("System.ItemPathDisplay").Value',
      "  if ($path) { [Console]::Out.WriteLine($path) }",
      "  $recordset.MoveNext()",
      "}",
      "$recordset.Close()",
      "$connection.Close()"
    ].join("; ");
    const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", query], {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let output = "";
    let errorOutput = "";
    let settled = false;
    const finish = (result: WindowsIndexSearchResult) => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(result);
    };
    const timer = setTimeout(() => {
      child.kill();
      finish({ status: "timeout", files: filterBookPaths(output.split(/\r?\n/u), input.projectName) });
    }, input.timeoutMs);
    timer.unref?.();

    child.stdout?.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf8");
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      errorOutput += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      finish({ status: "failed", files: filterBookPaths(output.split(/\r?\n/u), input.projectName), error: error.message });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      const files = filterBookPaths(output.split(/\r?\n/u), input.projectName);
      if (code && code !== 0) {
        finish({ status: "failed", files, error: errorOutput.trim() || `Windows Search 索引查询退出码 ${code}` });
        return;
      }
      finish({ status: "completed", files });
    });
  });
}
