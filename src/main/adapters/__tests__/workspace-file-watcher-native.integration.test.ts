import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { WorkspaceFilesChangedEvent } from '@shared/types/workspace-files'
import { fromPartial } from '@total-typescript/shoehorn'
import type { WebContents } from 'electron'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../filesystem-workspace-file-service', () => ({
  invalidateWorkspaceFileIndex: vi.fn(),
}))

import { unwatchWorkspaceFiles, watchWorkspaceFiles } from '../workspace-file-watcher'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function repository() {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'ow-watch-')))
  roots.push(root)
  execFileSync('git', ['init', '-q'], { cwd: root })
  writeFileSync(path.join(root, '.gitignore'), 'build/\n*.log\n')
  mkdirSync(path.join(root, 'src'))
  mkdirSync(path.join(root, 'build'))
  writeFileSync(path.join(root, 'build', 'old.js'), '')
  return root
}

describe.skipIf(process.platform === 'linux')('native recursive workspace watcher (D10)', () => {
  it('reports changes in one recursive watcher, without paths git ignores', async () => {
    const root = repository()
    const events: WorkspaceFilesChangedEvent[] = []
    const subscriber = fromPartial<WebContents>({
      id: 1,
      isDestroyed: () => false,
      once: vi.fn(),
      send: (_channel: string, payload: WorkspaceFilesChangedEvent) => {
        events.push(payload)
      },
    })
    await watchWorkspaceFiles(root, subscriber)
    // FSEvents starts delivering shortly after the stream is created.
    await new Promise((resolve) => setTimeout(resolve, 300))

    writeFileSync(path.join(root, 'build', 'bundle.js'), 'x')
    writeFileSync(path.join(root, 'debug.log'), 'x')
    writeFileSync(path.join(root, 'src', 'index.ts'), 'x')
    await vi.waitFor(
      () => {
        if (!events.some((event) => event.paths.includes('src/index.ts')))
          throw new Error('waiting')
      },
      { timeout: 5_000, interval: 50 },
    )
    await new Promise((resolve) => setTimeout(resolve, 400))
    await unwatchWorkspaceFiles(root, 1)

    const reported = new Set(events.flatMap((event) => event.paths))
    expect(reported.has('src/index.ts')).toBe(true)
    expect(
      [...reported].filter((entry) => entry.startsWith('build') || entry.endsWith('.log')),
    ).toEqual([])
    expect(events.every((event) => event.workingPath === root && !event.overflow)).toBe(true)
  })
})
