import type { DesktopServiceCommand } from '@shared/types/desktop-service'
import { Effect } from 'effect'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { isReadOnlyDesktopCommand } from '../../application/desktop-service-read-only'
import {
  browserClickCommand,
  browserCommand,
  envelope,
  executorHarness,
} from './gui-desktop-service-executor.test-harness'

const warn = vi.hoisted(() => vi.fn())

vi.mock('../../logger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn, error: vi.fn() }),
}))

const snapshotCommand = { ...browserCommand, operation: 'snapshot' as const }
const evaluateCommand = {
  ...browserCommand,
  operation: 'evaluate' as const,
  input: { expression: 'document.title' },
}

describe('GUI desktop executor failures', () => {
  beforeEach(() => warn.mockReset())

  it('fails a read plainly with its reason and logs it', async () => {
    const instance = executorHarness({
      browser: { snapshot: () => Effect.fail(new Error('No preview tab is open.')) },
    })

    const completion = await instance.executor.execute(envelope(snapshotCommand), 'lease-one')

    expect(completion).toEqual({
      commandId: 'command-one',
      outcome: 'failure',
      message: 'No preview tab is open.',
    })
    expect(warn).toHaveBeenCalledWith('A desktop operation failed', {
      service: 'browser',
      operation: 'snapshot',
      interrupted: false,
      error: 'No preview tab is open.',
    })
  })

  it('fails an interrupted read plainly: nothing on the desktop changed', async () => {
    const started = Promise.withResolvers<void>()
    const instance = executorHarness({
      browser: {
        status: () => Effect.sync(() => started.resolve()).pipe(Effect.zipRight(Effect.never)),
      },
    })
    const running = instance.executor.execute(envelope(), 'lease-one')
    await started.promise
    instance.executor.cancel('command-one')

    const completion = await running
    expect(completion).toMatchObject({ outcome: 'failure' })
    expect(completion).not.toHaveProperty('uncertain')
    expect(warn).toHaveBeenCalledWith(
      'A desktop operation failed',
      expect.objectContaining({ operation: 'status', interrupted: true }),
    )
  })

  it('keeps a failed action uncertain, since it may have acted before it failed', async () => {
    const instance = executorHarness({
      browser: { click: () => Effect.fail(new Error('Element detached mid-click.')) },
    })

    const completion = await instance.executor.execute(envelope(browserClickCommand), 'lease-one')

    expect(completion).toMatchObject({ outcome: 'failure', uncertain: true })
    expect(warn).toHaveBeenCalledWith(
      'A desktop operation failed',
      expect.objectContaining({ operation: 'click', error: 'Element detached mid-click.' }),
    )
  })

  it('keeps a failed page evaluation uncertain: page code can change the page', async () => {
    const instance = executorHarness({
      browser: { evaluate: () => Effect.fail(new Error('Evaluation threw.')) },
    })

    const completion = await instance.executor.execute(envelope(evaluateCommand), 'lease-one')

    expect(completion).toMatchObject({ outcome: 'failure', uncertain: true })
  })
})

describe('read-only desktop commands', () => {
  it.each<[DesktopServiceCommand, boolean]>([
    [browserCommand, true],
    [snapshotCommand, true],
    [{ ...browserCommand, operation: 'waitFor', input: { text: 'Ready' } }, true],
    [{ service: 'browser', operation: 'inspectOwner', ownerKey: 'session-one' }, true],
    [{ service: 'terminal', operation: 'getActivitySnapshot', input: {} }, true],
    [browserClickCommand, false],
    [evaluateCommand, false],
    [{ service: 'browser', operation: 'deleteOwner', ownerKey: 'session-one' }, false],
    [{ service: 'terminal', operation: 'closeAll', input: {} }, false],
  ])('classifies %o as read-only: %s', (command, readOnly) => {
    expect(isReadOnlyDesktopCommand(command)).toBe(readOnly)
  })
})
