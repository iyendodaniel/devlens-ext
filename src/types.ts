// Ported from devlens-ui-main/src/lib/api.ts. Shapes are kept identical to
// the original SQLite rows/DevLensApi contract on purpose - anything reusing
// your mental model of the data (or a future storage migration) benefits
// from the field names not drifting for no reason.

export type BugStatus = "open" | "investigating" | "resolved";

export interface Bug {
  id: string;
  title: string;
  tags: string[];
  status: BugStatus;
  description: string;
  steps: string;
  solution: string;
  created_at: string;
  updated_at: string;
}

export interface ProjectSettings {
  // Keyed by workspace folder fsPath in storage - this id is just the
  // fsPath again, kept as a field so callers don't need to thread the path
  // separately. There's no more freestanding "add a project" flow (see
  // ProjectService); a ProjectSettings record is created lazily the first
  // time a workspace needs frontend_path or build_destination_path set.
  id: string; // == workspace folder fsPath
  name: string; // workspace folder basename, for display only
  frontend_path: string | null;
  build_destination_path: string | null;
  // Keys of built-in actions (from BUILT_IN_ACTIONS) the user has deleted.
  // ActionsService checks this before reseeding so a deleted built-in
  // doesn't silently come back on the next getActions() call.
  deleted_builtin_keys?: string[];
}

export type ExecutionMode = "learning" | "automation";

export interface CommandStep {
  type: "command";
  command: string;
  cwd: "project" | "frontend";
  explanation: string;
}

export interface OperationStep {
  type: "operation";
  operation: string;
  explanation: string;
}

export type ActionStep = CommandStep | OperationStep;

export interface Action {
  id: string;
  project_id: string; // workspace folder fsPath
  key: string; // "build_frontend" | "python_migrations" | custom id
  name: string;
  built_in: boolean;
  execution_mode: ExecutionMode;
  steps: ActionStep[];
  created_at: string;
  updated_at: string;
}

export interface Endpoint {
  id: string;
  project_id: string; // workspace folder fsPath
  method: string; // "GET" | "POST" | ... | "GET/POST" for multi-method views
  path: string;
  view: string;
  app: string;
  last_scanned: string;
  ai_notes: string;
  ai_notes_generated_at: string | null;
}

// Raw shape returned by scripts/scanner.py on stdout, before it's turned
// into a full Endpoint record (id/project_id/timestamps get added by
// ScannerService, not by the Python script itself).
export interface ScannedEndpoint {
  method: string;
  path: string;
  view: string;
  app: string;
}
