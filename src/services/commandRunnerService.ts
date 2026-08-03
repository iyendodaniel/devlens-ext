import * as vscode from "vscode";
import { Action, CommandStep, ProjectSettings } from "../types";

/**
 * Replaces api.py's runCommandStep/buildFrontend (subprocess.run, blocking,
 * captured stdout+stderr shown as a text blob after the fact). Same cwd
 * resolution rule as the original ("project" -> workspace root, "frontend"
 * -> project.frontend_path), but commands now run in a real integrated
 * terminal: the user sees output live and can Ctrl+C a hung command, which
 * a blocking subprocess.run call could never allow.
 */
export class CommandRunnerService {
  private terminal: vscode.Terminal | undefined;

  private getTerminal(): vscode.Terminal {
    if (!this.terminal || this.terminal.exitStatus !== undefined) {
      this.terminal = vscode.window.createTerminal("DevLens");
    }
    return this.terminal;
  }

  /** Resolves a command step's cwd, matching api.py's rule exactly:
   * "project" -> the workspace root, "frontend" -> project.frontend_path
   * (which must have been set first via ProjectService.promptSetFrontendPath). */
  private resolveCwd(step: CommandStep, projectRoot: string, settings: ProjectSettings): string | null {
    if (step.cwd === "frontend") return settings.frontend_path;
    return projectRoot;
  }

  /**
   * Runs every command-type step in an Action, in order, in one terminal.
   * Operation-type steps (e.g. "copy the dist folder") are surfaced to the
   * user rather than silently skipped — see BuildFrontendService for the
   * one operation step DevLens actually knows how to perform natively.
   */
  async runAction(action: Action, projectRoot: string, settings: ProjectSettings): Promise<void> {
    const terminal = this.getTerminal();
    terminal.show();

    for (const step of action.steps) {
      if (step.type === "operation") {
        terminal.sendText(`echo "→ ${step.operation} (${step.explanation})"`, true);
        continue;
      }

      const cwd = this.resolveCwd(step, projectRoot, settings);
      if (!cwd) {
        const missing = step.cwd === "frontend" ? "frontend folder" : "project folder";
        void vscode.window.showErrorMessage(
          `DevLens: no ${missing} configured — set it before running "${action.name}".`,
        );
        return;
      }

      // `cd` + command as one line keeps every step visible in terminal
      // scrollback in order, and survives the terminal being reused across
      // runs (each step explicitly re-cds rather than assuming state).
      terminal.sendText(`cd ${shellQuote(cwd)} && ${step.command}`, true);
    }
  }

  /** Runs a single ad-hoc command step (used by the "Build Frontend" flow's
   * npm run build, and by any custom single-step action run individually). */
  runCommand(command: string, cwd: string): void {
    const terminal = this.getTerminal();
    terminal.show();
    terminal.sendText(`cd ${shellQuote(cwd)} && ${command}`, true);
  }
}

function shellQuote(p: string): string {
  // Good enough for the paths this deals with (local folder picks) without
  // pulling in a full shell-escaping dependency. Wraps in double quotes and
  // escapes any embedded ones.
  return `"${p.replace(/"/g, '\\"')}"`;
}
