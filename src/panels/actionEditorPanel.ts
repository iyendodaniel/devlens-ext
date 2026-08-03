import * as vscode from "vscode";
import { Action, ActionStep, ExecutionMode } from "../types";
import { StorageService } from "../services/storageService";

/**
 * Steps are edited as JSON text rather than a dedicated per-field form —
 * the step shape (command vs operation, each with different fields) varies
 * enough that a generic JSON editor covers both without two separate forms.
 * Same trade-off as the other panels: ships now, upgradeable to a richer
 * per-step form later if raw JSON editing feels rough in practice.
 */
export class ActionEditorPanel {
  private static openPanels = new Map<string, ActionEditorPanel>();

  static async open(
    storage: StorageService,
    projectId: string,
    actionId: string,
    onSaved: () => void,
  ): Promise<void> {
    const existing = ActionEditorPanel.openPanels.get(actionId);
    if (existing) {
      existing.panel.reveal();
      return;
    }

    const actions = await storage.getActionsRaw(projectId);
    const action = actions.find((a) => a.id === actionId);
    if (!action) {
      void vscode.window.showErrorMessage("DevLens: action not found.");
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      "devlens.actionEditor",
      `Edit: ${action.name}`,
      vscode.ViewColumn.Active,
      { enableScripts: true, retainContextWhenHidden: true },
    );

    const instance = new ActionEditorPanel(panel, storage, projectId, action, onSaved);
    ActionEditorPanel.openPanels.set(actionId, instance);
    panel.onDidDispose(() => ActionEditorPanel.openPanels.delete(actionId));
  }

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    private readonly storage: StorageService,
    private readonly projectId: string,
    private readonly action: Action,
    private readonly onSaved: () => void,
  ) {
    this.panel.webview.html = this.render();
    this.panel.webview.onDidReceiveMessage(async (message) => {
      if (message.type !== "save") return;

      let steps: ActionStep[];
      try {
        steps = JSON.parse(message.stepsJson);
        if (!Array.isArray(steps)) throw new Error("Steps must be a JSON array.");
      } catch (e) {
        this.panel.webview.postMessage({ type: "error", message: `Invalid steps JSON: ${(e as Error).message}` });
        return;
      }

      await this.storage.updateAction(this.projectId, this.action.id, {
        name: message.name,
        execution_mode: message.executionMode as ExecutionMode,
        steps,
      });
      this.onSaved();
      this.panel.dispose();
    });
  }

  private render(): string {
    const a = this.action;
    return /* html */ `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8" />
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body { font-family: var(--vscode-font-family); color: var(--vscode-foreground);
    background: var(--vscode-editor-background); margin: 0; padding: 0; }
  .header { padding: 18px 24px 14px; border-bottom: 1px solid var(--vscode-widget-border, rgba(128,128,128,0.2)); }
  .header h1 { margin: 0; font-size: 15px; font-weight: 600; }
  .header p { margin: 4px 0 0; font-size: 12px; opacity: 0.65; }
  .form { padding: 18px 24px 100px; max-width: 680px; }
  label { display: block; margin-top: 16px; font-size: 11px; font-weight: 600;
    text-transform: uppercase; letter-spacing: 0.05em; opacity: 0.65; }
  label:first-child { margin-top: 0; }
  input, select, textarea { width: 100%; margin-top: 6px; padding: 7px 9px; box-sizing: border-box;
    background: var(--vscode-input-background); color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border, rgba(128,128,128,0.3)); border-radius: 4px;
    font-family: inherit; font-size: 13px; }
  input:focus, select:focus, textarea:focus { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
  textarea { font-family: var(--vscode-editor-font-family); min-height: 260px; resize: vertical; line-height: 1.5; }
  .hint { font-size: 12px; opacity: 0.6; margin: 6px 0 0; }
  .error { color: var(--vscode-errorForeground); font-size: 12px; margin-top: 10px; display: none; }
  .footer { position: fixed; bottom: 0; left: 0; right: 0; padding: 14px 24px;
    background: var(--vscode-editor-background); border-top: 1px solid var(--vscode-widget-border, rgba(128,128,128,0.2)); }
  button { padding: 7px 16px; border: none; border-radius: 4px; cursor: pointer;
    font-size: 13px; font-weight: 500; background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
  button:hover { background: var(--vscode-button-hoverBackground); }
</style>
</head>
<body>
  <div class="header">
    <h1>Edit Action</h1>
    <p>Automate repetition, not understanding — Learning mode shows every step before running it; Automation runs immediately.</p>
  </div>

  <div class="form">
    <label for="name">Name</label>
    <input id="name" value="${escapeHtml(a.name)}" />

    <label for="mode">Execution mode</label>
    <select id="mode">
      <option value="learning" ${a.execution_mode === "learning" ? "selected" : ""}>📘 Learning — preview and confirm before every run</option>
      <option value="automation" ${a.execution_mode === "automation" ? "selected" : ""}>⚡ Automation — runs immediately, no preview</option>
    </select>

    <label for="steps">Steps</label>
    <p class="hint">Each step is either a command that runs in a terminal, or an operation (a description of something that happens automatically, like a file copy). Format:<br>
    <code>{"type":"command","command":"…","cwd":"project"|"frontend","explanation":"…"}</code> or <code>{"type":"operation","operation":"…","explanation":"…"}</code></p>
    <textarea id="steps" spellcheck="false">${escapeHtml(JSON.stringify(a.steps, null, 2))}</textarea>
    <div class="error" id="error"></div>
  </div>

  <div class="footer">
    <button id="saveBtn">Save Action</button>
  </div>

<script>
  const vscode = acquireVsCodeApi();
  window.addEventListener("message", (event) => {
    if (event.data.type === "error") {
      const el = document.getElementById("error");
      el.textContent = event.data.message;
      el.style.display = "block";
    }
  });
  document.getElementById("saveBtn").addEventListener("click", () => {
    document.getElementById("error").style.display = "none";
    vscode.postMessage({
      type: "save",
      name: document.getElementById("name").value,
      executionMode: document.getElementById("mode").value,
      stepsJson: document.getElementById("steps").value,
    });
  });
</script>
</body>
</html>`;
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
