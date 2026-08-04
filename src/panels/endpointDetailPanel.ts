import * as vscode from "vscode";
import { Endpoint } from "../types";
import { StorageService } from "../services/storageService";

export class EndpointDetailPanel {
  private static openPanels = new Map<string, EndpointDetailPanel>();

  static async open(
    storage: StorageService,
    projectId: string,
    endpointId: string,
    onSaved: () => void,
  ): Promise<void> {
    const existing = EndpointDetailPanel.openPanels.get(endpointId);
    if (existing) {
      existing.panel.reveal();
      return;
    }

    const endpoint = await storage.getEndpoint(projectId, endpointId);
    if (!endpoint) {
      void vscode.window.showErrorMessage("DevLens: endpoint not found - try rescanning.");
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      "devlens.endpointDetail",
      `${endpoint.method} ${endpoint.path}`,
      vscode.ViewColumn.Active,
      { enableScripts: true, retainContextWhenHidden: true },
    );

    const instance = new EndpointDetailPanel(panel, storage, projectId, endpoint, onSaved);
    EndpointDetailPanel.openPanels.set(endpointId, instance);
    panel.onDidDispose(() => EndpointDetailPanel.openPanels.delete(endpointId));
  }

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    private readonly storage: StorageService,
    private readonly projectId: string,
    private readonly endpoint: Endpoint,
    private readonly onSaved: () => void,
  ) {
    this.panel.webview.html = this.render();
    this.panel.webview.onDidReceiveMessage(async (message) => {
      if (message.type === "save") {
        await this.storage.updateEndpoint(this.projectId, this.endpoint.id, {
          ai_notes: message.notes,
          ai_notes_generated_at: new Date().toISOString(),
        });
        this.onSaved();
        void vscode.window.showInformationMessage("DevLens: notes saved.");
      }
    });
  }

  private render(): string {
    const ep = this.endpoint;
    return /* html */ `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8" />
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body { font-family: var(--vscode-font-family); color: var(--vscode-foreground);
    background: var(--vscode-editor-background); margin: 0; padding: 0; }
  .header { padding: 18px 24px 16px; border-bottom: 1px solid var(--vscode-widget-border, rgba(128,128,128,0.2)); }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 3px; font-size: 11px;
    font-weight: 600; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); }
  .header h1 { margin: 8px 0 2px; font-size: 15px; font-family: var(--vscode-editor-font-family); font-weight: 600; }
  .meta { opacity: 0.65; font-size: 12px; }
  .form { padding: 18px 24px 100px; max-width: 640px; }
  label { display: block; margin-top: 4px; font-size: 11px; font-weight: 600;
    text-transform: uppercase; letter-spacing: 0.05em; opacity: 0.65; }
  .hint { font-size: 12px; opacity: 0.6; margin: 4px 0 0; }
  textarea { width: 100%; margin-top: 8px; padding: 9px; box-sizing: border-box; min-height: 200px;
    background: var(--vscode-input-background); color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border, rgba(128,128,128,0.3)); border-radius: 4px;
    font-family: var(--vscode-editor-font-family); font-size: 13px; resize: vertical; line-height: 1.5; }
  textarea:focus { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
  .footer { position: fixed; bottom: 0; left: 0; right: 0; padding: 14px 24px;
    background: var(--vscode-editor-background); border-top: 1px solid var(--vscode-widget-border, rgba(128,128,128,0.2)); }
  button { padding: 7px 16px; border: none; border-radius: 4px; cursor: pointer;
    font-size: 13px; font-weight: 500; background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
  button:hover { background: var(--vscode-button-hoverBackground); }
</style>
</head>
<body>
  <div class="header">
    <span class="badge">${ep.method}</span>
    <h1>${escapeHtml(ep.path)}</h1>
    <div class="meta">${escapeHtml(ep.view)} · app: ${escapeHtml(ep.app)} · last scanned ${escapeHtml(ep.last_scanned)}</div>
  </div>

  <div class="form">
    <label for="notes">Notes</label>
    <p class="hint">What this endpoint does, who calls it, auth requirements - anything worth remembering next time you're here.</p>
    <textarea id="notes" placeholder="e.g. Called by the mobile app's login screen. Requires a valid refresh token.">${escapeHtml(ep.ai_notes ?? "")}</textarea>
  </div>

  <div class="footer">
    <button id="saveBtn">Save Notes</button>
  </div>

<script>
  const vscode = acquireVsCodeApi();
  document.getElementById("saveBtn").addEventListener("click", () => {
    vscode.postMessage({ type: "save", notes: document.getElementById("notes").value });
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
