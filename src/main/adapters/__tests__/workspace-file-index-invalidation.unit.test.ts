import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  WorkspaceFileService,
  type WorkspaceFileServiceShape,
} from '../../ports/workspace-file-service'

const globState = vi.hoisted(() => {
  const state: {
    fileScanCount: number
    resolveFirstScan: ((paths: string[]) => void) | undefined
  } = { fileScanCount: 0, resolveFirstScan: undefined }
  return state
})

const globMock = vi.hoisted(() =>
  vi.fn((pattern: string) => {
    if (pattern === '**/.gitignore') return Promise.resolve([])
    globState.fileScanCount += 1
    if (globState.fileScanCount === 1) {
      return new Promise<string[]>((resolve) => {
        globState.resolveFirstScan = resolve
      })
    }
    return Promise.resolve(['src/new.ts'])
  }),
)

vi.mock('fast-glob', () => ({ default: globMock }))

import {
  FilesystemWorkspaceFileLive,
  invalidateWorkspaceFileIndex,
} from '../filesystem-workspace-file-service'

function search(projectPath: string) {
  return Effect.runPromise(
    Effect.gen(function* () {
      const service: WorkspaceFileServiceShape = yield* WorkspaceFileService
      return yield* service.searchFiles({ projectPath, query: '', limit: 20 })
    }).pipe(Effect.provide(FilesystemWorkspaceFileLive)),
  )
}

describe('workspace file index invalidation', () => {
  let temporaryRoot = ''

  beforeEach(async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-index-generation-'))
    globState.fileScanCount = 0
    globState.resolveFirstScan = undefined
    globMock.mockClear()
  })

  afterEach(async () => {
    await fs.rm(temporaryRoot, { recursive: true, force: true })
  })

  it('does not let an invalidated in-flight build replace the newer index', async () => {
    const firstSearch = search(temporaryRoot)
    await vi.waitFor(() => expect(globState.resolveFirstScan).toBeTypeOf('function'))

    invalidateWorkspaceFileIndex(await fs.realpath(temporaryRoot))
    await expect(search(temporaryRoot)).resolves.toEqual([
      { path: 'src/new.ts', basename: 'new.ts' },
    ])

    globState.resolveFirstScan?.(['src/old.ts'])
    await expect(firstSearch).resolves.toEqual([{ path: 'src/new.ts', basename: 'new.ts' }])
    await expect(search(temporaryRoot)).resolves.toEqual([
      { path: 'src/new.ts', basename: 'new.ts' },
    ])
    expect(globState.fileScanCount).toBe(2)
  })
})
