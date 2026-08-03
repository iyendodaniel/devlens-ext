import * as vscode from "vscode";
import * as path from "path";
import { ProjectSettings } from "../types";
import { StorageService } from "./storageService";

/**
 * "Project" is no longer a row you create via a folder-picker (api.py's old
 * createProject) — it's just the open workspace. This service is the only
 * place that maps "current workspace folder" -> a project id (its fsPath),
 * and the only place frontend_path/build_destination_path get read or set.
 */
export class ProjectService {
  constructor(private readonly storage: StorageService) {}

  /** The active project, or null if no folder is open (e.g. an empty
   * VS Code window). Endpoint Explorer and Actions both no-op gracefully
   * in that case — see their tree providers' empty states. */
  getCurrentProjectId(): string | null {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) return null;
    // Multi-root workspaces: the first folder is treated as "the" project.
    // Good enough for v1 — the common case (your backend repo, or backend
    // + frontend as two roots in one workspace) has an obvious first root.
    return folders[0].uri.fsPath;
  }

  getCurrentProjectName(): string | null {
    const folders = vscode.workspace.workspaceFolders;
    return folders && folders.length > 0 ? folders[0].name : null;
  }

  async getSettings(projectId: string): Promise<ProjectSettings> {
    const existing = await this.storage.getProjectSettings(projectId);
    if (existing) return existing;
    return this.storage.upsertProjectSettings({ id: projectId });
  }

  /**
   * Heuristic check for "does the currently open workspace folder look
   * like a frontend project itself?" — has a package.json, and that
   * package.json defines a `build` script (what BuildFrontendService
   * actually runs). Good enough to offer as a one-click option; not
   * assumed automatically, since a backend repo can have a package.json
   * too (e.g. for tooling) without being the frontend.
   */
  async currentFolderLooksLikeFrontend(projectId: string): Promise<boolean> {
    try {
      const pkgUri = vscode.Uri.file(path.join(projectId, "package.json"));
      const bytes = await vscode.workspace.fs.readFile(pkgUri);
      const pkg = JSON.parse(Buffer.from(bytes).toString("utf8"));
      return !!(pkg?.scripts && pkg.scripts.build);
    } catch {
      return false;
    }
  }

  /**
   * Opens a native folder picker and saves the result as frontend_path.
   * Direct equivalent of the old setFrontendPath — still a manual step
   * by default, because the frontend repo genuinely can't be *assumed*
   * from a single backend workspace root, especially when it's open in a
   * separate VS Code window entirely. But when the currently open folder
   * itself has a package.json with a build script, offer it as a
   * one-click option instead of forcing a picker for what might already
   * be sitting right there — covers the "my open IDE window IS the
   * frontend" case.
   *
   * Native OS folder pickers give very little room to explain themselves
   * (macOS in particular won't show a custom dialog title at all), so the
   * context goes in a modal *before* the picker opens rather than relying
   * on picker chrome to carry it.
   */
  async promptSetFrontendPath(projectId: string): Promise<ProjectSettings | null> {
    const currentLooksLikeFrontend = await this.currentFolderLooksLikeFrontend(projectId);
    const currentFolderName = this.getCurrentProjectName() ?? path.basename(projectId);
    const useCurrentLabel = `Use "${currentFolderName}" (Currently Open)`;

    if (currentLooksLikeFrontend) {
      const choice = await vscode.window.showInformationMessage(
        `DevLens needs your frontend project's folder — the one with its own package.json, ` +
          `where \`npm run build\` gets run. The folder you have open right now ("${currentFolderName}") ` +
          `looks like it could be that folder — it has a package.json with a build script.`,
        { modal: true },
        useCurrentLabel,
        "Choose a Different Folder",
      );
      if (!choice) return null;
      if (choice === useCurrentLabel) {
        const chosen = await this.storage.upsertProjectSettings({
          id: projectId,
          frontend_path: projectId,
        });
        void vscode.window.showInformationMessage(`DevLens: frontend folder set to ${projectId}`);
        return chosen;
      }
      // "Choose a Different Folder" falls through to the picker below.
    } else {
      const proceed = await vscode.window.showInformationMessage(
        "DevLens needs your frontend project's folder — the one with its own package.json, " +
          "where `npm run build` gets run. Not this backend folder.",
        { modal: true },
        "Choose Folder",
      );
      if (proceed !== "Choose Folder") return null;
    }

    const result = await vscode.window.showOpenDialog({
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      title: "Select the frontend project folder (contains its own package.json)",
      openLabel: "Use This as Frontend Folder",
      defaultUri: vscode.Uri.file(path.dirname(projectId)),
    });
    if (!result || result.length === 0) return null;
    const chosen = await this.storage.upsertProjectSettings({
      id: projectId,
      frontend_path: result[0].fsPath,
    });
    void vscode.window.showInformationMessage(`DevLens: frontend folder set to ${result[0].fsPath}`);
    return chosen;
  }

  async promptSetBuildDestination(projectId: string): Promise<ProjectSettings | null> {
    const proceed = await vscode.window.showInformationMessage(
      "Where should the built frontend go? DevLens will copy the frontend's dist/ folder " +
        "into whatever folder you pick here after every build.",
      { modal: true },
      "Choose Folder",
    );
    if (proceed !== "Choose Folder") return null;

    const result = await vscode.window.showOpenDialog({
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      title: "Select where the built dist/ folder should be copied to",
      openLabel: "Use This as Build Destination",
      defaultUri: vscode.Uri.file(projectId),
    });
    if (!result || result.length === 0) return null;
    const chosen = await this.storage.upsertProjectSettings({
      id: projectId,
      build_destination_path: result[0].fsPath,
    });
    void vscode.window.showInformationMessage(`DevLens: build destination set to ${result[0].fsPath}`);
    return chosen;
  }
}
