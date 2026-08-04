import * as vscode from "vscode";
import { Endpoint } from "../types";
import { StorageService } from "../services/storageService";
import { ProjectService } from "../services/projectService";

type TreeNode = { kind: "app"; app: string; endpoints: Endpoint[] } | { kind: "endpoint"; endpoint: Endpoint };

export class EndpointsTreeProvider implements vscode.TreeDataProvider<TreeNode> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(
    private readonly storage: StorageService,
    private readonly projects: ProjectService,
  ) {}

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: TreeNode): vscode.TreeItem {
    if (element.kind === "app") {
      const item = new vscode.TreeItem(
        `${element.app} (${element.endpoints.length})`,
        vscode.TreeItemCollapsibleState.Expanded,
      );
      item.contextValue = "app";
      item.iconPath = new vscode.ThemeIcon("symbol-namespace");
      return item;
    }

    const ep = element.endpoint;
    const item = new vscode.TreeItem(`${ep.method} ${ep.path}`, vscode.TreeItemCollapsibleState.None);
    item.description = ep.view;
    item.tooltip = ep.ai_notes || `${ep.view} - last scanned ${ep.last_scanned}`;
    item.contextValue = "endpoint";
    item.iconPath = new vscode.ThemeIcon(methodIcon(ep.method));
    item.command = {
      command: "devlens.openEndpoint",
      title: "Open Endpoint",
      arguments: [ep.id],
    };
    return item;
  }

  async getChildren(element?: TreeNode): Promise<TreeNode[]> {
    const projectId = this.projects.getCurrentProjectId();
    if (!projectId) return [];
    const endpoints = await this.storage.getEndpoints(projectId);

    if (!element) {
      const apps = [...new Set(endpoints.map((e) => e.app))].sort();
      return apps.map((app) => ({
        kind: "app",
        app,
        endpoints: endpoints.filter((e) => e.app === app).sort((a, b) => a.path.localeCompare(b.path)),
      }));
    }

    if (element.kind === "app") {
      return element.endpoints.map((endpoint) => ({ kind: "endpoint", endpoint }));
    }

    return [];
  }
}

function methodIcon(method: string): string {
  if (method.includes("POST")) return "diff-added";
  if (method.includes("DELETE")) return "diff-removed";
  if (method.includes("PUT") || method.includes("PATCH")) return "diff-modified";
  return "arrow-right";
}
