import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/** Just enough of Web Audio for the sound player: time stands still unless a test moves it. */
class FakeAudioContext {
  static readonly created: FakeAudioContext[] = []
  state: AudioContextState = 'running'
  currentTime = 0
  readonly destination = {}
  readonly close = vi.fn(async () => {
    this.state = 'closed'
  })
  constructor() {
    FakeAudioContext.created.push(this)
  }
  resume = vi.fn(async () => undefined)
  createOscillator() {
    return {
      type: 'sine',
      frequency: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
      connect: (node: unknown) => node,
      start: vi.fn(),
      stop: vi.fn(),
    }
  }
  createGain() {
    const gain = {
      gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
      connect: (node: unknown) => node,
    }
    return gain
  }
}

async function loadPlayer() {
  vi.resetModules()
  return import('../notification-sounds')
}

describe('playNotificationSound', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    FakeAudioContext.created.length = 0
    vi.stubGlobal('AudioContext', FakeAudioContext)
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('closes the audio context once the sound has played, releasing the output stream', async () => {
    const { playNotificationSound, NOTIFICATION_AUDIO_RELEASE_MS } = await loadPlayer()
    await playNotificationSound('low-tone')
    const [audio] = FakeAudioContext.created

    // low-tone ends 0.01 + 0.22 + 0.45 + 0.02 s after it starts.
    await vi.advanceTimersByTimeAsync(700 + NOTIFICATION_AUDIO_RELEASE_MS - 10)
    expect(audio?.close).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(20)
    expect(audio?.close).toHaveBeenCalledOnce()
  })

  it('reuses one context for sounds in quick succession and opens a new one after closing', async () => {
    const { playNotificationSound, NOTIFICATION_AUDIO_RELEASE_MS } = await loadPlayer()
    await playNotificationSound('pop')
    await vi.advanceTimersByTimeAsync(NOTIFICATION_AUDIO_RELEASE_MS / 2)
    await playNotificationSound('pop')
    expect(FakeAudioContext.created).toHaveLength(1)

    await vi.advanceTimersByTimeAsync(NOTIFICATION_AUDIO_RELEASE_MS * 2)
    expect(FakeAudioContext.created[0]?.close).toHaveBeenCalledOnce()
    await playNotificationSound('pop')
    expect(FakeAudioContext.created).toHaveLength(2)
  })
})
