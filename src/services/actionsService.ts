import * as crypto from "crypto";
import { Action } from "../types";
import { BUILT_IN_ACTIONS } from "./builtInActions";
import { StorageService } from "./storageService";

/** Ported from api.py's getActions: seeds BUILT_IN_ACTIONS into storage the
 * first time a project's actions are read, then leaves them alone forever
 * after - never re-applied over a user's edits. */
export class ActionsService {
  constructor(private readonly storage: StorageService) {}

  async getActions(projectId: string): Promise<Action[]> {
    const existing = await this.storage.getActionsRaw(projectId);
    const have = new Set(existing.map((a) => a.key));
    const settings = await this.storage.getProjectSettings(projectId);
    const dismissed = new Set(settings?.deleted_builtin_keys ?? []);
    const now = new Date().toISOString();

    const seeded = [...existing];
    for (const [key, defaults] of Object.entries(BUILT_IN_ACTIONS)) {
      if (have.has(key)) continue;
      if (dismissed.has(key)) continue; // user deleted this one - don't bring it back
      seeded.push({
        id: `act_${crypto.randomBytes(4).toString("hex")}`,
        project_id: projectId,
        key,
        name: defaults.name,
        built_in: true,
        execution_mode: "learning",
        steps: defaults.steps,
        created_at: now,
        updated_at: now,
      });
    }

    if (seeded.length !== existing.length) {
      await this.storage.saveActions(projectId, seeded);
    }

    // built-in actions first, then custom ones in creation order - same
    // ORDER BY built_in DESC, created_at ASC as the original SQL.
    return seeded.sort((a, b) => {
      if (a.built_in !== b.built_in) return a.built_in ? -1 : 1;
      return a.created_at < b.created_at ? -1 : 1;
    });
  }

  /** Deletes an action. If it's a built-in, its key is recorded on the
   * project's settings so getActions() never reseeds it - otherwise a
   * deleted "Build Frontend"/"Python Migrations" would just come back the
   * next time the actions list is read. Custom actions are just removed. */
  async deleteAction(projectId: string, actionId: string): Promise<void> {
    const existing = await this.storage.getActionsRaw(projectId);
    const action = existing.find((a) => a.id === actionId);
    if (!action) return;

    await this.storage.deleteAction(projectId, actionId);

    if (action.built_in) {
      const settings = await this.storage.getProjectSettings(projectId);
      const dismissed = new Set(settings?.deleted_builtin_keys ?? []);
      dismissed.add(action.key);
      await this.storage.upsertProjectSettings({
        id: projectId,
        deleted_builtin_keys: [...dismissed],
      });
    }
  }

  /** Built-in keys this project has dismissed - exposed mainly so a future
   * "restore built-in actions" command could clear individual entries. */
  async getDismissedBuiltinKeys(projectId: string): Promise<string[]> {
    const settings = await this.storage.getProjectSettings(projectId);
    return settings?.deleted_builtin_keys ?? [];
  }
}
