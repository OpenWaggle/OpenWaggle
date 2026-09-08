import type { TerminalEventPayload } from '@shared/types/terminal'
import * as Effect from 'effect/Effect'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TerminalEventSink } from '../../ports/terminal-event-sink'

const webContentsMock = vi.hoisted(() => ({
  fromId: vi.fn(),
}))

vi.mock('electron', () => ({
  webContents: webContentsMock,
}))

const { ElectronTerminalEventSinkLive } = await import('../electron-terminal-event-sink')

interface FakeWebContents {
  readonly send: ReturnType<typeof vi.fn>
  readonly isDestroyed: () => boolean
  destroyed: boolean
}

const OWNER = 'session-1'
const TERMINAL_ID = 'main'
const TERMINAL_KEY = `${OWNER}::${TERMINAL_ID}`
const OTHER_KEY = `${OWNER}::side`

const PAYLOAD: TerminalEventPayload = {
  ownerKey: OWNER,
  terminalId: TERMINAL_ID,
  event: { type: 'exited', exitCode: 0 },
}

const surfaceRegistry = new Map<number, FakeWebContents>()

function makeSurface(id: number): FakeWebContents {
  const surface: FakeWebContents = {
    send: vi.fn(),
    destroyed: false,
    isDestroyed: () => surface.destroyed,
  }
  surfaceRegistry.set(id, surface)
  return surface
}

async function buildSink() {
  return Effect.runPromise(
    Effect.gen(function* () {
      return yield* TerminalEventSink
    }).pipe(Effect.provide(ElectronTerminalEventSinkLive)),
  )
}

describe('ElectronTerminalEventSinkLive', () => {
  beforeEach(() => {
    surfaceRegistry.clear()
    webContentsMock.fromId.mockReset()
    webContentsMock.fromId.mockImplementation((requested: number) => surfaceRegistry.get(requested))
  })

  it('fans one event out to every surface attached to the terminal', async () => {
    const sink = await buildSink()
    const first = makeSurface(1)
    const second = makeSurface(2)
    await Effect.runPromise(sink.attach(TERMINAL_KEY, 1))
    await Effect.runPromise(sink.attach(TERMINAL_KEY, 2))

    await Effect.runPromise(sink.emit(PAYLOAD))

    expect(first.send).toHaveBeenCalledExactlyOnceWith('terminal:event', PAYLOAD)
    expect(second.send).toHaveBeenCalledExactlyOnceWith('terminal:event', PAYLOAD)
  })

  it('prunes a destroyed surface on emit while the rest still receive', async () => {
    const sink = await buildSink()
    const dead = makeSurface(1)
    dead.destroyed = true
    const alive = makeSurface(2)
    await Effect.runPromise(sink.attach(TERMINAL_KEY, 1))
    await Effect.runPromise(sink.attach(TERMINAL_KEY, 2))

    await Effect.runPromise(sink.emit(PAYLOAD))
    await Effect.runPromise(sink.emit(PAYLOAD))

    expect(dead.send).not.toHaveBeenCalled()
    expect(alive.send).toHaveBeenCalledTimes(2)
    const deadLookups = webContentsMock.fromId.mock.calls.filter((call) => call[0] === 1)
    expect(deadLookups).toHaveLength(1)
  })

  it('detaches one terminal/surface pair without touching other terminals', async () => {
    const sink = await buildSink()
    const surface = makeSurface(1)
    await Effect.runPromise(sink.attach(TERMINAL_KEY, 1))
    await Effect.runPromise(sink.attach(OTHER_KEY, 1))

    await expect(Effect.runPromise(sink.detach(TERMINAL_KEY, 1))).resolves.toBe(true)

    await Effect.runPromise(
      sink.emit({ ownerKey: OWNER, terminalId: TERMINAL_ID, event: { type: 'closed' } }),
    )
    expect(surface.send).not.toHaveBeenCalled()

    await Effect.runPromise(
      sink.emit({ ownerKey: OWNER, terminalId: 'side', event: { type: 'closed' } }),
    )
    expect(surface.send).toHaveBeenCalledOnce()
  })

  it('detachSurface removes the surface across every terminal', async () => {
    const sink = await buildSink()
    const surface = makeSurface(1)
    await Effect.runPromise(sink.attach(TERMINAL_KEY, 1))
    await Effect.runPromise(sink.attach(OTHER_KEY, 1))

    await expect(Effect.runPromise(sink.detachSurface(1))).resolves.toEqual([
      TERMINAL_KEY,
      OTHER_KEY,
    ])

    await Effect.runPromise(sink.emit(PAYLOAD))
    await Effect.runPromise(
      sink.emit({ ownerKey: OWNER, terminalId: 'side', event: { type: 'closed' } }),
    )
    expect(surface.send).not.toHaveBeenCalled()
  })

  it('moves and merges attachments when a terminal owner is rekeyed', async () => {
    const sink = await buildSink()
    const first = makeSurface(1)
    const second = makeSurface(2)
    const destinationKey = 'session-born::main'
    await Effect.runPromise(sink.attach(TERMINAL_KEY, 1))
    await Effect.runPromise(sink.attach(destinationKey, 2))

    await Effect.runPromise(sink.move(TERMINAL_KEY, destinationKey))
    await Effect.runPromise(sink.emit(PAYLOAD))
    expect(first.send).not.toHaveBeenCalled()

    const migratedPayload: TerminalEventPayload = {
      ownerKey: 'session-born',
      terminalId: TERMINAL_ID,
      event: { type: 'exited', exitCode: 0 },
    }
    await Effect.runPromise(sink.emit(migratedPayload))

    expect(first.send).toHaveBeenCalledExactlyOnceWith('terminal:event', migratedPayload)
    expect(second.send).toHaveBeenCalledExactlyOnceWith('terminal:event', migratedPayload)
  })

  it('reports only terminals that lose their final watcher', async () => {
    const sink = await buildSink()
    makeSurface(1)
    makeSurface(2)
    await Effect.runPromise(sink.attach(TERMINAL_KEY, 1))
    await Effect.runPromise(sink.attach(TERMINAL_KEY, 2))
    await Effect.runPromise(sink.attach(OTHER_KEY, 1))

    await expect(Effect.runPromise(sink.detach(TERMINAL_KEY, 1))).resolves.toBe(false)
    await expect(Effect.runPromise(sink.detachSurface(1))).resolves.toEqual([OTHER_KEY])
    await expect(Effect.runPromise(sink.detachSurface(2))).resolves.toEqual([TERMINAL_KEY])
  })

  it('emitting without attachments is a no-op', async () => {
    const sink = await buildSink()

    await Effect.runPromise(sink.emit(PAYLOAD))

    expect(webContentsMock.fromId).not.toHaveBeenCalled()
  })

  it('drops an attachment whose webContents no longer resolves', async () => {
    const sink = await buildSink()
    await Effect.runPromise(sink.attach(TERMINAL_KEY, 7))

    await Effect.runPromise(sink.emit(PAYLOAD))
    await Effect.runPromise(sink.emit(PAYLOAD))

    expect(webContentsMock.fromId).toHaveBeenCalledTimes(1)
  })
})
