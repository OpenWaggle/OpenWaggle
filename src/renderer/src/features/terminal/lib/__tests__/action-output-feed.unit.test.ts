import type { ActionOutputSnapshot, ActionRun } from '@shared/types/action-runs'
import { describe, expect, it, vi } from 'vitest'
import { createActionOutputFeed } from '../action-output-feed'
import { ACTION_OUTPUT_RESTART_DIVIDER } from '../action-output-view-model'

function actionRun(id: string, status: ActionRun['status'], exitCode: number | null = null) {
  return {
    id,
    requestId: id,
    workspaceId: 'workspace',
    projectPath: '/repo',
    workspacePath: '/repo',
    action: {
      id: 'dev',
      name: 'dev',
      icon: 'play',
      invocation: { type: 'command', command: 'pnpm dev', directory: '.' },
      kind: 'service',
      allowConcurrent: false,
      autoOpenPreview: false,
    },
    invocation: { type: 'command', command: 'pnpm dev', cwd: '/repo' },
    status,
    startedAt: 1,
    finishedAt: null,
    exitCode,
    error: null,
    previewUrl: null,
    ready: false,
    outputBytes: 0,
  } satisfies ActionRun
}

/** A run whose output grows between polls, with an explicit status per poll. */
function fakeRuns() {
  const runs = new Map<string, { text: string; run: ActionRun }>()
  const fetchPage = vi.fn(async (runId: string, afterOffset: number) => {
    const entry = runs.get(runId)
    if (!entry) throw new Error('Action run not found in this workspace.')
    const output = entry.text.slice(afterOffset)
    return {
      run: entry.run,
      output,
      startOffset: afterOffset,
      endOffset: entry.text.length,
      truncated: false,
      hasMore: false,
    } satisfies ActionOutputSnapshot
  })
  return {
    fetchPage,
    set(runId: string, text: string, run: ActionRun) {
      runs.set(runId, { text, run })
    },
  }
}

function manualScheduler() {
  const pending: (() => void)[] = []
  return {
    schedule: (callback: () => void) => {
      pending.push(callback)
      return () => {
        const index = pending.indexOf(callback)
        if (index !== -1) pending.splice(index, 1)
      }
    },
    async tick() {
      const next = pending.splice(0)
      for (const callback of next) callback()
      await settle()
    },
  }
}

async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

function harness() {
  const runs = fakeRuns()
  const scheduler = manualScheduler()
  const written: string[] = []
  const onRun = vi.fn()
  const feed = createActionOutputFeed({
    fetchPage: runs.fetchPage,
    write: (text) => written.push(text),
    onRun,
    onError: vi.fn(),
    schedule: scheduler.schedule,
  })
  return { runs, scheduler, written, onRun, feed, text: () => written.join('') }
}

describe('Action output feed', () => {
  it('streams live output and keeps the final output with the outcome once the run ends', async () => {
    const { runs, scheduler, feed, text, onRun } = harness()
    runs.set('run-1', 'ready on :3000\r\n', actionRun('run-1', 'running'))
    feed.setRuns(['run-1'])
    await settle()
    expect(text()).toBe('ready on :3000\r\n')

    runs.set('run-1', 'ready on :3000\r\nbye\r\n', actionRun('run-1', 'failed', 1))
    await scheduler.tick()
    expect(text()).toContain('ready on :3000\r\nbye\r\n')
    expect(text()).toContain('dev failed · exit 1')
    expect(onRun).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'failed' }))

    // A finished run is not polled again.
    const calls = runs.fetchPage.mock.calls.length
    await scheduler.tick()
    expect(runs.fetchPage).toHaveBeenCalledTimes(calls)
    feed.dispose()
  })

  it('follows a restart below a divider without clearing the earlier run', async () => {
    const { runs, scheduler, feed, text } = harness()
    runs.set('run-1', 'first\r\n', actionRun('run-1', 'running'))
    feed.setRuns(['run-1'])
    await settle()

    runs.set('run-1', 'first\r\n', actionRun('run-1', 'stopped'))
    runs.set('run-2', 'second\r\n', actionRun('run-2', 'running'))
    feed.setRuns(['run-1', 'run-2'])
    await settle()
    await scheduler.tick()

    const output = text()
    expect(output.indexOf('first')).toBeLessThan(output.indexOf(ACTION_OUTPUT_RESTART_DIVIDER))
    expect(output.indexOf(ACTION_OUTPUT_RESTART_DIVIDER)).toBeLessThan(output.indexOf('second'))
    expect(output).toContain('dev stopped')
    feed.dispose()
  })

  it('replays earlier runs in order on mount and keeps scrollback erasure out of the view', async () => {
    const { runs, feed, text } = harness()
    runs.set('run-1', 'old\x1b[3J\r\n', actionRun('run-1', 'stopped'))
    runs.set('run-2', 'new\r\n', actionRun('run-2', 'completed', 0))
    feed.setRuns(['run-1', 'run-2'])
    await settle()
    await settle()
    const output = text()
    expect(output).not.toContain('\x1b[3J')
    expect(output.indexOf('old')).toBeLessThan(output.indexOf('new'))
    expect(output).toContain('dev completed · exit 0')
    feed.dispose()
  })

  it('stops reading after dispose', async () => {
    const { runs, scheduler, feed } = harness()
    runs.set('run-1', 'x', actionRun('run-1', 'running'))
    feed.setRuns(['run-1'])
    await settle()
    feed.dispose()
    const calls = runs.fetchPage.mock.calls.length
    await scheduler.tick()
    expect(runs.fetchPage).toHaveBeenCalledTimes(calls)
  })
})
