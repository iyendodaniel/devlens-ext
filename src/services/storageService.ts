import * as vscode from "vscode";
import * as path from "path";
import * as crypto from "crypto";
import { Bug, Action, Endpoint, ProjectSettings } from "../types";

/**
 * Flat-JSON replacement for db.py's SQLite. One file per table, same shape
 * as the old rows. Everything is loaded/saved whole — fine at this scale
 * (a single developer's bugs/endpoints/actions), and it removes the native
 * dependency question entirely.
 *
 * Layout, under context.globalStorageUri (VS Code-managed, survives
 * updates, one folder per extension — this is the direct equivalent of the
 * old `~/.devlens/` folder):
 *   bugs.json                    -> Bug[]
 *   projects.json                -> ProjectSettings[]
 *   endpoints/<projectId>.json   -> Endpoint[]   (projectId = workspace fsPath, slugified)
 *   actions/<projectId>.json     -> Action[]
 */
export class StorageService {
  private readonly root: vscode.Uri;

  constructor(context: vscode.ExtensionContext) {
    this.root = context.globalStorageUri;
  }

  async init(): Promise<void> {
    await vscode.workspace.fs.createDirectory(this.root);
    await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(this.root, "endpoints"));
    await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(this.root, "actions"));
  }

  // ---- low-level JSON read/write, shared by every table ----

  private async readJson<T>(uri: vscode.Uri, fallback: T): Promise<T> {
    try {
      const bytes = await vscode.workspace.fs.readFile(uri);
      return JSON.parse(Buffer.from(bytes).toString("utf8")) as T;
    } catch {
      return fallback; // file doesn't exist yet == empty table, matches
      // db.py's `CREATE TABLE IF NOT EXISTS` behaving as a no-op on reads.
    }
  }

  private async writeJson(uri: vscode.Uri, data: unknown): Promise<void> {
    const bytes = Buffer.from(JSON.stringify(data, null, 2), "utf8");
    await vscode.workspace.fs.writeFile(uri, bytes);
  }

  /** Slug used for per-project filenames — projectId is a full fsPath,
   * which isn't a safe filename as-is. */
  private slug(projectId: string): string {
    return Buffer.from(projectId).toString("base64url");
  }

  // ---- Bugs (project-agnostic, exactly like the original) ----

  private bugsUri() {
    return vscode.Uri.joinPath(this.root, "bugs.json");
  }

  async getBugs(): Promise<Bug[]> {
    const bugs = await this.readJson<Bug[]>(this.bugsUri(), []);
    return [...bugs].sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1));
  }

  async getBug(id: string): Promise<Bug | null> {
    const bugs = await this.readJson<Bug[]>(this.bugsUri(), []);
    return bugs.find((b) => b.id === id) ?? null;
  }

  async createBug(data: Partial<Bug>): Promise<Bug> {
    const bugs = await this.readJson<Bug[]>(this.bugsUri(), []);
    const now = new Date().toISOString();
    const bug: Bug = {
      id: `b_${cryptoRandomId()}`,
      title: data.title ?? "Untitled bug",
      tags: data.tags ?? [],
      status: data.status ?? "open",
      description: data.description ?? "",
      steps: data.steps ?? "",
      solution: data.solution ?? "",
      created_at: now,
      updated_at: now,
    };
    bugs.push(bug);
    await this.writeJson(this.bugsUri(), bugs);
    return bug;
  }

  async updateBug(id: string, patch: Partial<Bug>): Promise<Bug | null> {
    const bugs = await this.readJson<Bug[]>(this.bugsUri(), []);
    const idx = bugs.findIndex((b) => b.id === id);
    if (idx === -1) return null;
    const merged: Bug = { ...bugs[idx], ...patch, updated_at: new Date().toISOString() };
    bugs[idx] = merged;
    await this.writeJson(this.bugsUri(), bugs);
    return merged;
  }

  async deleteBug(id: string): Promise<void> {
    const bugs = await this.readJson<Bug[]>(this.bugsUri(), []);
    await this.writeJson(
      this.bugsUri(),
      bugs.filter((b) => b.id !== id),
    );
  }

  // ---- Project settings (frontend_path / build_destination_path only —
  // "which project" itself is the workspace folder, see ProjectService) ----

  private projectsUri() {
    return vscode.Uri.joinPath(this.root, "projects.json");
  }

  async getProjectSettings(projectId: string): Promise<ProjectSettings | null> {
    const projects = await this.readJson<ProjectSettings[]>(this.projectsUri(), []);
    return projects.find((p) => p.id === projectId) ?? null;
  }

  async upsertProjectSettings(patch: Partial<ProjectSettings> & { id: string }): Promise<ProjectSettings> {
    const projects = await this.readJson<ProjectSettings[]>(this.projectsUri(), []);
    const idx = projects.findIndex((p) => p.id === patch.id);
    const base: ProjectSettings = {
      id: patch.id,
      name: path.basename(patch.id),
      frontend_path: null,
      build_destination_path: null,
    };
    const merged = { ...(idx === -1 ? base : projects[idx]), ...patch };
    if (idx === -1) projects.push(merged);
    else projects[idx] = merged;
    await this.writeJson(this.projectsUri(), projects);
    return merged;
  }

  // ---- Endpoints (scoped per project) ----

  private endpointsUri(projectId: string) {
    return vscode.Uri.joinPath(this.root, "endpoints", `${this.slug(projectId)}.json`);
  }

  async getEndpoints(projectId: string): Promise<Endpoint[]> {
    return this.readJson<Endpoint[]>(this.endpointsUri(projectId), []);
  }

  async getEndpoint(projectId: string, id: string): Promise<Endpoint | null> {
    const endpoints = await this.getEndpoints(projectId);
    return endpoints.find((e) => e.id === id) ?? null;
  }

  async replaceEndpoints(projectId: string, endpoints: Endpoint[]): Promise<void> {
    // Mirrors api.py's scanEndpoints: DELETE all rows for this project,
    // then INSERT the freshly scanned set. A rescan is always a full
    // replace, never a diff/merge.
    await this.writeJson(this.endpointsUri(projectId), endpoints);
  }

  async updateEndpoint(projectId: string, id: string, patch: Partial<Endpoint>): Promise<Endpoint | null> {
    const endpoints = await this.getEndpoints(projectId);
    const idx = endpoints.findIndex((e) => e.id === id);
    if (idx === -1) return null;
    const merged = { ...endpoints[idx], ...patch };
    endpoints[idx] = merged;
    await this.replaceEndpoints(projectId, endpoints);
    return merged;
  }

  // ---- Actions (scoped per project) ----

  private actionsUri(projectId: string) {
    return vscode.Uri.joinPath(this.root, "actions", `${this.slug(projectId)}.json`);
  }

  async getActionsRaw(projectId: string): Promise<Action[]> {
    return this.readJson<Action[]>(this.actionsUri(projectId), []);
  }

  async saveActions(projectId: string, actions: Action[]): Promise<void> {
    await this.writeJson(this.actionsUri(projectId), actions);
  }

  async createAction(projectId: string, name: string): Promise<Action> {
    const actions = await this.getActionsRaw(projectId);
    const now = new Date().toISOString();
    const action: Action = {
      id: `act_${cryptoRandomId()}`,
      project_id: projectId,
      key: `custom_${cryptoRandomId()}`,
      name,
      built_in: false,
      execution_mode: "learning",
      steps: [],
      created_at: now,
      updated_at: now,
    };
    actions.push(action);
    await this.saveActions(projectId, actions);
    return action;
  }

  async updateAction(projectId: string, id: string, patch: Partial<Action>): Promise<Action | null> {
    const actions = await this.getActionsRaw(projectId);
    const idx = actions.findIndex((a) => a.id === id);
    if (idx === -1) return null;
    const merged: Action = { ...actions[idx], ...patch, updated_at: new Date().toISOString() };
    actions[idx] = merged;
    await this.saveActions(projectId, actions);
    return merged;
  }

  /** Removes the action record. Built-in-vs-custom tombstoning (so a
   * deleted built-in doesn't reappear) is handled by ActionsService, which
   * calls this after recording the tombstone. */
  async deleteAction(projectId: string, id: string): Promise<Action | null> {
    const actions = await this.getActionsRaw(projectId);
    const idx = actions.findIndex((a) => a.id === id);
    if (idx === -1) return null;
    const [removed] = actions.splice(idx, 1);
    await this.saveActions(projectId, actions);
    return removed;
  }
}

function cryptoRandomId(): string {
  // 8 hex chars, matching uuid.uuid4().hex[:8] from the original api.py.
  return crypto.randomBytes(4).toString("hex");
}
