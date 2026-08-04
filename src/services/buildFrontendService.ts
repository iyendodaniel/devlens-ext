import * as vscode from "vscode";
import { spawn } from "child_process";
import * as path from "path";
import { ProjectSettings } from "../types";

export interface BuildResult {
  ok: boolean;
  output: string;
  error?: string;
}

/**
 * Ports api.py's buildFrontend + copyDistTo. These stayed hand-written
 * Python (not generic command steps) in the original because "npm run
 * build" needs OS-specific binary resolution (npm.cmd on Windows) and the
 * copy step isn't a shell command at all - same reasoning applies here,
 * so this stays its own service rather than folding into
 * CommandRunnerService's generic terminal runner.
 *
 * Unlike the terminal-based runner, this uses child_process.spawn directly
 * so completion can be awaited - required to know when it's safe to start
 * the copy step, same sequencing the original blocking subprocess.run gave
 * you for free.
 */
export class BuildFrontendService {
  async build(settings: ProjectSettings): Promise<BuildResult> {
    if (!settings.frontend_path) {
      return { ok: false, output: "", error: "No frontend folder set for this project." };
    }

    const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";

    return vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: "DevLens: Building frontend…" },
      () =>
        new Promise<BuildResult>((resolve) => {
          let output = "";
          const child = spawn(npmCmd, ["run", "build"], {
            cwd: settings.frontend_path!,
            shell: process.platform === "win32",
          });

          child.stdout.on("data", (c) => (output += c.toString()));
          child.stderr.on("data", (c) => (output += c.toString()));

          child.on("error", () => {
            resolve({ ok: false, output: "", error: "npm was not found. Is Node.js installed?" });
          });

          child.on("close", (code) => {
            if (code === 0) {
              resolve({ ok: true, output });
            } else {
              resolve({ ok: false, output, error: `npm run build exited with code ${code}` });
            }
          });
        }),
    );
  }

  async copyDistTo(settings: ProjectSettings, destination: string): Promise<BuildResult> {
    if (!settings.frontend_path) {
      return { ok: false, output: "", error: "No frontend folder set." };
    }
    const distUri = vscode.Uri.file(path.join(settings.frontend_path, "dist"));
    const targetUri = vscode.Uri.file(path.join(destination, "dist"));

    try {
      await vscode.workspace.fs.stat(distUri);
    } catch {
      return { ok: false, output: "", error: "No dist/ folder found - did the build run?" };
    }

    try {
      await copyRecursive(distUri, targetUri);
      return { ok: true, output: `Copied dist/ -> ${targetUri.fsPath}` };
    } catch (e) {
      return { ok: false, output: "", error: (e as Error).message };
    }
  }
}

/** vscode.workspace.fs.copy refuses to merge into an existing directory
 * without deleting it first; a manual recursive copy preserves
 * dirs_exist_ok=True semantics from the original shutil.copytree call, so
 * a rebuild doesn't require wiping the destination first. */
async function copyRecursive(src: vscode.Uri, dest: vscode.Uri): Promise<void> {
  await vscode.workspace.fs.createDirectory(dest);
  const entries = await vscode.workspace.fs.readDirectory(src);
  for (const [name, type] of entries) {
    const srcChild = vscode.Uri.joinPath(src, name);
    const destChild = vscode.Uri.joinPath(dest, name);
    if (type === vscode.FileType.Directory) {
      await copyRecursive(srcChild, destChild);
    } else {
      const bytes = await vscode.workspace.fs.readFile(srcChild);
      await vscode.workspace.fs.writeFile(destChild, bytes);
    }
  }
}
