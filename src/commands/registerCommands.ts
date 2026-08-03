import * as vscode from "vscode";
import { StorageService } from "../services/storageService";
import { ProjectService } from "../services/projectService";
import { ScannerService } from "../services/scannerService";
import { ActionsService } from "../services/actionsService";
import { CommandRunnerService } from "../services/commandRunnerService";
import { BuildFrontendService } from "../services/buildFrontendService";
import { BugsTreeProvider } from "../providers/bugsTreeProvider";
import { EndpointsTreeProvider } from "../providers/endpointsTreeProvider";
import { ActionsTreeProvider } from "../providers/actionsTreeProvider";
import { BugEditorPanel } from "../panels/bugEditorPanel";
import { EndpointDetailPanel } from "../panels/endpointDetailPanel";
import { ActionEditorPanel } from "../panels/actionEditorPanel";
import { DashboardPanel } from "../panels/dashboardPanel";
import { Endpoint } from "../types";
import * as crypto from "crypto";

export interface Services {
  storage: StorageService;
  projects: ProjectService;
  scanner: ScannerService;
  actions: ActionsService;
  commandRunner: CommandRunnerService;
  buildFrontend: BuildFrontendService;
}

export interface Providers {
  bugs: BugsTreeProvider;
  endpoints: EndpointsTreeProvider;
  actionsTree: ActionsTreeProvider;
}

/** Requires a workspace folder to be open — most commands are project-
 * scoped (see the workspace-folder-scoping decision). Shows a clear error
 * instead of silently no-oping when there isn't one. */
function requireProjectId(projects: ProjectService): string | null {
  const projectId = projects.getCurrentProjectId();
  if (!projectId) {
    void vscode.window.showErrorMessage("DevLens: open a folder first — this needs a project workspace.");
    return null;
  }
  return projectId;
}

export function registerCommands(
  context: vscode.ExtensionContext,
  services: Services,
  providers: Providers,
): void {
  const { storage, projects, scanner, actions, commandRunner, buildFrontend } = services;
  const { bugs, endpoints, actionsTree } = providers;

  // ---- Bug Book ----

  context.subscriptions.push(
    vscode.commands.registerCommand("devlens.newBug", () =>
      BugEditorPanel.open(storage, () => bugs.refresh()),
    ),

    vscode.commands.registerCommand("devlens.openBug", (bugId: string) =>
      BugEditorPanel.open(storage, () => bugs.refresh(), bugId),
    ),

    vscode.commands.registerCommand("devlens.deleteBug", async (bugIdOrNode: string | { bug?: { id: string } }) => {
      const bugId = typeof bugIdOrNode === "string" ? bugIdOrNode : bugIdOrNode?.bug?.id;
      if (!bugId) return;
      const confirm = await vscode.window.showWarningMessage(
        "Delete this bug? This can't be undone.",
        { modal: true },
        "Delete",
      );
      if (confirm !== "Delete") return;
      await storage.deleteBug(bugId);
      bugs.refresh();
    }),

    vscode.commands.registerCommand("devlens.refreshBugs", () => bugs.refresh()),
  );

  // ---- Endpoint Explorer ----

  context.subscriptions.push(
    vscode.commands.registerCommand("devlens.scanEndpoints", async () => {
      const projectId = requireProjectId(projects);
      if (!projectId) return;

      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: "DevLens: Scanning for endpoints…" },
        async () => {
          try {
            const found = await scanner.scan(projectId);
            const now = new Date().toISOString();
            const records: Endpoint[] = found.map((ep) => ({
              id: `e_${crypto.randomBytes(4).toString("hex")}`,
              project_id: projectId,
              method: ep.method,
              path: ep.path,
              view: ep.view,
              app: ep.app,
              last_scanned: now,
              ai_notes: "",
              ai_notes_generated_at: null,
            }));
            await storage.replaceEndpoints(projectId, records);
            endpoints.refresh();
            void vscode.window.showInformationMessage(`DevLens: found ${records.length} endpoint(s).`);
          } catch (e) {
            void vscode.window.showErrorMessage(`DevLens scan failed: ${(e as Error).message}`);
          }
        },
      );
    }),

    vscode.commands.registerCommand("devlens.openEndpoint", async (endpointId: string) => {
      const projectId = requireProjectId(projects);
      if (!projectId) return;
      await EndpointDetailPanel.open(storage, projectId, endpointId, () => endpoints.refresh());
    }),

    vscode.commands.registerCommand("devlens.refreshEndpoints", () => endpoints.refresh()),
  );

  // ---- Actions ----

  context.subscriptions.push(
    vscode.commands.registerCommand("devlens.newAction", async () => {
      const projectId = requireProjectId(projects);
      if (!projectId) return;
      const name = await vscode.window.showInputBox({ prompt: "Name for the new action" });
      if (!name) return;
      const action = await storage.createAction(projectId, name);
      actionsTree.refresh();
      await ActionEditorPanel.open(storage, projectId, action.id, () => actionsTree.refresh());
    }),

    vscode.commands.registerCommand("devlens.editAction", async (actionIdOrNode: string | { id?: string }) => {
      const projectId = requireProjectId(projects);
      if (!projectId) return;
      const actionId = typeof actionIdOrNode === "string" ? actionIdOrNode : actionIdOrNode?.id;
      if (!actionId) return;
      await ActionEditorPanel.open(storage, projectId, actionId, () => actionsTree.refresh());
    }),

    vscode.commands.registerCommand(
      "devlens.toggleExecutionMode",
      async (actionIdOrNode: string | { id?: string; execution_mode?: string }) => {
        const projectId = requireProjectId(projects);
        if (!projectId) return;
        const actionId = typeof actionIdOrNode === "string" ? actionIdOrNode : actionIdOrNode?.id;
        if (!actionId) return;

        const allActions = await actions.getActions(projectId);
        const action = allActions.find((a) => a.id === actionId);
        if (!action) return;

        const nextMode = action.execution_mode === "learning" ? "automation" : "learning";
        await storage.updateAction(projectId, actionId, { execution_mode: nextMode });
        actionsTree.refresh();
      },
    ),

    vscode.commands.registerCommand("devlens.runAction", async (actionIdOrNode: string | { id?: string }) => {
      const projectId = requireProjectId(projects);
      if (!projectId) return;
      const actionId = typeof actionIdOrNode === "string" ? actionIdOrNode : actionIdOrNode?.id;
      if (!actionId) return;

      const allActions = await actions.getActions(projectId);
      const action = allActions.find((a) => a.id === actionId);
      if (!action) return;

      // Learning mode: show exactly what's about to run and require an
      // explicit confirmation, matching the original web app's PreviewDialog.
      // Automation mode skips straight to execution below.
      if (action.execution_mode === "learning") {
        const stepsText = action.steps
          .map((s, i) => `${i + 1}. ${s.type === "command" ? s.command : s.operation}\n   ${s.explanation}`)
          .join("\n\n");
        const confirm = await vscode.window.showInformationMessage(
          `Run "${action.name}"?`,
          { modal: true, detail: `This will run, in order:\n\n${stepsText}` },
          "Run Action",
        );
        if (confirm !== "Run Action") return;
      }

      const settings = await projects.getSettings(projectId);

      // Build Frontend is special-cased exactly like the original api.py:
      // real npm-build-then-copy with OS-specific binary resolution, not
      // generic shell steps run in a terminal.
      if (action.key === "build_frontend") {
        if (!settings.frontend_path) {
          const picked = await projects.promptSetFrontendPath(projectId);
          if (!picked?.frontend_path) return;
        }
        const fresh = await projects.getSettings(projectId);
        const buildResult = await buildFrontend.build(fresh);
        if (!buildResult.ok) {
          void vscode.window.showErrorMessage(`DevLens: build failed — ${buildResult.error}`);
          return;
        }

        let destination = fresh.build_destination_path;
        if (!destination) {
          const picked = await projects.promptSetBuildDestination(projectId);
          destination = picked?.build_destination_path ?? null;
        }
        if (!destination) {
          void vscode.window.showInformationMessage("DevLens: build succeeded (no destination set, skipped copy).");
          return;
        }

        const copyResult = await buildFrontend.copyDistTo(fresh, destination);
        if (copyResult.ok) {
          void vscode.window.showInformationMessage(`DevLens: ${copyResult.output}`);
        } else {
          void vscode.window.showErrorMessage(`DevLens: copy failed — ${copyResult.error}`);
        }
        return;
      }

      // Every other action (Python Migrations, custom actions) runs its
      // command steps in a real terminal.
      await commandRunner.runAction(action, projectId, settings);
    }),

    vscode.commands.registerCommand("devlens.deleteAction", async (actionIdOrNode: string | { id?: string; name?: string }) => {
      const projectId = requireProjectId(projects);
      if (!projectId) return;
      const actionId = typeof actionIdOrNode === "string" ? actionIdOrNode : actionIdOrNode?.id;
      if (!actionId) return;

      const allActions = await actions.getActions(projectId);
      const action = allActions.find((a) => a.id === actionId);
      if (!action) return;

      const confirm = await vscode.window.showWarningMessage(
        `Delete "${action.name}"?`,
        {
          modal: true,
          detail: action.built_in
            ? "This is a built-in action. Deleting it won't bring it back automatically — you can recreate it manually if you change your mind."
            : "This can't be undone.",
        },
        "Delete",
      );
      if (confirm !== "Delete") return;

      await actions.deleteAction(projectId, actionId);
      actionsTree.refresh();
    }),

    vscode.commands.registerCommand("devlens.setFrontendPath", async () => {
      const projectId = requireProjectId(projects);
      if (!projectId) return;
      await projects.promptSetFrontendPath(projectId);
    }),

    vscode.commands.registerCommand("devlens.refreshActions", () => actionsTree.refresh()),
  );

  // ---- Dashboard (editor-area tab) ----

  context.subscriptions.push(
    vscode.commands.registerCommand("devlens.openDashboard", () => {
      DashboardPanel.open(storage, projects, actions);
    }),
  );
}
