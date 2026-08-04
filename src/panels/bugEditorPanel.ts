import * as vscode from "vscode";
import { Bug, BugStatus } from "../types";
import { StorageService } from "../services/storageService";

/**
 * One webview panel per open bug (or one for "new bug"). Deliberately plain
 * HTML/CSS/JS rather than the original shadcn/Radix React form - same
 * fields, same behavior, no second build pipeline required inside the
 * extension. See the wrap-up notes for swapping in the real React
 * components later if the plain form ever feels limiting.
 */
export class BugEditorPanel {
  private static openPanels = new Map<string, BugEditorPanel>();

  static async open(
    storage: StorageService,
    onSaved: () => void,
    bugId?: string,
  ): Promise<void> {
    const key = bugId ?? "__new__";
    const existingPanel = BugEditorPanel.openPanels.get(key);
    if (existingPanel) {
      existingPanel.panel.reveal();
      return;
    }

    const bug = bugId ? await storage.getBug(bugId) : null;
    const panel = vscode.window.createWebviewPanel(
      "devlens.bugEditor",
      bug ? bug.title : "New Bug",
      vscode.ViewColumn.Active,
      { enableScripts: true, retainContextWhenHidden: true },
    );

    const instance = new BugEditorPanel(panel, storage, onSaved, bug);
    BugEditorPanel.openPanels.set(key, instance);
    panel.onDidDispose(() => BugEditorPanel.openPanels.delete(key));
  }

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    private readonly storage: StorageService,
    private readonly onSaved: () => void,
    private readonly bug: Bug | null,
  ) {
    this.panel.webview.html = this.render();
    this.panel.webview.onDidReceiveMessage(async (message) => {
      if (message.type === "save") {
        const patch = message.bug as Partial<Bug>;
        if (this.bug) {
          await this.storage.updateBug(this.bug.id, patch);
        } else {
          await this.storage.createBug(patch);
        }
        this.onSaved();
        this.panel.dispose();
      } else if (message.type === "cancel") {
        this.panel.dispose();
      }
    });
  }

  private render(): string {
    const b = this.bug;
    const statuses: BugStatus[] = ["open", "investigating", "resolved"];

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
  .form { padding: 18px 24px 100px; max-width: 640px; }
  label { display: block; margin-top: 16px; font-size: 11px; font-weight: 600;
    text-transform: uppercase; letter-spacing: 0.05em; opacity: 0.65; }
  label:first-child { margin-top: 0; }
  input, select, textarea { width: 100%; margin-top: 6px; padding: 7px 9px; box-sizing: border-box;
    background: var(--vscode-input-background); color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border, rgba(128,128,128,0.3)); border-radius: 4px;
    font-family: inherit; font-size: 13px; }
  input:focus, select:focus, textarea:focus { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
  textarea { resize: vertical; min-height: 80px; line-height: 1.5; }
  .row { display: flex; gap: 14px; }
  .row > div { flex: 1; }
  .footer { position: fixed; bottom: 0; left: 0; right: 0; padding: 14px 24px;
    background: var(--vscode-editor-background); border-top: 1px solid var(--vscode-widget-border, rgba(128,128,128,0.2));
    display: flex; gap: 8px; }
  button { padding: 7px 16px; border: none; border-radius: 4px; cursor: pointer; font-size: 13px; font-weight: 500; }
  .primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
  .primary:hover { background: var(--vscode-button-hoverBackground); }
  .secondary { background: transparent; color: var(--vscode-foreground);
    border: 1px solid var(--vscode-input-border, rgba(128,128,128,0.3)); }
  .secondary:hover { background: var(--vscode-list-hoverBackground); }
</style>
</head>
<body>
  <div class="header">
    <h1>${b ? "Edit Bug" : "New Bug"}</h1>
    <p>${b ? "Update what you know about this bug." : "Log a bug so future-you doesn't debug it twice."}</p>
  </div>

  <div class="form">
    <label for="title">Title</label>
    <input id="title" value="${escapeHtml(b?.title ?? "")}" placeholder="Short summary of the bug" />

    <div class="row">
      <div>
        <label for="status">Status</label>
        <select id="status">
          ${statuses.map((s) => `<option value="${s}" ${b?.status === s ? "selected" : ""}>${s}</option>`).join("")}
        </select>
      </div>
      <div>
        <label for="tags">Tags</label>
        <input id="tags" value="${escapeHtml((b?.tags ?? []).join(", "))}" placeholder="auth, migration (comma-separated)" />
      </div>
    </div>

    <label for="description">Description</label>
    <textarea id="description" placeholder="What went wrong?">${escapeHtml(b?.description ?? "")}</textarea>

    <label for="steps">Steps to reproduce</label>
    <textarea id="steps" placeholder="How to trigger it">${escapeHtml(b?.steps ?? "")}</textarea>

    <label for="solution">Solution</label>
    <textarea id="solution" placeholder="What fixed it, and why">${escapeHtml(b?.solution ?? "")}</textarea>
  </div>

  <div class="footer">
    <button class="primary" id="saveBtn">Save Bug</button>
    <button class="secondary" id="cancelBtn">Cancel</button>
  </div>

<script>
  const vscode = acquireVsCodeApi();
  document.getElementById("saveBtn").addEventListener("click", () => {
    vscode.postMessage({
      type: "save",
      bug: {
        title: document.getElementById("title").value,
        status: document.getElementById("status").value,
        tags: document.getElementById("tags").value.split(",").map(t => t.trim()).filter(Boolean),
        description: document.getElementById("description").value,
        steps: document.getElementById("steps").value,
        solution: document.getElementById("solution").value,
      },
    });
  });
  document.getElementById("cancelBtn").addEventListener("click", () => {
    vscode.postMessage({ type: "cancel" });
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
