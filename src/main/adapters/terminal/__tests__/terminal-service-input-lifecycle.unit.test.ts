import { TERMINAL } from '@shared/constants/resource-limits'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { observeTerminalProjectActionActivity } from '../terminal-project-action'
import {
  events,
  feed,
  OWNER,
  open,
  openInput,
  ptys,
  readinessMarker,
  service,
  settle,
  setupTerminalServiceActionsTest,
  spawn,
  TERMINAL_ID,
  TERMINAL_KEY,
  teardownTerminalServiceActionsTest,
  workDirA,
} from './terminal-service-actions-test-harness'

describe('makeNodePtyTerminalService input lifecycle', () => {
  beforeEach(setupTerminalServiceActionsTest)
  afterEach(teardownTerminalServiceActionsTest)

  it('queues an acknowledged write racing the initial open and releases it at readiness', async () => {
    const opening = open(workDirA)

    const writeResult = await Effect.runPromise(service.write(OWNER, TERMINAL_ID, 'typed early'))
    await opening
    await settle()

    expect(writeResult).toEqual({ status: 'queued', acceptedBytes: 11 })
    expect(ptys[0]?.write).not.toHaveBeenCalled()
    feed(0, readinessMarker(0))
    expect(ptys[0]?.write).toHaveBeenCalledExactlyOnceWith('typed early')
  })

  it('reserves bounded per-owner capacity before asynchronous opens can fan out', async () => {
    const history = Promise.withResolvers<string>()
    service.history.read = vi.fn(() => history.promise)
    const openings = Array.from({ length: TERMINAL.MAX_TERMINALS_PER_OWNER }, (_, index) =>
      Effect.runPromise(
        service.open({ ...openInput(workDirA), terminalId: `terminal-${String(index)}` }),
      ),
    )

    await expect(
      Effect.runPromise(
        service.open({ ...openInput(workDirA), terminalId: 'terminal-over-capacity' }),
      ),
    ).rejects.toThrow('Terminal capacity reached')
    expect(spawn).not.toHaveBeenCalled()

    history.resolve('')
    await Promise.all(openings)
    await settle()
    expect(spawn).toHaveBeenCalledTimes(TERMINAL.MAX_TERMINALS_PER_OWNER)
  })

  it('lets a fresh renderer generation append to pre-open input exactly once', async () => {
    const history = Promise.withResolvers<string>()
    service.history.read = vi.fn(() => history.promise)
    const firstIdentity = { generation: 'renderer-a', sequence: 0 } as const
    const secondIdentity = { generation: 'renderer-b', sequence: 0 } as const
    const firstOpen = Effect.runPromise(
      service.open({ ...openInput(workDirA), inputGeneration: firstIdentity.generation }),
    )

    await expect(
      Effect.runPromise(service.write(OWNER, TERMINAL_ID, 'before reload', firstIdentity)),
    ).resolves.toEqual({ status: 'queued', acceptedBytes: 13, identity: firstIdentity })

    const replacementOpen = Effect.runPromise(
      service.open({ ...openInput(workDirA), inputGeneration: secondIdentity.generation }),
    )
    await expect(
      Effect.runPromise(service.write(OWNER, TERMINAL_ID, ' after reload', secondIdentity)),
    ).resolves.toEqual({ status: 'queued', acceptedBytes: 13, identity: secondIdentity })

    history.resolve('')
    await Promise.all([firstOpen, replacementOpen])
    await settle()
    await expect(
      Effect.runPromise(service.write(OWNER, TERMINAL_ID, ' after reload', secondIdentity)),
    ).resolves.toEqual({ status: 'queued', acceptedBytes: 13, identity: secondIdentity })

    expect(ptys[0]?.write).not.toHaveBeenCalled()
    feed(0, readinessMarker(0))
    expect(ptys[0]?.write.mock.calls.map((call) => call[0])).toEqual([
      'before reload',
      ' after reload',
    ])
  })

  it('carries a pre-open Project Action barrier into the spawned record', async () => {
    const history = Promise.withResolvers<string>()
    service.history.read = vi.fn(() => history.promise)
    const identity = { generation: 'renderer-action', sequence: 0 } as const
    const intent = { kind: 'project-action', executionId: 'action-pre-open' } as const
    const opening = Effect.runPromise(
      service.open({ ...openInput(workDirA), inputGeneration: identity.generation }),
    )

    await expect(
      Effect.runPromise(service.write(OWNER, TERMINAL_ID, 'pnpm test\r', identity, intent)),
    ).resolves.toEqual({ status: 'queued', acceptedBytes: 10, identity })
    await expect(
      Effect.runPromise(service.write(OWNER, TERMINAL_ID, 'pnpm test\r', identity, intent)),
    ).resolves.toEqual({ status: 'queued', acceptedBytes: 10, identity })
    await expect(
      Effect.runPromise(
        service.write(
          OWNER,
          TERMINAL_ID,
          'pnpm lint\r',
          { ...identity, sequence: 1 },
          { kind: 'project-action', executionId: 'action-second' },
        ),
      ),
    ).resolves.toMatchObject({ status: 'rejected', reason: 'project-action-pending' })

    history.resolve('')
    await expect(opening).resolves.toMatchObject({ projectActionPending: true })
    await settle()
    feed(0, readinessMarker(0))
    expect(ptys[0]?.write).toHaveBeenCalledExactlyOnceWith('pnpm test\r')
    expect(service.records.get(TERMINAL_KEY)?.projectAction).not.toBeNull()

    feed(0, readinessMarker(0))
    expect(service.records.get(TERMINAL_KEY)?.projectAction).toBeNull()
  })

  it('releases a fast Project Action missed between reliable inspector polls', async () => {
    const identity = { generation: 'renderer-fast-action', sequence: 0 } as const
    const intent = { kind: 'project-action', executionId: 'fast-action' } as const
    await Effect.runPromise(
      service.open({ ...openInput(workDirA), inputGeneration: identity.generation }),
    )
    await settle()
    feed(0, readinessMarker(0))

    await expect(
      Effect.runPromise(service.write(OWNER, TERMINAL_ID, 'true\r', identity, intent)),
    ).resolves.toMatchObject({ status: 'written' })
    const record = service.records.get(TERMINAL_KEY)
    if (record === undefined) throw new Error('Expected terminal record')
    const deliveredAt = record.projectAction?.deliveredAtMonotonicMs
    if (typeof deliveredAt !== 'number') throw new Error('Expected Project Action delivery time')
    record.activity = {
      processName: null,
      processNames: [],
      ports: [],
      processPids: [],
      processIdentities: [],
      tty: null,
      processReliable: true,
      reliable: true,
    }

    expect(
      observeTerminalProjectActionActivity(
        record,
        deliveredAt + TERMINAL.PROJECT_ACTION_IDLE_FALLBACK_MS - 1,
      ),
    ).toBe(false)
    expect(record.projectAction).not.toBeNull()
    expect(
      observeTerminalProjectActionActivity(
        record,
        deliveredAt + TERMINAL.PROJECT_ACTION_IDLE_FALLBACK_MS,
      ),
    ).toBe(true)
    expect(record.projectAction).toBeNull()
  })

  it('restarts queued actions exactly once and never replays an already delivered action', async () => {
    const identity = { generation: 'renderer-action', sequence: 0 } as const
    const intent = { kind: 'project-action', executionId: 'restart-action' } as const
    const input = { ...openInput(workDirA), inputGeneration: identity.generation }
    await Effect.runPromise(service.open(input))
    await settle()
    await Effect.runPromise(service.write(OWNER, TERMINAL_ID, 'pnpm build\r', identity, intent))

    await Effect.runPromise(service.restart(input))
    await settle()
    expect(ptys[1]?.write).not.toHaveBeenCalled()
    feed(1, readinessMarker(1))
    expect(ptys[1]?.write).toHaveBeenCalledExactlyOnceWith('pnpm build\r')

    await Effect.runPromise(service.restart(input))
    await settle()
    feed(2, readinessMarker(2))
    expect(ptys[2]?.write).not.toHaveBeenCalled()
    expect(service.records.get(TERMINAL_KEY)?.projectAction).toBeNull()
  })

  it('preserves a chunked one-MiB paste in exact order while awaiting readiness', async () => {
    const oneMib = 1024 * 1024
    const utf8BytesPerCharacter = 4
    const charactersPerChunk = TERMINAL.MAX_INPUT_BYTES / utf8BytesPerCharacter
    const chunkCharacters = ['🙂', '🚀'] as const
    const expectedParts: string[] = []
    await open(workDirA)
    await settle()

    for (let acceptedBytes = 0; acceptedBytes < oneMib; acceptedBytes += TERMINAL.MAX_INPUT_BYTES) {
      const chunkIndex = acceptedBytes / TERMINAL.MAX_INPUT_BYTES
      const character = chunkCharacters[chunkIndex % chunkCharacters.length]
      const part = character.repeat(charactersPerChunk)
      expectedParts.push(part)
      await expect(Effect.runPromise(service.write(OWNER, TERMINAL_ID, part))).resolves.toEqual({
        status: 'queued',
        acceptedBytes: TERMINAL.MAX_INPUT_BYTES,
      })
    }

    feed(0, readinessMarker(0))
    expect(ptys[0]?.write.mock.calls.flat().join('')).toBe(expectedParts.join(''))
  })

  it('clear preserves readiness while restart resets it and rejects stale shell output', async () => {
    await open(workDirA)
    await settle()
    feed(0, readinessMarker(0))
    expect(service.records.get(TERMINAL_KEY)?.readinessPhase).toBe('ready')

    await Effect.runPromise(service.clear(OWNER, TERMINAL_ID))
    expect(service.records.get(TERMINAL_KEY)?.readinessPhase).toBe('ready')
    await expect(
      Effect.runPromise(service.write(OWNER, TERMINAL_ID, 'after clear')),
    ).resolves.toEqual({ status: 'written', acceptedBytes: 11 })

    await Effect.runPromise(service.restart(openInput(workDirA)))
    await settle()
    expect(service.records.get(TERMINAL_KEY)?.readinessPhase).toBe('awaiting-prompt')
    ptys[0]?.dataListeners[0]?.(readinessMarker(0))
    expect(service.records.get(TERMINAL_KEY)?.readinessPhase).toBe('awaiting-prompt')
    feed(1, readinessMarker(1))
    expect(service.records.get(TERMINAL_KEY)?.readinessPhase).toBe('ready')
  })

  it('does not claim Clear succeeded when durable history truncation fails', async () => {
    await open(workDirA)
    await settle()
    feed(0, 'sensitive output')
    const failure = new Error('history storage unavailable')
    service.history.truncate = vi.fn(() => Promise.reject(failure))
    ptys[0]?.resumeOutput.mockClear()

    await expect(Effect.runPromise(service.clear(OWNER, TERMINAL_ID))).rejects.toThrow(
      failure.message,
    )

    expect(service.records.get(TERMINAL_KEY)?.scrollback.toString()).toBe('sensitive output')
    expect(events.some((payload) => payload.event.type === 'cleared')).toBe(false)
    expect(ptys[0]?.pauseOutput).toHaveBeenCalledOnce()
    expect(ptys[0]?.resumeOutput).toHaveBeenCalledOnce()
  })

  it('does not respawn or erase in-memory state when Restart cannot clear durable history', async () => {
    await open(workDirA)
    await settle()
    feed(0, 'keep this output')
    const failure = new Error('history truncation denied')
    service.history.truncate = vi.fn(() => Promise.reject(failure))

    await expect(Effect.runPromise(service.restart(openInput(workDirA)))).rejects.toThrow(
      failure.message,
    )

    expect(ptys[0]?.closeDescriptor).toHaveBeenCalledOnce()
    expect(ptys[0]?.kill).not.toHaveBeenCalled()
    expect(spawn).toHaveBeenCalledOnce()
    expect(service.records.get(TERMINAL_KEY)?.scrollback.toString()).toBe('keep this output')
  })
})
