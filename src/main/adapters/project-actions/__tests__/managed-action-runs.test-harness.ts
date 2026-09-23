import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ActionCatalog, ActionDefinition } from '@shared/types/action-definitions'
import { type ActionRun, isActiveActionRun } from '@shared/types/action-runs'
import { makeTerminalHistoryStore } from '../../terminal/terminal-history-store'
import type { ActionRunPersistence } from '../action-run-persistence'
import { createManagedActionRuns } from '../managed-action-runs'

export async function createManagedActionFixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'managed-action-run-')))
  const records = new Map<string, ActionRun>()
  const requests = new Map<string, string>()
  const requestKey = (workspaceId: string, actionId: string, requestId: string) =>
    JSON.stringify([workspaceId, actionId, requestId])
  const persistence: ActionRunPersistence = {
    get: async (id) => records.get(id) ?? null,
    list: async (workspaceId) =>
      [...records.values()].filter((run) => run.workspaceId === workspaceId),
    recordRequest: async (workspaceId, actionId, requestId, runId) => {
      requests.set(requestKey(workspaceId, actionId, requestId), runId)
    },
    findRequest: async (workspaceId, actionId, requestId) =>
      records.get(requests.get(requestKey(workspaceId, actionId, requestId)) ?? '') ?? null,
    save: async (run) => {
      records.set(run.id, structuredClone(run))
    },
    interruptAfterHostLoss: async () => {
      for (const run of records.values())
        if (isActiveActionRun(run))
          records.set(run.id, { ...run, status: 'interrupted', finishedAt: Date.now() })
    },
  }
  const definition: ActionDefinition = {
    id: 'test',
    name: 'Test',
    icon: 'test',
    invocation: { type: 'command', command: 'test', directory: '.' },
    kind: 'task',
    allowConcurrent: false,
    autoOpenPreview: false,
  }
  let catalog: ActionCatalog = {
    revision: 'one',
    actions: [{ source: 'local', definition }],
    profiles: [],
    preparation: [],
  }
  let validationError: Error | null = null
  let stopError: Error | null = null
  let closeError: Error | null = null
  let launchGate: { promise: Promise<void>; resolve: () => void } | null = null
  let launchEntered: { promise: Promise<void>; resolve: () => void } | null = null
  let rejectLaunchOnAbort = false
  let owners = 0
  const processes: {
    readonly emit: (output: string) => void
    readonly finish: (exitCode: number) => void
    readonly isStopped: () => boolean
  }[] = []
  const errors: unknown[] = []
  const history = makeTerminalHistoryStore(join(root, 'logs'))
  const runs = createManagedActionRuns({
    persistence,
    history,
    runner: {
      validate: async () => {
        if (validationError) throw validationError
      },
      start: async ({ onOutput, signal }) => {
        launchEntered?.resolve()
        if (launchGate) {
          if (rejectLaunchOnAbort && signal)
            await Promise.race([
              launchGate.promise,
              new Promise<never>((_, reject) => {
                signal.addEventListener(
                  'abort',
                  () => reject(new Error('Action launch canceled.')),
                  {
                    once: true,
                  },
                )
              }),
            ])
          else await launchGate.promise
        }
        const closed = Promise.withResolvers<{ exitCode: number | null }>()
        let stopped = false
        processes.push({
          emit: onOutput,
          finish: (exitCode) => {
            if (closeError) closed.reject(closeError)
            else closed.resolve({ exitCode })
          },
          isStopped: () => stopped,
        })
        return {
          pid: processes.length,
          closed: closed.promise,
          stop: async () => {
            if (stopError) throw stopError
            stopped = true
            if (closeError) closed.reject(closeError)
            else closed.resolve({ exitCode: 0 })
          },
        }
      },
    },
    catalog: async () => catalog,
    environment: async () => ({}),
    acquireLiveness: () => {
      owners += 1
      let released = false
      return () => {
        if (!released) {
          owners -= 1
          released = true
        }
      }
    },
    reportError: (error) => {
      errors.push(error)
    },
    probePreview: async () => true,
  })
  return {
    root,
    runs,
    records,
    persistence,
    history,
    processes,
    errors,
    definition,
    workspace: { workspaceId: 'workspace-one', projectPath: root, workspacePath: root },
    owners: () => owners,
    edit: (next: readonly ActionDefinition[]) => {
      catalog = { ...catalog, actions: next.map((definition) => ({ source: 'local', definition })) }
    },
    failValidation: (error: Error | null) => {
      validationError = error
    },
    failStop: (error: Error | null) => {
      stopError = error
    },
    failClose: (error: Error | null) => {
      closeError = error
    },
    pauseLaunch: (rejectOnAbort = false) => {
      launchGate = Promise.withResolvers<void>()
      launchEntered = Promise.withResolvers<void>()
      rejectLaunchOnAbort = rejectOnAbort
      return { entered: launchEntered.promise, resume: () => launchGate?.resolve() }
    },
    dispose: async () => {
      launchGate?.resolve()
      stopError = null
      await runs.shutdown()
      await rm(root, { recursive: true, force: true })
    },
  }
}
