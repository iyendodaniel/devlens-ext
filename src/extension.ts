import * as vscode from "vscode";
import { StorageService } from "./services/storageService";
import { ProjectService } from "./services/projectService";
import { ScannerService } from "./services/scannerService";
import { ActionsService } from "./services/actionsService";
import { CommandRunnerService } from "./services/commandRunnerService";
import { BuildFrontendService } from "./services/buildFrontendService";
import { BugsTreeProvider } from "./providers/bugsTreeProvider";
import { EndpointsTreeProvider } from "./providers/endpointsTreeProvider";
import { ActionsTreeProvider } from "./providers/actionsTreeProvider";
import { registerCommands } from "./commands/registerCommands";
import { DashboardPanel } from "./panels/dashboardPanel";

// This is what replaces main.py's `webview.create_window(...); webview.start()`.
// There's no window to build - VS Code is already the window. Activation is
// just: stand up storage, wire the tree views, register commands.
export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const storage = new StorageService(context);
  await storage.init();

  const projects = new ProjectService(storage);
  const scanner = new ScannerService(context.extensionUri);
  const actionsService = new ActionsService(storage);
  const commandRunner = new CommandRunnerService();
  const buildFrontend = new BuildFrontendService();

  const bugsProvider = new BugsTreeProvider(storage);
  const endpointsProvider = new EndpointsTreeProvider(storage, projects);
  const actionsProvider = new ActionsTreeProvider(actionsService, projects);

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider("devlens.bugsView", bugsProvider),
    vscode.window.registerTreeDataProvider("devlens.endpointsView", endpointsProvider),
    vscode.window.registerTreeDataProvider("devlens.actionsView", actionsProvider),
  );

  // Keep the dashboard tab (if open) in sync with the sidebar trees,
  // whichever one changed - one hook here instead of threading a refresh
  // call through every command that mutates bugs/endpoints/actions.
  context.subscriptions.push(
    bugsProvider.onDidChangeTreeData(() => DashboardPanel.refreshIfOpen()),
    endpointsProvider.onDidChangeTreeData(() => DashboardPanel.refreshIfOpen()),
    actionsProvider.onDidChangeTreeData(() => DashboardPanel.refreshIfOpen()),
  );

  registerCommands(
    context,
    { storage, projects, scanner, actions: actionsService, commandRunner, buildFrontend },
    { bugs: bugsProvider, endpoints: endpointsProvider, actionsTree: actionsProvider },
  );

  // Endpoint Explorer and Actions are workspace-scoped - if the user
  // switches workspace folders (or opens/closes one), both trees need to
  // reflect the new "current project" without requiring a manual refresh.
  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      endpointsProvider.refresh();
      actionsProvider.refresh();
      DashboardPanel.refreshIfOpen();
    }),
  );
}

export function deactivate(): void {
  // No teardown needed - no window, no DB connection, no subprocess left
  // running. Everything above is registered via context.subscriptions,
  // which VS Code disposes automatically.
}
