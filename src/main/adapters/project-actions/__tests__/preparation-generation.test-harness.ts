import { decodeUnknownExactOrThrow } from '@shared/schema'
import { storedWorkspacePreparationSchema } from '@shared/schemas/workspace-preparation'
import type { ActionCatalog } from '@shared/types/action-definitions'
import { fromPartial } from '@total-typescript/shoehorn'
import * as Effect from 'effect/Effect'
import type { ActionRunWorkspace } from '../../../ports/action-run-service'
import type { LinkedWorktreeCheck } from '../../../ports/git-worktree-service'
import {
  ManagedWorkspacePreparation,
  type PreparationDependencies,
} from '../managed-workspace-preparation'
import type { StoredWorkspacePreparation } from '../preparation-persistence'

export const catalog: ActionCatalog = {
  revision: 'one',
  actions: [],
  profiles: [{ source: 'local', definition: { id: 'default', name: 'Default' } }],
  preparation: [],
}

/**
 * In-memory persistence that decodes and compares revisions as the SQLite one does. Every folder
 * counts as a finished linked worktree unless `linkedWorktree` says otherwise.
 */
export function memoryDeps(
  linkedWorktree: (candidatePath: string) => Promise<LinkedWorktreeCheck> = async () => 'linked',
) {
  const storage = new Map<string, StoredWorkspacePreparation>()
  const deps = fromPartial<PreparationDependencies>({
    catalog: async () => catalog,
    persistence: {
      read: async (id: string) => storage.get(id) ?? null,
      list: async () => [...storage.values()],
      write: async (state: StoredWorkspacePreparation, expectedRevision: number) => {
        if ((storage.get(state.workspaceId)?.revision ?? 0) !== expectedRevision)
          throw new Error('Workspace preparation changed. Reload before continuing.')
        const valid = decodeUnknownExactOrThrow(storedWorkspacePreparationSchema, state)
        storage.set(state.workspaceId, structuredClone(valid))
      },
    },
    inspectLinkedWorktree: (_projectPath: string, candidatePath: string) =>
      linkedWorktree(candidatePath),
  })
  return { storage, deps }
}

/** The Host-side service shape the agent run uses, over a fresh engine as after a Host start. */
export function restartedService(deps: PreparationDependencies) {
  const engine = new ManagedWorkspacePreparation(deps)
  return {
    engine,
    service: {
      read: (workspace: ActionRunWorkspace) => Effect.promise(() => engine.read(workspace)),
      inspectWorkspaceGeneration: (workspace: ActionRunWorkspace) =>
        Effect.promise(() => engine.inspectWorkspaceGeneration(workspace)),
      completeWorktreeBirth: (workspace: ActionRunWorkspace) =>
        Effect.tryPromise({
          try: () => engine.completeWorktreeBirth(workspace),
          catch: (error) => (error instanceof Error ? error : new Error(String(error))),
        }),
      owesSetupAfterRunBirth: (workspace: ActionRunWorkspace) =>
        Effect.promise(() => engine.owesSetupAfterRunBirth(workspace)),
      requireSetup: (workspace: ActionRunWorkspace) =>
        Effect.promise(() => engine.requireSetup(workspace)),
      environment: (workspaceId: string) => Effect.promise(() => engine.environment(workspaceId)),
    },
  }
}
