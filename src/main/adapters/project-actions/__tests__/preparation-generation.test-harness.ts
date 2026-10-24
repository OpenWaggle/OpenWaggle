import type { ActionCatalog } from '@shared/types/action-definitions'
import { fromPartial } from '@total-typescript/shoehorn'
import * as Effect from 'effect/Effect'
import type { ActionRunWorkspace } from '../../../ports/action-run-service'
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

export function memoryDeps() {
  const storage = new Map<string, StoredWorkspacePreparation>()
  const deps = fromPartial<PreparationDependencies>({
    catalog: async () => catalog,
    persistence: {
      read: async (id: string) => storage.get(id) ?? null,
      list: async () => [...storage.values()],
      write: async (state: StoredWorkspacePreparation) => {
        storage.set(state.workspaceId, structuredClone(state))
      },
    },
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
      environment: (workspaceId: string) => Effect.promise(() => engine.environment(workspaceId)),
    },
  }
}
