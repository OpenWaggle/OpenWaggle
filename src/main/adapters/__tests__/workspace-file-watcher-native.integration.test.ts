import { execFileSync } from 'node:child_process'
import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
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
import { WorkspaceGitIgnoreFilter } from '../workspace-git-ignore-filter'

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

function recordingSubscriber(id: number) {
  const events: WorkspaceFilesChangedEvent[] = []
  const subscriber = fromPartial<WebContents>({
    id,
    isDestroyed: () => false,
    once: vi.fn(),
    send: (_channel: string, payload: WorkspaceFilesChangedEvent) => {
      events.push(payload)
    },
  })
  return { events, subscriber }
}

async function reported(events: WorkspaceFilesChangedEvent[], relative: string) {
  await vi.waitFor(
    () => {
      if (!events.some((event) => event.paths.includes(relative))) throw new Error('waiting')
    },
    { timeout: 5_000, interval: 50 },
  )
}

describe.skipIf(process.platform === 'linux')('git ignore sources (review R5 P3-3)', () => {
  /** `gen/` is ignored only by info/exclude, which the test then empties. */
  async function excludeFileReloads(root: string, excludeFile: string) {
    mkdirSync(path.join(root, 'gen'))
    writeFileSync(path.join(root, 'gen', 'old.ts'), '')
    writeFileSync(excludeFile, 'gen/\n')
    const { events, subscriber } = recordingSubscriber(7)
    await watchWorkspaceFiles(root, subscriber)
    await new Promise((resolve) => setTimeout(resolve, 300))

    writeFileSync(excludeFile, '')
    await new Promise((resolve) => setTimeout(resolve, 600))
    writeFileSync(path.join(root, 'gen', 'new.ts'), 'x')
    try {
      await reported(events, 'gen/new.ts')
    } finally {
      await unwatchWorkspaceFiles(root, 7)
    }
  }

  it('reads the ignore list again when the repository info/exclude changes', async () => {
    const root = repository()
    await excludeFileReloads(root, path.join(root, '.git', 'info', 'exclude'))
  })

  it('watches a linked worktree’s info/exclude in the common git directory', async () => {
    const main = repository()
    writeFileSync(path.join(main, 'README.md'), '')
    execFileSync('git', ['add', '.'], { cwd: main })
    execFileSync(
      'git',
      ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'init'],
      { cwd: main },
    )
    const worktree = realpathSync(mkdtempSync(path.join(tmpdir(), 'ow-watch-linked-')))
    roots.push(worktree)
    rmSync(worktree, { recursive: true, force: true })
    execFileSync('git', ['worktree', 'add', '-q', worktree], { cwd: main })
    await excludeFileReloads(worktree, path.join(main, '.git', 'info', 'exclude'))
  })
})

describe('git ignore filter (review R5 P3-3)', () => {
  it('learns an ignored folder created after start, so its later changes skip git', async () => {
    const root = repository()
    const filter = await WorkspaceGitIgnoreFilter.create(root)
    if (!filter) throw new Error('not a git working tree')
    mkdirSync(path.join(root, 'build', 'chunks'), { recursive: true })
    writeFileSync(path.join(root, 'build', 'chunks', 'a.js'), '')
    // `build/` existed at start; a new ignored folder is listed by none of git's start entries.
    mkdirSync(path.join(root, 'target'))
    appendFileSync(path.join(root, '.git', 'info', 'exclude'), 'target/\n')
    writeFileSync(path.join(root, 'target', 'out.o'), '')

    expect(filter.isKnownIgnored('target/out.o')).toBe(false)
    expect(await filter.keepNotIgnored(['target/out.o', 'src/index.ts'])).toEqual(['src/index.ts'])
    expect(filter.isKnownIgnored('target/next.o')).toBe(true)
  })
})
