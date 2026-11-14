/** The workspace file IPC handlers over a recording service and the real authorization. */
import { realpathSync } from 'node:fs'
import { fromAny, fromPartial } from '@total-typescript/shoehorn'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { beforeAll, beforeEach, vi } from 'vitest'
import {
  WorkspaceFileService,
  type WorkspaceFileServiceShape,
} from '../../ports/workspace-file-service'
import { WorkspaceProjectAuthorization } from '../../ports/workspace-project-authorization'
import { validateAuthorizedProjectPath } from '../../utils/project-path-validation'

interface WorkspaceFilesHarness {
  /** Every workspace service call, in order: the method and the input it received. */
  calls: [string, unknown][]
  /** What the next write or document edit reports. */
  saveStatus: string
  invalidated: string[]
  watched: [string, unknown][]
  unwatched: [string, number][]
  hostAuthorization: { handled: boolean; result?: string }
  hostDenies: boolean
  handlers: Map<string, (...args: unknown[]) => unknown>
}

const hoistedHarness = vi.hoisted<WorkspaceFilesHarness>(() => ({
  calls: [],
  saveStatus: 'saved',
  invalidated: [],
  watched: [],
  unwatched: [],
  hostAuthorization: { handled: false },
  hostDenies: false,
  handlers: new Map(),
}))
export const harness: WorkspaceFilesHarness = hoistedHarness

vi.mock('../typed-ipc', () => ({
  typedHandle: (channel: string, handler: (...args: unknown[]) => unknown) => {
    hoistedHarness.handlers.set(channel, handler)
  },
}))
vi.mock('../../application/gui-session-command-router', () => ({
  invokeConfiguredHostUi: async () => {
    if (hoistedHarness.hostDenies) throw new Error('Host denied access')
    return hoistedHarness.hostAuthorization
  },
}))
vi.mock('../git/status-cache', () => ({
  invalidateGitStatusCache: (projectPath: string) => hoistedHarness.invalidated.push(projectPath),
}))
vi.mock('../../adapters/workspace-file-watcher', () => ({
  watchWorkspaceFiles: async (projectPath: string, sender: unknown) => {
    hoistedHarness.watched.push([projectPath, sender])
  },
  unwatchWorkspaceFiles: async (projectPath: string, senderId: number) => {
    hoistedHarness.unwatched.push([projectPath, senderId])
  },
}))

const { registerWorkspaceFileHandlers } = await import('../workspace-files-handler')

export const PROJECT_PATH = process.cwd()
export const canonicalProject = realpathSync(PROJECT_PATH)

/** A workspace service that records each call and answers with the method's name. */
function recordingService() {
  const record =
    (method: string, result: (input: unknown) => unknown = () => ({ method })) =>
    (input?: unknown) =>
      Effect.sync(() => {
        hoistedHarness.calls.push([method, input])
        return result(input)
      })
  return fromPartial<WorkspaceFileServiceShape>({
    searchFiles: record('searchFiles', () => [{ path: 'src/main.ts' }]),
    searchContent: record('searchContent', () => [{ path: 'src/main.ts', line: 1 }]),
    cancelContentSearch: record('cancelContentSearch', () => undefined),
    readFile: record('readFile'),
    readFileWithEncoding: record('readFileWithEncoding'),
    readPage: record('readPage'),
    writeFile: record('writeFile', () => ({ status: hoistedHarness.saveStatus })),
    applyDocumentEdits: record('applyDocumentEdits', () => ({ status: hoistedHarness.saveStatus })),
    listExternalEditors: record('listExternalEditors', () => [
      { id: 'vscode', label: 'Visual Studio Code' },
      { id: 'zed', label: 'Zed' },
    ]),
    openFile: record('openFile', () => undefined),
    openAbsoluteFile: record('openAbsoluteFile', () => undefined),
    createEntry: record('createEntry', () => ({ path: 'src/new.ts' })),
    moveEntry: record('moveEntry', () => ({ path: 'src/moved.ts' })),
    duplicateEntry: record('duplicateEntry', () => ({ path: 'src/copy.ts' })),
    trashEntry: record('trashEntry', () => ({ path: 'src/copy.ts' })),
    revealEntry: record('revealEntry', () => undefined),
  })
}

const layer = Layer.mergeAll(
  Layer.succeed(WorkspaceFileService, recordingService()),
  Layer.succeed(
    WorkspaceProjectAuthorization,
    WorkspaceProjectAuthorization.of({
      authorize: (projectPath) => validateAuthorizedProjectPath(projectPath, [PROJECT_PATH]),
    }),
  ),
)

export const SENDER = { id: 7 }

/** Runs a registered handler as the window `SENDER` would, with the recording service. */
export function invoke(channel: string, ...args: unknown[]) {
  const handler = hoistedHarness.handlers.get(channel)
  if (!handler) throw new Error(`${channel} is not registered`)
  const effect = fromAny<
    Effect.Effect<unknown, unknown, WorkspaceFileService | WorkspaceProjectAuthorization>,
    unknown
  >(handler({ sender: SENDER }, ...args))
  return Effect.runPromise(Effect.provide(effect, layer))
}

export function edits(batches: number, changesPerBatch: number, text = '') {
  return {
    projectPath: PROJECT_PATH,
    path: 'src/example.ts',
    expectedRevision: 'revision-1',
    baseVersion: 0,
    batches: Array.from({ length: batches }, (_, version) => ({
      version,
      changes: Array.from({ length: changesPerBatch }, () => ({
        rangeOffset: 0,
        rangeLength: 0,
        text,
      })),
    })),
  }
}

beforeAll(() => {
  registerWorkspaceFileHandlers()
})

beforeEach(() => {
  hoistedHarness.calls.length = 0
  hoistedHarness.invalidated.length = 0
  hoistedHarness.watched.length = 0
  hoistedHarness.unwatched.length = 0
  hoistedHarness.saveStatus = 'saved'
  hoistedHarness.hostAuthorization = { handled: false }
  hoistedHarness.hostDenies = false
})
