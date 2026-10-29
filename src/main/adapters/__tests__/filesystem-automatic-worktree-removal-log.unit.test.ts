import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { AutomaticWorktreeRemovalRun } from '@shared/types/worktree-inventory'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => os.tmpdir() } }))

const { AUTOMATIC_WORKTREE_REMOVAL_LOG_LIMIT, createAutomaticWorktreeRemovalLogStore } =
  await import('../filesystem-automatic-worktree-removal-log')

function run(id: string, removed: number): AutomaticWorktreeRemovalRun {
  return {
    id,
    startedAt: 1,
    finishedAt: 2,
    archivedDays: 30,
    removed: Array.from({ length: removed }, (_, index) => ({
      path: `/wt/${id}-${String(index)}`,
      projectPath: '/repo',
      branch: `branch-${String(index)}`,
      sessionTitles: ['A Session'],
      reclaimableBytes: 100,
    })),
    failed: [],
  }
}

describe('Automatic worktree removal record', () => {
  let root = ''
  let file = ''

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-removal-log-'))
    file = path.join(root, 'worktree-removal', 'automatic-runs.json')
  })

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true })
  })

  it('starts empty, keeps the newest run first, and announces a run that removed something', async () => {
    const store = createAutomaticWorktreeRemovalLogStore(() => file)
    await expect(Effect.runPromise(store.read())).resolves.toEqual({
      lastCheckedAt: null,
      runs: [],
      unannouncedRunId: null,
    })

    await Effect.runPromise(store.record(run('first', 2)))
    await Effect.runPromise(store.record(run('second', 1)))
    const log = await Effect.runPromise(store.read())

    expect(log.runs.map((entry) => entry.id)).toEqual(['second', 'first'])
    expect(log.unannouncedRunId).toBe('second')
  })

  it('records a quiet check as its time only, so it never pushes out a removal', async () => {
    const store = createAutomaticWorktreeRemovalLogStore(() => file)
    await Effect.runPromise(store.record(run('removed', 1)))
    for (let index = 0; index <= AUTOMATIC_WORKTREE_REMOVAL_LOG_LIMIT; index += 1) {
      await Effect.runPromise(
        store.record({ ...run(`quiet-${String(index)}`, 0), startedAt: 50 + index }),
      )
    }
    const log = await Effect.runPromise(store.read())
    expect(log.runs.map((entry) => entry.id)).toEqual(['removed'])
    expect(log.lastCheckedAt).toBe(50 + AUTOMATIC_WORKTREE_REMOVAL_LOG_LIMIT)
  })

  it('announces a run once, together with every older run', async () => {
    const store = createAutomaticWorktreeRemovalLogStore(() => file)
    await Effect.runPromise(store.record(run('old', 1)))
    await Effect.runPromise(store.record(run('new', 1)))

    // Two windows opening together: only the first claims it.
    const claims = await Promise.all([
      Effect.runPromise(store.acknowledge('new')),
      Effect.runPromise(store.acknowledge('new')),
    ])

    expect(claims.sort()).toEqual([false, true])
    await expect(Effect.runPromise(store.read())).resolves.toMatchObject({
      unannouncedRunId: null,
    })
    await expect(Effect.runPromise(store.acknowledge('old'))).resolves.toBe(false)
  })

  it('keeps only the newest runs', async () => {
    const store = createAutomaticWorktreeRemovalLogStore(() => file)
    for (let index = 0; index <= AUTOMATIC_WORKTREE_REMOVAL_LOG_LIMIT; index += 1) {
      await Effect.runPromise(store.record(run(`run-${String(index)}`, 1)))
    }
    const log = await Effect.runPromise(store.read())
    expect(log.runs).toHaveLength(AUTOMATIC_WORKTREE_REMOVAL_LOG_LIMIT)
    expect(log.runs[0]?.id).toBe(`run-${String(AUTOMATIC_WORKTREE_REMOVAL_LOG_LIMIT)}`)
  })

  it('treats an unreadable or invalid record as empty', async () => {
    const store = createAutomaticWorktreeRemovalLogStore(() => file)
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(file, '{not json')
    await expect(Effect.runPromise(store.read())).resolves.toEqual({
      lastCheckedAt: null,
      runs: [],
      unannouncedRunId: null,
    })
    await fs.writeFile(file, JSON.stringify({ version: 2, runs: [] }))
    await expect(Effect.runPromise(store.read())).resolves.toMatchObject({ runs: [] })
  })

  it('serializes writes so concurrent records are all kept', async () => {
    const store = createAutomaticWorktreeRemovalLogStore(() => file)
    await Promise.all(['a', 'b', 'c'].map((id) => Effect.runPromise(store.record(run(id, 1)))))
    const log = await Effect.runPromise(store.read())
    expect(log.runs.map((entry) => entry.id).sort()).toEqual(['a', 'b', 'c'])
  })
})
