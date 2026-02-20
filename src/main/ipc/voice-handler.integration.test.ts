import { beforeEach, describe, expect, it, vi } from 'vitest'

const { safeHandleMock, getPathMock, mkdirMock, pipelineMock, transformersEnv } = vi.hoisted(
  () => ({
    safeHandleMock: vi.fn(),
    getPathMock: vi.fn(() => '/tmp/openhive-user-data'),
    mkdirMock: vi.fn(async () => undefined),
    pipelineMock: vi.fn(),
    transformersEnv: {
      backends: {
        onnx: {
          logLevel: undefined as 'verbose' | 'info' | 'warning' | 'error' | 'fatal' | undefined,
        },
      },
    } as {
      allowLocalModels?: boolean
      allowRemoteModels?: boolean
      cacheDir?: string
      backends?: {
        onnx?: {
          logLevel?: 'verbose' | 'info' | 'warning' | 'error' | 'fatal'
        }
      }
    },
  }),
)

vi.mock('./typed-ipc', () => ({
  safeHandle: safeHandleMock,
}))

vi.mock('electron', () => ({
  app: {
    getPath: getPathMock,
  },
}))

vi.mock('node:fs/promises', () => ({
  mkdir: mkdirMock,
}))

vi.mock('@xenova/transformers', () => ({
  env: transformersEnv,
  pipeline: pipelineMock,
}))

import { registerVoiceHandlers, resetVoiceHandlerForTests } from './voice-handler'

function registeredHandler(name: string): ((...args: unknown[]) => Promise<unknown>) | undefined {
  const call = safeHandleMock.mock.calls.find((c: unknown[]) => c[0] === name)
  return call?.[1] as ((...args: unknown[]) => Promise<unknown>) | undefined
}

function toPcm16(values: number[]): Uint8Array {
  const bytes = new Uint8Array(values.length * 2)
  const view = new DataView(bytes.buffer)
  for (let index = 0; index < values.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, values[index]))
    const int16 = sample < 0 ? Math.round(sample * 32768) : Math.round(sample * 32767)
    view.setInt16(index * 2, int16, true)
  }
  return bytes
}

describe('registerVoiceHandlers', () => {
  beforeEach(() => {
    safeHandleMock.mockReset()
    getPathMock.mockClear()
    mkdirMock.mockClear()
    pipelineMock.mockReset()
    transformersEnv.allowLocalModels = undefined
    transformersEnv.allowRemoteModels = undefined
    transformersEnv.cacheDir = undefined
    if (transformersEnv.backends?.onnx) {
      transformersEnv.backends.onnx.logLevel = undefined
    }
    resetVoiceHandlerForTests()
  })

  it('registers local voice transcription and returns Whisper tiny text by default', async () => {
    const transcriber = vi.fn(async (_audio: Float32Array, _options?: Record<string, unknown>) => ({
      text: 'hello from local whisper',
    }))
    pipelineMock.mockResolvedValue(transcriber)

    registerVoiceHandlers()
    const handler = registeredHandler('voice:transcribe-local')

    expect(handler).toBeDefined()
    const result = (await handler?.(
      {},
      { pcm16: toPcm16([0.2, -1.3, 0.9]), sampleRate: 16_000 },
    )) as {
      text: string
      model: string
    }

    expect(mkdirMock).toHaveBeenCalledWith('/tmp/openhive-user-data/models/transformers', {
      recursive: true,
    })
    expect(pipelineMock).toHaveBeenCalledWith(
      'automatic-speech-recognition',
      'Xenova/whisper-tiny.en',
      { quantized: true },
    )
    expect(transcriber).toHaveBeenCalledOnce()

    const firstCall = transcriber.mock.calls.at(0)
    expect(firstCall).toBeDefined()
    const transcriberArg = firstCall?.[0]
    expect(transcriberArg).toBeInstanceOf(Float32Array)
    if (!(transcriberArg instanceof Float32Array)) {
      throw new Error('Expected transcriber audio argument to be Float32Array.')
    }
    const normalized = Array.from(transcriberArg)
    expect(normalized[0]).toBeCloseTo(0.2, 3)
    expect(normalized[1]).toBeCloseTo(-1, 3)
    expect(normalized[2]).toBeCloseTo(0.9, 3)
    expect(result).toEqual({
      text: 'hello from local whisper',
      model: 'tiny',
    })
    expect(transformersEnv.allowLocalModels).toBe(true)
    expect(transformersEnv.allowRemoteModels).toBe(true)
    expect(transformersEnv.cacheDir).toBe('/tmp/openhive-user-data/models/transformers')
    expect(transformersEnv.backends?.onnx?.logLevel).toBe('error')
  })

  it('reuses loaded transcriber between requests', async () => {
    const transcriber = vi.fn(async (_audio: Float32Array, _options?: Record<string, unknown>) => ({
      text: 'ok',
    }))
    pipelineMock.mockResolvedValue(transcriber)

    registerVoiceHandlers()
    const handler = registeredHandler('voice:transcribe-local')

    await handler?.({}, { pcm16: toPcm16([0.1]), sampleRate: 16_000 })
    await handler?.({}, { pcm16: toPcm16([0.2]), sampleRate: 16_000 })

    expect(pipelineMock).toHaveBeenCalledTimes(1)
    expect(transcriber).toHaveBeenCalledTimes(2)
  })

  it('maps model load failures to a clear first-run message', async () => {
    pipelineMock.mockRejectedValue(new Error('network timeout'))

    registerVoiceHandlers()
    const handler = registeredHandler('voice:transcribe-local')

    await expect(handler?.({}, { pcm16: toPcm16([0.1]), sampleRate: 16_000 })).rejects.toThrow(
      'Connect once to download it',
    )
  })

  it('maps missing sharp binary failures to actionable local setup guidance', async () => {
    pipelineMock.mockRejectedValue(
      new Error(
        'Something went wrong installing the "sharp" module. Cannot find module ../build/Release/sharp-darwin-arm64v8.node',
      ),
    )

    registerVoiceHandlers()
    const handler = registeredHandler('voice:transcribe-local')

    await expect(handler?.({}, { pcm16: toPcm16([0.1]), sampleRate: 16_000 })).rejects.toThrow(
      'pnpm rebuild sharp',
    )
  })
})
