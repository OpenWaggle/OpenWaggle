import { join } from 'node:path'
import { TERMINAL } from '@shared/constants/resource-limits'
import { actionExecutionKey } from '@shared/utils/action-execution-key'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { makeTerminalHistoryStore } from '../../terminal/terminal-history-store'
import { createManagedActionRuns } from '../managed-action-runs'
import { createManagedActionFixture } from './managed-action-runs.test-harness'

let fixture: Awaited<ReturnType<typeof createManagedActionFixture>>
beforeEach(async () => {
  fixture = await createManagedActionFixture()
})
afterEach(async () => {
  vi.restoreAllMocks()
  await fixture.dispose()
})
const input = (requestId: string) => ({ workspace: fixture.workspace, actionId: 'test', requestId })

it('refuses a launch when its displayed execution changed before the Host resolves it', async () => {
  const displayedKey = actionExecutionKey(fixture.definition)
  fixture.edit([
    { ...fixture.definition, invocation: { type: 'command', command: 'danger', directory: '.' } },
  ])
  await expect(
    fixture.runs.start({ ...input('stale-ui'), expectedExecutionKey: displayedKey }),
  ).rejects.toThrow('The action changed during authorization.')
  expect(fixture.processes).toHaveLength(0)
})

it('normalizes an address-bar preview override before readiness and retains it over detected output', async () => {
  fixture.edit([{ ...fixture.definition, previewUrl: 'localhost:3000' }])
  const run = await fixture.runs.start(input('manual-preview'))
  expect(run.previewUrl).toBe('http://localhost:3000/')
  fixture.processes[0]?.emit('ready at http://localhost:4321/\n')
  await expect
    .poll(async () => (await fixture.runs.list(fixture.workspace.workspaceId))[0]?.ready)
    .toBe(true)
  expect((await fixture.runs.list(fixture.workspace.workspaceId))[0]?.previewUrl).toBe(
    'http://localhost:3000/',
  )
})

it('does not publish an output-derived preview for a DNS name beginning with 127', async () => {
  const run = await fixture.runs.start(input('dns-preview'))
  fixture.processes[0]?.emit('ready at http://127.attacker.example/\n')
  expect(
    (await fixture.runs.output(fixture.workspace.workspaceId, run.id)).run.previewUrl,
  ).toBeNull()
  fixture.processes[0]?.emit('ready at http://127.0.0.2:3000/\n')
  expect((await fixture.runs.output(fixture.workspace.workspaceId, run.id)).run.previewUrl).toBe(
    'http://127.0.0.2:3000/',
  )
})

it('serializes GUI and agent starts into one execution and deduplicates retried requests after completion', async () => {
  const [gui, agent] = await Promise.all([
    fixture.runs.start(input('gui')),
    fixture.runs.start(input('agent')),
  ])
  expect(agent.id).toBe(gui.id)
  expect(fixture.processes).toHaveLength(1)
  expect(fixture.owners()).toBe(1)
  await fixture.runs.stop(fixture.workspace.workspaceId, gui.id)
  const retry = await fixture.runs.start(input('agent'))
  expect(retry.id).toBe(gui.id)
  expect(retry.status).toBe('stopped')
  expect(fixture.processes).toHaveLength(1)
  expect(fixture.owners()).toBe(0)
  expect((await fixture.runs.start(input('new-request'))).id).not.toBe(gui.id)
})

it('stops a persisted starting run before its process launch settles', async () => {
  const launch = fixture.pauseLaunch()
  const starting = fixture.runs.start(input('slow-start'))
  await launch.entered
  const listed = (await fixture.runs.list(fixture.workspace.workspaceId))[0]
  expect(listed?.status).toBe('starting')
  const stopping = fixture.runs.stop(fixture.workspace.workspaceId, listed?.id ?? '')
  expect((await stopping).status).toBe('stopped')
  expect((await starting).status).toBe('stopped')
  expect(fixture.processes).toHaveLength(0)
  launch.resume()
  await expect.poll(() => fixture.processes[0]?.isStopped()).toBe(true)
  await expect.poll(() => fixture.owners()).toBe(0)
})

it('stops a starting service during workspace release', async () => {
  fixture.edit([{ ...fixture.definition, kind: 'service' }])
  const launch = fixture.pauseLaunch()
  const starting = fixture.runs.start(input('slow-service'))
  await launch.entered
  const stopping = fixture.runs.stopWorkspaceServices(fixture.workspace.workspaceId)
  await stopping
  expect((await starting).status).toBe('stopped')
  expect(fixture.processes).toHaveLength(0)
  launch.resume()
  await expect.poll(() => fixture.processes[0]?.isStopped()).toBe(true)
  await expect.poll(() => fixture.owners()).toBe(0)
})

it('keeps a late process owned and Stop retryable if its first cleanup fails', async () => {
  const launch = fixture.pauseLaunch()
  const starting = fixture.runs.start(input('late-cleanup'))
  await launch.entered
  const runId = (await fixture.runs.list(fixture.workspace.workspaceId))[0]?.id ?? ''
  await fixture.runs.stop(fixture.workspace.workspaceId, runId)
  await starting
  fixture.failStop(new Error('Process exit could not be confirmed'))
  launch.resume()
  await expect.poll(() => fixture.errors.length).toBeGreaterThan(0)
  expect((await fixture.runs.list(fixture.workspace.workspaceId))[0]?.status).toBe('stopping')
  expect(fixture.owners()).toBe(1)
  fixture.failStop(null)
  expect((await fixture.runs.stop(fixture.workspace.workspaceId, runId)).status).toBe('stopped')
  expect(fixture.owners()).toBe(0)
})

it('holds Host liveness until a canceled launch has a durable stopped status', async () => {
  const launch = fixture.pauseLaunch(true)
  const starting = fixture.runs.start(input('aborted-launch'))
  await launch.entered
  const runId = (await fixture.runs.list(fixture.workspace.workspaceId))[0]?.id ?? ''
  const enteredSave = Promise.withResolvers<void>()
  const finishSave = Promise.withResolvers<void>()
  const save = fixture.persistence.save.bind(fixture.persistence)
  vi.spyOn(fixture.persistence, 'save').mockImplementation(async (run) => {
    if (run.status === 'stopped') {
      enteredSave.resolve()
      await finishSave.promise
    }
    await save(run)
  })
  const stopping = fixture.runs.stop(fixture.workspace.workspaceId, runId)
  await enteredSave.promise
  expect(fixture.owners()).toBe(1)
  finishSave.resolve()
  expect((await stopping).status).toBe('stopped')
  expect((await starting).status).toBe('stopped')
  await expect.poll(() => fixture.owners()).toBe(0)
  expect(fixture.processes).toHaveLength(0)
})

it('opens an existing execution after definition removal and validates Restart before stopping it', async () => {
  const first = await fixture.runs.start(input('first'))
  fixture.edit([])
  expect((await fixture.runs.start(input('open-existing'))).id).toBe(first.id)
  await expect(fixture.runs.start({ ...input('restart'), restartRunId: first.id })).rejects.toThrow(
    'no longer available',
  )
  expect(fixture.processes[0]?.isStopped()).toBe(false)
  fixture.edit([{ ...fixture.definition, name: 'New name' }])
  fixture.failValidation(new Error('Runner unavailable'))
  await expect(fixture.runs.start({ ...input('restart'), restartRunId: first.id })).rejects.toThrow(
    'Runner unavailable',
  )
  expect(fixture.processes[0]?.isStopped()).toBe(false)
  fixture.failValidation(null)
  const next = await fixture.runs.start({ ...input('restart'), restartRunId: first.id })
  expect(next.id).not.toBe(first.id)
  expect(next.action.name).toBe('New name')
  expect(fixture.processes[0]?.isStopped()).toBe(true)
  expect(fixture.records.get(first.id)?.action.name).toBe('Test')
})

it('isolates workspaces and allows overlap only for explicitly concurrent finite actions', async () => {
  const first = await fixture.runs.start(input('first'))
  const separate = await fixture.runs.start({
    ...input('second'),
    workspace: { ...fixture.workspace, workspaceId: 'workspace-two' },
  })
  expect(first.id).not.toBe(separate.id)
  await fixture.runs.stop(fixture.workspace.workspaceId, first.id)
  fixture.edit([{ ...fixture.definition, allowConcurrent: true }])
  const concurrent = await Promise.all([
    fixture.runs.start(input('third')),
    fixture.runs.start(input('fourth')),
  ])
  expect(concurrent[0]?.id).not.toBe(concurrent[1]?.id)
  await expect(fixture.runs.stop('workspace-two', concurrent[0]?.id ?? '')).rejects.toThrow(
    'not found in this workspace',
  )
})

it('reconnects by cursor without another launch and detects preview URLs across output chunks', async () => {
  const run = await fixture.runs.start(input('first'))
  fixture.processes[0]?.emit('ready: http://local')
  fixture.processes[0]?.emit('host:4321/\r\nhello 🌊\n')
  const initial = await fixture.runs.output(fixture.workspace.workspaceId, run.id)
  expect(initial.output).toContain('hello 🌊')
  expect(initial.run.previewUrl).toBe('http://localhost:4321/')
  expect(initial.run.ready).toBe(false)
  await expect
    .poll(async () => (await fixture.runs.list(fixture.workspace.workspaceId))[0]?.ready)
    .toBe(true)
  fixture.processes[0]?.emit('next line\n')
  const reconnected = await fixture.runs.output(
    fixture.workspace.workspaceId,
    run.id,
    initial.endOffset,
  )
  expect(reconnected.output).toBe('next line\n')
  expect(fixture.processes).toHaveLength(1)
  expect(fixture.owners()).toBe(1)
})

it('keeps a later output cursor after Host loss when flushed history exceeds stale metadata', async () => {
  const run = await fixture.runs.start(input('cursor-recovery'))
  vi.spyOn(fixture.persistence, 'save').mockResolvedValue(undefined)
  const beforeCursor = 'x'.repeat(TERMINAL.MAX_SCROLLBACK_BYTES + 32)
  fixture.processes[0]?.emit(beforeCursor)
  fixture.processes[0]?.emit('retained-tail')
  await fixture.history.flush()
  expect(fixture.records.get(run.id)?.outputBytes).toBe(0)
  await fixture.persistence.interruptAfterHostLoss()

  const recovered = createManagedActionRuns({
    persistence: fixture.persistence,
    history: makeTerminalHistoryStore(join(fixture.root, 'logs')),
    runner: {
      validate: async () => undefined,
      start: async () => {
        throw new Error('A recovered action must not launch again.')
      },
    },
    catalog: async () => {
      throw new Error('A recovered action must not resolve a catalog.')
    },
    environment: async () => ({}),
    acquireLiveness: () => () => undefined,
    reportError: vi.fn(),
  })
  try {
    const page = await recovered.output(fixture.workspace.workspaceId, run.id, beforeCursor.length)
    expect(page.output).toBe('retained-tail')
    expect(page.startOffset).toBe(beforeCursor.length)
    expect(page.endOffset).toBe(beforeCursor.length + Buffer.byteLength('retained-tail'))
  } finally {
    await recovered.shutdown()
  }
})

it('retains ownership after a failed Stop and permits retry before a replacement launch', async () => {
  const first = await fixture.runs.start(input('first'))
  fixture.failStop(new Error('Process exit could not be confirmed'))
  await expect(fixture.runs.start({ ...input('restart'), restartRunId: first.id })).rejects.toThrow(
    'could not be confirmed',
  )
  expect(fixture.owners()).toBe(1)
  expect(fixture.processes).toHaveLength(1)
  fixture.failStop(null)
  const next = await fixture.runs.start({ ...input('restart'), restartRunId: first.id })
  expect(next.id).not.toBe(first.id)
  expect(fixture.owners()).toBe(1)
})

it('settles a naturally exited run after native drain failure once its process tree stops', async () => {
  const run = await fixture.runs.start(input('failed-drain-exit'))
  fixture.failClose(new Error('The action PTY did not release its native resources.'))
  fixture.processes[0]?.finish(0)
  await expect.poll(() => fixture.records.get(run.id)?.status).toBe('failed')
  expect(fixture.records.get(run.id)?.error).toContain('native resources')
  expect(fixture.processes[0]?.isStopped()).toBe(true)
  expect(fixture.owners()).toBe(0)
  await expect(
    fixture.runs.stopWorkspaceRuns(fixture.workspace.workspaceId),
  ).resolves.toBeUndefined()
})

it('completes Stop when native drain fails after the process tree is confirmed stopped', async () => {
  fixture.failClose(new Error('The action PTY did not release its native resources.'))
  const run = await fixture.runs.start(input('failed-drain-stop'))
  const stopped = await fixture.runs.stop(fixture.workspace.workspaceId, run.id)
  expect(stopped.status).toBe('stopped')
  expect(stopped.error).toContain('native resources')
  expect(fixture.owners()).toBe(0)
  await expect(
    fixture.runs.stopWorkspaceRuns(fixture.workspace.workspaceId),
  ).resolves.toBeUndefined()
})

it('retains and retries ownership when native drain and process-tree shutdown both fail', async () => {
  const run = await fixture.runs.start(input('failed-drain-retry'))
  fixture.failClose(new Error('The action PTY did not release its native resources.'))
  fixture.failStop(new Error('Process exit could not be confirmed'))
  fixture.processes[0]?.finish(0)
  await expect.poll(() => fixture.records.get(run.id)?.status).toBe('stopping')
  expect(fixture.owners()).toBe(1)
  fixture.failStop(null)
  const stopped = await fixture.runs.stop(fixture.workspace.workspaceId, run.id)
  expect(stopped.status).toBe('stopped')
  expect(stopped.error).toContain('native resources')
  expect(fixture.owners()).toBe(0)
})

it('stops services when their workspace is released while leaving other workspaces alone', async () => {
  fixture.edit([{ ...fixture.definition, kind: 'service' }])
  const first = await fixture.runs.start(input('first'))
  const separate = await fixture.runs.start({
    ...input('second'),
    workspace: { ...fixture.workspace, workspaceId: 'workspace-two' },
  })
  await fixture.runs.stopWorkspaceServices(fixture.workspace.workspaceId)
  expect(fixture.records.get(first.id)?.status).toBe('stopped')
  expect(fixture.records.get(separate.id)?.status).toBe('running')
})

it('keeps read-only reuse safe if a run finishes before the request reaches the Host', async () => {
  const first = await fixture.runs.start(input('first'))
  await fixture.runs.stop(fixture.workspace.workspaceId, first.id)
  fixture.edit([])
  const receipt = await fixture.runs.start({ ...input('reuse'), reuseRunId: first.id })
  expect(receipt.id).toBe(first.id)
  expect(receipt.status).toBe('stopped')
  expect(fixture.processes).toHaveLength(1)
  expect((await fixture.runs.start(input('reuse'))).id).toBe(first.id)
  await expect(fixture.runs.start({ ...input('missing'), reuseRunId: 'missing' })).rejects.toThrow(
    'does not belong to this workspace action',
  )
  expect(fixture.processes).toHaveLength(1)
})
