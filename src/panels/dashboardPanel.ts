import * as vscode from "vscode";
import { StorageService } from "../services/storageService";
import { ProjectService } from "../services/projectService";
import { ActionsService } from "../services/actionsService";
import { Action, Bug, Endpoint } from "../types";

/**
 * DevLens as its own editor-area tab — an alternative surface to the
 * sidebar tree views, for people who'd rather have DevLens live next to
 * their other open files the way Kilo/Copilot Chat do, instead of hunting
 * for an Activity Bar icon.
 *
 * Deliberately a thin summary/launcher, not a reimplementation: every
 * action here (open a bug, run an action, scan endpoints) just calls the
 * same `devlens.*` commands the sidebar already uses, so there's exactly
 * one place each of those behaviors lives. This panel only owns its own
 * read-only summary rendering and refresh-on-focus.
 */
export class DashboardPanel {
  private static current: DashboardPanel | undefined;

  static open(storage: StorageService, projects: ProjectService, actionsService: ActionsService): void {
    if (DashboardPanel.current) {
      DashboardPanel.current.panel.reveal(vscode.ViewColumn.Active);
      void DashboardPanel.current.refresh();
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      "devlens.dashboard",
      "DevLens",
      vscode.ViewColumn.Active,
      { enableScripts: true, retainContextWhenHidden: true },
    );

    DashboardPanel.current = new DashboardPanel(panel, storage, projects, actionsService);
  }

  /** Called by extension.ts alongside the tree providers' refresh(), so the
   * dashboard tab (if open) stays in sync with bug/endpoint/action changes
   * made from the sidebar, and vice versa. */
  static refreshIfOpen(): void {
    void DashboardPanel.current?.refresh();
  }

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    private readonly storage: StorageService,
    private readonly projects: ProjectService,
    private readonly actionsService: ActionsService,
  ) {
    this.panel.onDidDispose(() => {
      DashboardPanel.current = undefined;
    });

    this.panel.webview.onDidReceiveMessage(async (message) => {
      if (message?.type === "runCommand") {
        await vscode.commands.executeCommand(message.command, ...(message.args ?? []));
        await this.refresh();
      } else if (message?.type === "refresh") {
        await this.refresh();
      }
    });

    this.panel.onDidChangeViewState((e) => {
      if (e.webviewPanel.visible) void this.refresh();
    });

    this.panel.webview.html = this.shell();
    void this.refresh();
  }

  private async refresh(): Promise<void> {
    const projectId = this.projects.getCurrentProjectId();
    const projectName = this.projects.getCurrentProjectName();

    let bugs: Bug[] = [];
    let endpoints: Endpoint[] = [];
    let actions: Action[] = [];
    let frontendPath: string | null = null;

    bugs = await this.storage.getBugs();

    if (projectId) {
      endpoints = await this.storage.getEndpoints(projectId);
      actions = await this.actionsService.getActions(projectId);
      const settings = await this.projects.getSettings(projectId);
      frontendPath = settings.frontend_path;
    }

    void this.panel.webview.postMessage({
      type: "data",
      projectName,
      hasProject: !!projectId,
      frontendPath,
      bugs,
      endpoints,
      actions,
    });
  }

  private shell(): string {
    return /* html */ `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8" />
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body { font-family: var(--vscode-font-family); color: var(--vscode-foreground);
    background: var(--vscode-editor-background); margin: 0; padding: 0; }
  .header { padding: 20px 28px 16px; border-bottom: 1px solid var(--vscode-widget-border, rgba(128,128,128,0.2)); }
  .header h1 { margin: 0; font-size: 17px; font-weight: 600; }
  .header p { margin: 5px 0 0; font-size: 12px; opacity: 0.65; }
  /* auto-fit + minmax means columns collapse on their own as the tab is
     resized — 3 across when there's room, then 2, then a single stacked
     column — instead of squeezing 3 fixed columns until content is cut off. */
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 18px;
    padding: 20px 28px 40px; max-width: 1200px; }
  .card { border: 1px solid var(--vscode-widget-border, rgba(128,128,128,0.2)); border-radius: 6px;
    overflow: hidden; display: flex; flex-direction: column; }
  .card-header { padding: 12px 14px; display: flex; align-items: center; justify-content: space-between;
    border-bottom: 1px solid var(--vscode-widget-border, rgba(128,128,128,0.2)); }
  .card-header h2 { margin: 0; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; opacity: 0.8; }
  .card-header .actions { display: flex; gap: 4px; }
  .icon-btn { background: transparent; border: none; color: var(--vscode-foreground); opacity: 0.7;
    cursor: pointer; padding: 3px 5px; border-radius: 3px; font-size: 13px; }
  .icon-btn:hover { opacity: 1; background: var(--vscode-list-hoverBackground); }
  .list { flex: 1; overflow-y: auto; max-height: 340px; }
  .list-item { padding: 9px 14px; cursor: pointer; border-bottom: 1px solid var(--vscode-widget-border, rgba(128,128,128,0.08)); }
  .list-item:hover { background: var(--vscode-list-hoverBackground); }
  .list-item .title { font-size: 12.5px; font-weight: 500; }
  .list-item .meta { font-size: 11px; opacity: 0.6; margin-top: 2px; }
  .empty { padding: 18px 14px; font-size: 12px; opacity: 0.6; line-height: 1.6; }
  .empty a { color: var(--vscode-textLink-foreground); cursor: pointer; }
  .action-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .action-row .title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .action-controls { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
  .mode-switch { position: relative; display: inline-block; width: 30px; height: 17px; flex-shrink: 0; }
  .mode-switch input { opacity: 0; width: 0; height: 0; }
  .mode-switch .track { position: absolute; inset: 0; cursor: pointer; border-radius: 999px;
    background: var(--vscode-inputValidation-warningBackground, #5a4b1f); transition: background 0.15s; }
  .mode-switch .track::before { content: ""; position: absolute; height: 13px; width: 13px; left: 2px; bottom: 2px;
    border-radius: 50%; background: #fff; transition: transform 0.15s; }
  .mode-switch input:checked + .track { background: var(--vscode-charts-green, #2e8b3d); }
  .mode-switch input:checked + .track::before { transform: translateX(13px); }
  .delete-btn:hover { color: var(--vscode-errorForeground, #f14c4c); }
  .badge { display: inline-block; padding: 1px 6px; border-radius: 3px; font-size: 10px; font-weight: 600;
    text-transform: uppercase; margin-right: 6px; }
  .badge.open, .badge.investigating { background: var(--vscode-inputValidation-warningBackground, #5a4b1f); }
  .badge.resolved { background: var(--vscode-inputValidation-infoBackground, #1f3a5a); }
  .footer-note { padding: 0 28px 28px; font-size: 11.5px; opacity: 0.55; max-width: 640px; line-height: 1.6; }
</style>
</head>
<body>
  <div class="header">
    <h1 id="titleText">DevLens</h1>
    <p id="subtitleText">Loading project…</p>
  </div>

  <div class="grid">
    <div class="card">
      <div class="card-header">
        <h2>Bug Book</h2>
        <div class="actions">
          <button class="icon-btn" id="newBugBtn" title="New Bug">+</button>
          <button class="icon-btn" id="refreshBugsBtn" title="Refresh">⟳</button>
        </div>
      </div>
      <div class="list" id="bugsList"></div>
    </div>

    <div class="card">
      <div class="card-header">
        <h2>Endpoint Explorer</h2>
        <div class="actions">
          <button class="icon-btn" id="scanBtn" title="Scan for Endpoints">⟳ Scan</button>
        </div>
      </div>
      <div class="list" id="endpointsList"></div>
    </div>

    <div class="card">
      <div class="card-header">
        <h2>Actions</h2>
        <div class="actions">
          <button class="icon-btn" id="newActionBtn" title="New Action">+</button>
        </div>
      </div>
      <div class="list" id="actionsList"></div>
    </div>
  </div>

  <div class="footer-note">
    This tab is a companion to the DevLens sidebar (Activity Bar icon) — same data, same commands, just living
    in the editor area instead. Use whichever fits how you work; changes made in one show up in the other.
  </div>

<script>
  const vscode = acquireVsCodeApi();

  function run(command, args) {
    vscode.postMessage({ type: "runCommand", command, args: args || [] });
  }

  document.getElementById("newBugBtn").addEventListener("click", () => run("devlens.newBug"));
  document.getElementById("refreshBugsBtn").addEventListener("click", () => run("devlens.refreshBugs"));
  document.getElementById("scanBtn").addEventListener("click", () => run("devlens.scanEndpoints"));
  document.getElementById("newActionBtn").addEventListener("click", () => run("devlens.newAction"));

  function esc(s) {
    return (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function renderBugs(bugs) {
    const el = document.getElementById("bugsList");
    if (!bugs.length) {
      el.innerHTML = '<div class="empty">No bugs logged yet.<br/><a id="logBugLink">Log a Bug</a></div>';
      document.getElementById("logBugLink").addEventListener("click", () => run("devlens.newBug"));
      return;
    }
    el.innerHTML = bugs.map(b =>
      '<div class="list-item" data-id="' + b.id + '">' +
        '<div class="title"><span class="badge ' + b.status + '">' + b.status + '</span>' + esc(b.title) + '</div>' +
        '<div class="meta">' + esc((b.tags || []).join(", ")) + '</div>' +
      '</div>'
    ).join("");
    el.querySelectorAll(".list-item").forEach(node => {
      node.addEventListener("click", () => run("devlens.openBug", [node.getAttribute("data-id")]));
    });
  }

  function renderEndpoints(endpoints, hasProject) {
    const el = document.getElementById("endpointsList");
    if (!hasProject) {
      el.innerHTML = '<div class="empty">Open a folder to scan it for Django endpoints.</div>';
      return;
    }
    if (!endpoints.length) {
      el.innerHTML = '<div class="empty">No endpoints scanned yet for this project.<br/><a id="scanLink">Scan for Endpoints</a></div>';
      document.getElementById("scanLink").addEventListener("click", () => run("devlens.scanEndpoints"));
      return;
    }
    el.innerHTML = endpoints.map(e =>
      '<div class="list-item" data-id="' + e.id + '">' +
        '<div class="title">' + esc(e.method) + ' ' + esc(e.path) + '</div>' +
        '<div class="meta">' + esc(e.view) + '</div>' +
      '</div>'
    ).join("");
    el.querySelectorAll(".list-item").forEach(node => {
      node.addEventListener("click", () => run("devlens.openEndpoint", [node.getAttribute("data-id")]));
    });
  }

  function renderActions(actions, hasProject) {
    const el = document.getElementById("actionsList");
    if (!hasProject) {
      el.innerHTML = '<div class="empty">Open a folder to see its Actions.</div>';
      return;
    }
    if (!actions.length) {
      el.innerHTML = '<div class="empty">No actions yet.</div>';
      return;
    }
    el.innerHTML = actions.map(a => {
      const modeIcon = a.execution_mode === "learning" ? "📘" : "⚡";
      const checked = a.execution_mode === "automation" ? "checked" : "";
      return '<div class="list-item" data-id="' + a.id + '">' +
        '<div class="action-row">' +
          '<div class="title">' + modeIcon + ' ' + esc(a.name) + '</div>' +
          '<div class="action-controls">' +
            '<label class="mode-switch" title="Learning (confirm each run) / Automation (run immediately)">' +
              '<input type="checkbox" class="mode-toggle" data-id="' + a.id + '" ' + checked + ' />' +
              '<span class="track"></span>' +
            '</label>' +
            '<button class="icon-btn delete-btn" data-id="' + a.id + '" title="Delete Action">🗑</button>' +
          '</div>' +
        '</div>' +
        '<div class="meta">' + a.steps.length + ' step' + (a.steps.length === 1 ? "" : "s") +
          (a.built_in ? " · built-in" : "") + '</div>' +
      '</div>';
    }).join("");

    el.querySelectorAll(".list-item").forEach(node => {
      node.addEventListener("click", () => run("devlens.runAction", [node.getAttribute("data-id")]));
    });
    el.querySelectorAll(".mode-toggle").forEach(node => {
      node.addEventListener("click", (e) => e.stopPropagation());
      node.addEventListener("change", (e) => {
        e.stopPropagation();
        run("devlens.toggleExecutionMode", [node.getAttribute("data-id")]);
      });
    });
    el.querySelectorAll(".delete-btn").forEach(node => {
      node.addEventListener("click", (e) => {
        e.stopPropagation();
        run("devlens.deleteAction", [node.getAttribute("data-id")]);
      });
    });
  }

  window.addEventListener("message", (event) => {
    const msg = event.data;
    if (msg.type !== "data") return;
    document.getElementById("subtitleText").textContent = msg.hasProject
      ? "Project: " + msg.projectName + (msg.frontendPath ? " · Frontend: " + msg.frontendPath : "")
      : "No folder open — open a project folder to see endpoints and actions.";
    renderBugs(msg.bugs);
    renderEndpoints(msg.endpoints, msg.hasProject);
    renderActions(msg.actions, msg.hasProject);
  });

  vscode.postMessage({ type: "refresh" });
</script>
</body>
</html>`;
  }
}
