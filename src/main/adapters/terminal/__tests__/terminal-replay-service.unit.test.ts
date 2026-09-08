import { Buffer } from 'node:buffer'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { COLD_REPLAY_STATE_BOUNDARY, PREVIOUS_TERMINAL_SESSION_SEPARATOR } from '../terminal-replay'
import {
  feed,
  OUTPUT_FLUSH_MS,
  OWNER,
  open,
  openInput,
  ptys,
  service,
  settle,
  setupTerminalServiceActionsTest,
  spawn,
  TERMINAL_ID,
  TERMINAL_KEY,
  teardownTerminalServiceActionsTest,
  workDirA,
} from './terminal-service-actions-test-harness'

describe('terminal replay service integration', () => {
  beforeEach(setupTerminalServiceActionsTest)
  afterEach(teardownTerminalServiceActionsTest)

  it('labels persisted cold replay once while keeping hot reattach seamless', async () => {
    service.history.append(TERMINAL_KEY, 'previous output\n')
    await service.history.flush()

    const cold = await open(workDirA)
    await settle()
    const hot = await open(workDirA)

    expect(cold.history).toBe(
      `previous output\n${COLD_REPLAY_STATE_BOUNDARY}${PREVIOUS_TERMINAL_SESSION_SEPARATOR}`,
    )
    expect(hot.history).toBe(cold.history)
    expect(hot.history.split('Previous terminal session')).toHaveLength(2)
    await expect(service.history.read(TERMINAL_KEY)).resolves.toBe('previous output\n')
    expect(spawn).toHaveBeenCalledOnce()
  })

  it('includes an incomplete sanitizer tail in a hot replacement snapshot', async () => {
    await open(workDirA)
    await settle()
    const sequencePrefix = '\x1b[38;5;19'
    feed(0, `before${sequencePrefix}`)
    await vi.advanceTimersByTimeAsync(OUTPUT_FLUSH_MS)
    await service.history.flush()

    const replacement = await open(workDirA)

    expect(replacement.history).toBe(`before${sequencePrefix}`)
    expect(replacement.outputBytes).toBe(Buffer.byteLength(`before${sequencePrefix}`, 'utf8'))
    await expect(service.history.read(TERMINAL_KEY)).resolves.toBe('before')

    feed(0, '6mred')
    expect(service.records.get(TERMINAL_KEY)?.scrollback.toString()).toBe(
      `before${sequencePrefix}6mred`,
    )
  })

  it('carries an incomplete live escape tail across owner migration snapshots', async () => {
    const draftOwner = 'draft:/repo'
    const sessionOwner = 'session-born'
    const sessionKey = `${sessionOwner}::${TERMINAL_ID}`
    const sequencePrefix = '\x1b[38;5;19'
    await Effect.runPromise(service.open({ ...openInput(workDirA), ownerKey: draftOwner }))
    await settle()
    ptys[0]?.dataListeners[0]?.(`draft${sequencePrefix}`)

    await Effect.runPromise(service.migrateOwner(draftOwner, sessionOwner))
    const attached = await Effect.runPromise(
      service.open({ ...openInput(workDirA), ownerKey: sessionOwner }),
    )

    expect(attached.history).toBe(`draft${sequencePrefix}`)
    expect(service.records.get(sessionKey)?.sanitizer.pendingRawTail()).toBe(sequencePrefix)
    await service.history.flush()
    await expect(service.history.read(sessionKey)).resolves.toBe('draft')
  })

  it('sanitizes in-memory scrollback before respawning a dead shell', async () => {
    await open(workDirA)
    await settle()
    feed(0, 'hello')
    await vi.advanceTimersByTimeAsync(OUTPUT_FLUSH_MS)
    ptys[0]?.emitExit(7)
    await settle()
    expect(service.records.get(TERMINAL_KEY)?.live).toBeNull()
    await expect(
      Effect.runPromise(service.write(OWNER, TERMINAL_ID, 'must wait for restart')),
    ).resolves.toEqual({
      status: 'rejected',
      acceptedBytes: 0,
      reason: 'terminal-not-open',
    })

    const result = await open(workDirA)

    expect(result).toMatchObject({
      history: `hello\r\n${COLD_REPLAY_STATE_BOUNDARY}${PREVIOUS_TERMINAL_SESSION_SEPARATOR}`,
      outputBytes: 5,
      outputGeneration: 2,
      running: true,
    })
    expect(spawn).toHaveBeenCalledTimes(2)
    await settle()
    const record = service.records.get(TERMINAL_KEY)
    expect(record?.live?.pty).toBe(ptys[1]?.pty)
    expect(record?.exitCode).toBeNull()
  })

  it('turns a dead TUI screen into an inert transcript before respawn', async () => {
    await open(workDirA)
    await settle()
    feed(
      0,
      `body\x1b[?1049h\x1b[2J\x1b[H\x1b[3;20r\x1b[31mred\x1b]8;;https://example.com\x1b\\link`,
    )
    ptys[0]?.exitListeners[0]?.({ exitCode: 0 })

    const result = await open(workDirA)
    const expected = `body\x1b[31mredlink\r\n${COLD_REPLAY_STATE_BOUNDARY}${PREVIOUS_TERMINAL_SESSION_SEPARATOR}`

    expect(result.history).toBe(expected)
    expect(result.history).not.toContain('\x1b[2J')
    expect(result.history).not.toContain('\x1b[3;20r')
    expect(service.records.get(TERMINAL_KEY)?.scrollback.toString()).toBe(expected)
  })
})
