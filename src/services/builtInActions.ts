import { ActionStep } from "../types";

// Ported as-is from devlens-main/devlens/backend/api.py's BUILT_IN_ACTIONS.
// Seeded into storage the first time a workspace's actions are loaded, then
// stored like any other Action - this is only ever read for a brand-new
// project, never re-applied over a user's edits (see ActionsService.seed).
export const BUILT_IN_ACTIONS: Record<string, { name: string; steps: ActionStep[] }> = {
  build_frontend: {
    name: "Build Frontend",
    steps: [
      {
        type: "command",
        command: "npm run build",
        cwd: "frontend",
        explanation: "Builds the production version of the frontend.",
      },
      {
        type: "operation",
        operation: "Copy the generated dist folder.",
        explanation: "Copies the production build output.",
      },
      {
        type: "operation",
        operation: "Move or copy the folder to the configured backend directory.",
        explanation: "Makes the latest frontend available to the backend for serving.",
      },
    ],
  },
  python_migrations: {
    name: "Python Migrations",
    steps: [
      {
        type: "command",
        command: "python manage.py makemigrations",
        cwd: "project",
        explanation: "Creates new migration files based on changes made to Django models.",
      },
      {
        type: "command",
        command: "python manage.py migrate",
        cwd: "project",
        explanation: "Applies all pending migrations to the project's database.",
      },
    ],
  },
};
