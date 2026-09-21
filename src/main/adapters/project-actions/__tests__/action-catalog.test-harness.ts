import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type {
  ActionDefinition,
  ActionManifest,
  PreparationDefinition,
} from '@shared/types/action-definitions'
import { afterEach, beforeEach } from 'vitest'
import { createActionCatalog } from '../action-catalog'
import { serializeActionManifest } from '../action-manifest-file'
import {
  type ActionStatePersistence,
  decodeLocalActionState,
  type StoredActionState,
} from '../local-action-state'

export let root: string
export let projectPath: string
let workspacePath: string
export const rows = new Map<string, StoredActionState>()
let failNextCompletion = false
export const persistence: ActionStatePersistence = {
  read: async (path) => structuredClone(rows.get(path) ?? null),
  write: async (path, expectedRevision, state) => {
    const existing = rows.get(path)
    if ((existing?.revision ?? 0) !== expectedRevision) throw new Error('Local revision conflict')
    if (failNextCompletion && existing?.state.pending && !state.pending) {
      failNextCompletion = false
      throw new Error('Simulated crash after publishing the file')
    }
    const next = {
      revision: expectedRevision + 1,
      state: decodeLocalActionState(JSON.stringify(state)),
    }
    rows.set(path, next)
    return structuredClone(next)
  },
}
export let catalog = createActionCatalog(persistence)
export const action: ActionDefinition = {
  id: 'test',
  name: 'Test',
  icon: 'test',
  invocation: { type: 'command', command: 'pnpm test', directory: '.' },
  kind: 'task',
  allowConcurrent: false,
  autoOpenPreview: false,
}
export const setup: PreparationDefinition = {
  id: 'setup',
  profileId: 'default',
  phase: 'setup',
  invocation: { type: 'command', command: 'pnpm install', directory: '.' },
}

export function installActionCatalogFixture() {
  beforeEach(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), 'openwaggle-action-catalog-')))
    projectPath = join(root, 'project')
    workspacePath = projectPath
    await mkdir(projectPath)
    rows.clear()
    failNextCompletion = false
    catalog = createActionCatalog(persistence)
  })
  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })
}
export const scope = () => ({ projectPath, workspacePath })
export async function shared(manifest: ActionManifest, path = workspacePath) {
  await mkdir(join(path, '.openwaggle'), { recursive: true })
  await writeFile(join(path, '.openwaggle/actions.json'), serializeActionManifest(manifest))
}

export function failPublicationCompletion() {
  failNextCompletion = true
}
