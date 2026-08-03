import * as vscode from "vscode";
import { spawn } from "child_process";
import { ScannedEndpoint } from "../types";

/**
 * scripts/scanner.py is copied byte-for-byte from the original pywebview
 * app (see esbuild.js's copyScanner). Its AST-walking logic — resolving
 * urlpatterns, following include(), inferring HTTP methods from DRF base
 * classes / @api_view / request.method checks — doesn't change; only *how*
 * it's invoked does. The old app called it as a plain Python import in the
 * same process; here it has to run as a child process, since the extension
 * host is Node.
 *
 * scanner.py's own `if __name__ == "__main__"` block already prints JSON
 * to stdout when run with a project path as argv[1], so no changes to the
 * script itself were needed to make it usable this way — that entry point
 * existed already for standalone/debugging use.
 */
export class ScannerService {
  constructor(private readonly extensionUri: vscode.Uri) {}

  /**
   * Resolves which Python interpreter to use. Prefers the Python
   * extension's configured interpreter when available (so DevLens uses the
   * same venv the user already told VS Code about), falling back to
   * `python3`/`python` on PATH.
   */
  private async resolvePythonCommand(): Promise<string> {
    try {
      const pythonExtension = vscode.extensions.getExtension("ms-python.python");
      if (pythonExtension) {
        const api = pythonExtension.isActive ? pythonExtension.exports : await pythonExtension.activate();
        const path: string | undefined = api?.settings?.getExecutionDetails?.()?.execCommand?.[0];
        if (path) return path;
      }
    } catch {
      // Python extension not installed/active, or its API shape changed —
      // fall through to PATH-based resolution below rather than failing.
    }
    return process.platform === "win32" ? "python" : "python3";
  }

  async scan(projectPath: string): Promise<ScannedEndpoint[]> {
    const scannerDir = vscode.Uri.joinPath(this.extensionUri, "dist").fsPath;
    const pythonCmd = await this.resolvePythonCommand();

    // Import scanner.py as a module and print only clean JSON, rather than
    // relying on its __main__ block (which also prints a human-readable
    // "N routes found." line after the JSON — fine for standalone/debug use,
    // but an extra thing to strip out here for no benefit). scanner.py
    // itself is untouched; this is just a different, cleaner call site.
    const inlineScript = [
      "import sys, json",
      `sys.path.insert(0, ${JSON.stringify(scannerDir)})`,
      "import scanner",
      "print(json.dumps(scanner.scan_urls(sys.argv[1])))",
    ].join("; ");

    return new Promise((resolve, reject) => {
      const child = spawn(pythonCmd, ["-c", inlineScript, projectPath], {
        shell: process.platform === "win32",
      });
      let stdout = "";
      let stderr = "";

      child.stdout.on("data", (chunk) => (stdout += chunk.toString()));
      child.stderr.on("data", (chunk) => (stderr += chunk.toString()));

      child.on("error", (err) => {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") {
          reject(
            new Error(
              `Could not run "${pythonCmd}". DevLens's Endpoint Explorer needs a Python interpreter on PATH ` +
                `(it scans urls.py with a bundled Python script) — install Python or set one via the Python extension.`,
            ),
          );
        } else {
          reject(err);
        }
      });

      child.on("close", (code) => {
        if (code !== 0) {
          reject(new Error(`Scanner exited with code ${code}.\n${stderr || stdout}`));
          return;
        }
        try {
          resolve(JSON.parse(stdout.trim()) as ScannedEndpoint[]);
        } catch (e) {
          reject(new Error(`Could not parse scanner output: ${(e as Error).message}\n${stdout}`));
        }
      });
    });
  }
}
