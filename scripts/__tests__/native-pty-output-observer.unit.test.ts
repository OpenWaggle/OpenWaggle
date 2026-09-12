import { describe, expect, it } from 'vitest'
import { observePtyOutput } from '../native-pty-output-observer'
import { IDENTITY_PREFIX, IDENTITY_SUFFIX, parseIdentity, PROMPT_OUTPUT } from '../native-pty-probe-support'

function fixture(consoleOutput = true) {
  const listeners = new Set<(data: string) => void>()
  const observer = observePtyOutput({
    onData: (listener) => {
      listeners.add(listener)
      return { dispose: () => { listeners.delete(listener) } }
    },
  }, consoleOutput)
  return { observer, emit: (data: string) => { for (const listener of listeners) listener(data) } }
}

describe('native PTY output observation', () => {
  it('decodes the Windows identity record with the cursor controls seen in CI', async () => {
    const { observer, emit } = fixture()
    try {
      const raw = `${IDENTITY_PREFIX}3916,5816,1,1\x1b[0K\x1b[?25l${IDENTITY_SUFFIX}\r\n`
      emit(raw)
      await observer.waitFor(IDENTITY_SUFFIX)
      expect(parseIdentity(observer.readVisible())).toEqual({
        pid: 3916, descendantPid: 5816, stdinTty: true, stdoutTty: true,
      })
      expect(observer.read()).toBe(raw)
    } finally {
      observer.dispose()
    }
  })

  it.each([80, 81])('keeps identity framing intact across %i-column row wrapping', async (columns) => {
    const { observer, emit } = fixture()
    try {
      observer.resize(columns, 25)
      emit(`${' '.repeat(columns - 2)}${IDENTITY_PREFIX}3916,5816,1,1${IDENTITY_SUFFIX}\r\n`)
      await observer.waitFor(IDENTITY_SUFFIX)
      expect(parseIdentity(observer.readVisible()).pid).toBe(3916)
    } finally {
      observer.dispose()
    }
  })

  it('finds a prompt marker split by an OSC title and separate transport chunks', async () => {
    const { observer, emit } = fixture()
    try {
      const ready = observer.waitFor(PROMPT_OUTPUT)
      emit(`${PROMPT_OUTPUT.slice(0, 10)}\x1b]0;C:\\runtime\\node.exe`)
      emit(`\x07${PROMPT_OUTPUT.slice(10)}`)
      await ready
      expect(observer.readVisible()).toContain(PROMPT_OUTPUT)
      expect(observer.read()).not.toContain(PROMPT_OUTPUT)
    } finally {
      observer.dispose()
    }
  })

  it.each(['3916,5816,0,1', '3916,5816,1,0', '0,5816,1,1', '3916,5816,1,1,extra'])(
    'still rejects an invalid rendered identity: %s', async (fields) => {
      const { observer, emit } = fixture()
      try {
        emit(`${IDENTITY_PREFIX}${fields}\x1b[0K${IDENTITY_SUFFIX}\r\n`)
        await observer.waitFor(IDENTITY_SUFFIX)
        expect(() => parseIdentity(observer.readVisible())).toThrow('PTY identity failed')
      } finally {
        observer.dispose()
      }
    },
  )

  it('keeps Unix observation byte-exact', async () => {
    const { observer, emit } = fixture(false)
    try {
      const raw = `${IDENTITY_PREFIX}3916,5816,1,1\x1b[0K${IDENTITY_SUFFIX}\n`
      emit(raw)
      await observer.waitFor(IDENTITY_SUFFIX)
      expect(observer.readVisible()).toBe(raw)
      expect(() => parseIdentity(observer.readVisible())).toThrow('PTY identity failed')
    } finally {
      observer.dispose()
    }
  })

  it('removes the transport subscription on disposal', async () => {
    const { observer, emit } = fixture()
    emit(PROMPT_OUTPUT)
    await observer.waitFor(PROMPT_OUTPUT)
    observer.dispose()
    emit('after disposal')
    expect(observer.read()).toBe(PROMPT_OUTPUT)
  })
})
