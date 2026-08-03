import * as vscode from "vscode";
import { Bug, BugStatus } from "../types";
import { StorageService } from "../services/storageService";

const STATUS_LABEL: Record<BugStatus, string> = {
  open: "Open",
  investigating: "Investigating",
  resolved: "Resolved",
};

const STATUS_ORDER: BugStatus[] = ["open", "investigating", "resolved"];

type TreeNode = { kind: "status"; status: BugStatus; bugs: Bug[] } | { kind: "bug"; bug: Bug };

/**
 * Bug Book stays project-agnostic, exactly like the original — bugs aren't
 * scoped to a workspace folder here either.
 */
export class BugsTreeProvider implements vscode.TreeDataProvider<TreeNode> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private readonly storage: StorageService) {}

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: TreeNode): vscode.TreeItem {
    if (element.kind === "status") {
      const item = new vscode.TreeItem(
        `${STATUS_LABEL[element.status]} (${element.bugs.length})`,
        vscode.TreeItemCollapsibleState.Expanded,
      );
      item.contextValue = "statusGroup";
      return item;
    }

    const bug = element.bug;
    const item = new vscode.TreeItem(bug.title, vscode.TreeItemCollapsibleState.None);
    item.description = bug.tags.join(", ");
    item.tooltip = bug.description || bug.title;
    item.contextValue = "bug";
    item.iconPath = new vscode.ThemeIcon(statusIcon(bug.status));
    item.command = {
      command: "devlens.openBug",
      title: "Open Bug",
      arguments: [bug.id],
    };
    return item;
  }

  async getChildren(element?: TreeNode): Promise<TreeNode[]> {
    const bugs = await this.storage.getBugs();

    if (!element) {
      return STATUS_ORDER.filter((status) => bugs.some((b) => b.status === status)).map((status) => ({
        kind: "status",
        status,
        bugs: bugs.filter((b) => b.status === status),
      }));
    }

    if (element.kind === "status") {
      return element.bugs.map((bug) => ({ kind: "bug", bug }));
    }

    return [];
  }
}

function statusIcon(status: BugStatus): string {
  switch (status) {
    case "open":
      return "circle-outline";
    case "investigating":
      return "search";
    case "resolved":
      return "check";
  }
}
