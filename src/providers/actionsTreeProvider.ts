import * as vscode from "vscode";
import { Action, ActionStep } from "../types";
import { ActionsService } from "../services/actionsService";
import { ProjectService } from "../services/projectService";

function stepLabel(step: ActionStep): string {
  return step.type === "command" ? step.command : step.operation;
}

export class ActionsTreeProvider implements vscode.TreeDataProvider<Action> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(
    private readonly actionsService: ActionsService,
    private readonly projects: ProjectService,
  ) {}

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(action: Action): vscode.TreeItem {
    const modeLabel = action.execution_mode === "learning" ? "Learning" : "Automation";
    const item = new vscode.TreeItem(action.name, vscode.TreeItemCollapsibleState.None);
    item.description = `${modeLabel} · ${action.steps.length} step${action.steps.length === 1 ? "" : "s"}${
      action.built_in ? " · built-in" : ""
    }`;
    item.tooltip = new vscode.MarkdownString(
      `**${modeLabel} mode** — ${
        action.execution_mode === "learning"
          ? "shows every step before running, nothing executes until you confirm."
          : "runs all steps immediately, no confirmation."
      }\n\n` + action.steps.map((s, i) => `${i + 1}. ${stepLabel(s)} — ${s.explanation}`).join("\n\n"),
    );
    item.contextValue = "action";
    item.iconPath = new vscode.ThemeIcon(action.execution_mode === "learning" ? "book" : "zap");
    item.command = {
      command: "devlens.runAction",
      title: "Run Action",
      arguments: [action.id],
    };
    return item;
  }

  async getChildren(element?: Action): Promise<Action[]> {
    if (element) return [];
    const projectId = this.projects.getCurrentProjectId();
    if (!projectId) return [];
    return this.actionsService.getActions(projectId);
  }
}
