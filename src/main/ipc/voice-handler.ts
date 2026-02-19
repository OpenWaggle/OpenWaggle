import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import {
  VOICE_MODEL_BASE,
  VOICE_MODEL_TINY,
  type VoiceModel,
  type VoiceTranscriptionResult,
} from '@shared/types/voice'
import { app, ipcMain } from 'electron'
import { z } from 'zod'

const SAMPLE_RATE_MIN = 8_000
const SAMPLE_RATE_MAX = 48_000
const MAX_AUDIO_SECONDS = 90
const MAX_PCM16_BYTES = SAMPLE_RATE_MAX * MAX_AUDIO_SECONDS * 2
const MAX_LEGACY_SAMPLE_COUNT = SAMPLE_RATE_MAX * MAX_AUDIO_SECONDS

const VOICE_MODEL_CONFIG: Record<
  VoiceModel,
  { modelId: string; quantized: boolean; language?: string }
> = {
  tiny: {
    modelId: 'Xenova/whisper-tiny.en',
    quantized: true,
    language: 'en',
  },
  base: {
    modelId: 'Xenova/whisper-base',
    quantized: false,
  },
}

const modernTranscribePayloadSchema = z.object({
  pcm16: z.custom<Uint8Array>(
    (value) =>
      value instanceof Uint8Array && value.byteLength > 0 && value.byteLength <= MAX_PCM16_BYTES,
    'pcm16 payload is invalid.',
  ),
  sampleRate: z.number().int().min(SAMPLE_RATE_MIN).max(SAMPLE_RATE_MAX),
  language: z.string().trim().min(2).max(16).optional(),
  model: z.enum([VOICE_MODEL_TINY, VOICE_MODEL_BASE]).optional(),
})

const legacyTranscribePayloadSchema = z.object({
  samples: z.array(z.number().finite()).min(1).max(MAX_LEGACY_SAMPLE_COUNT),
  sampleRate: z.number().int().min(SAMPLE_RATE_MIN).max(SAMPLE_RATE_MAX),
  language: z.string().trim().min(2).max(16).optional(),
  model: z.literal(VOICE_MODEL_BASE).optional(),
})

const transcribePayloadSchema = z.union([
  modernTranscribePayloadSchema,
  legacyTranscribePayloadSchema,
])

type WhisperTranscriber = (
  audio: Float32Array,
  options?: Record<string, unknown>,
) => Promise<unknown>

interface TransformersEnv {
  allowLocalModels?: boolean
  allowRemoteModels?: boolean
  cacheDir?: string
  backends?: {
    onnx?: {
      logLevel?: 'verbose' | 'info' | 'warning' | 'error' | 'fatal'
    }
  }
}

interface TransformersModule {
  env: TransformersEnv
  pipeline: (task: string, model: string, options?: Record<string, unknown>) => Promise<unknown>
}

const transcriberPromises: Partial<Record<VoiceModel, Promise<WhisperTranscriber>>> = {}

function isTransformersModule(value: unknown): value is TransformersModule {
  if (typeof value !== 'object' || value === null) return false
  if (!('pipeline' in value) || typeof value.pipeline !== 'function') return false
  if (!('env' in value) || typeof value.env !== 'object' || value.env === null) return false
  return true
}

function pcm16BytesToFloat32(bytes: Uint8Array): Float32Array {
  const sampleCount = Math.floor(bytes.byteLength / 2)
  const normalized = new Float32Array(sampleCount)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  for (let index = 0; index < sampleCount; index += 1) {
    const value = view.getInt16(index * 2, true)
    normalized[index] = Math.max(-1, Math.min(1, value / 32768))
  }
  return normalized
}

function normalizeLegacySamples(samples: number[]): Float32Array {
  const normalized = new Float32Array(samples.length)
  for (let index = 0; index < samples.length; index += 1) {
    normalized[index] = Math.max(-1, Math.min(1, samples[index]))
  }
  return normalized
}

function extractTranscriptionText(result: unknown): string {
  if (typeof result === 'string') {
    return result.trim()
  }
  if (typeof result !== 'object' || result === null) {
    return ''
  }
  if (!('text' in result) || typeof result.text !== 'string') {
    return ''
  }
  return result.text.trim()
}

function mapLoadError(error: unknown): string {
  const message = error instanceof Error ? error.message : 'Unknown model load error.'
  if (
    /sharp/i.test(message) &&
    /(cannot find module|went wrong installing|sharp-darwin|sharp-linux|sharp-win32)/i.test(message)
  ) {
    return 'Local voice dependency is missing (sharp). Run `pnpm install` or `pnpm rebuild sharp`, then restart OpenHive.'
  }
  if (/(network|fetch|download|ENOTFOUND|ECONN|timed out)/i.test(message)) {
    return 'Local Whisper base model is not available yet. Connect once to download it, then retry.'
  }
  return 'Unable to load local Whisper base model. Verify local dependencies and retry.'
}

function mapTranscriptionError(error: unknown): string {
  const message = error instanceof Error ? error.message : 'Unknown transcription error.'
  return `Local voice transcription failed: ${message}`
}

async function loadTranscriber(model: VoiceModel): Promise<WhisperTranscriber> {
  const existing = transcriberPromises[model]
  if (existing) return existing

  const config = VOICE_MODEL_CONFIG[model]
  const transcriberPromise = (async () => {
    const imported: unknown = await import('@xenova/transformers')
    if (!isTransformersModule(imported)) {
      throw new Error('Transformers runtime is unavailable.')
    }

    const cacheDir = path.join(app.getPath('userData'), 'models', 'transformers')
    await mkdir(cacheDir, { recursive: true })

    imported.env.allowLocalModels = true
    imported.env.allowRemoteModels = true
    imported.env.cacheDir = cacheDir
    if (imported.env.backends?.onnx) {
      imported.env.backends.onnx.logLevel = 'error'
    }

    const transcriber = await imported.pipeline('automatic-speech-recognition', config.modelId, {
      quantized: config.quantized,
    })
    if (typeof transcriber !== 'function') {
      throw new Error('Whisper transcriber could not be created.')
    }
    return transcriber as WhisperTranscriber
  })().catch((error) => {
    delete transcriberPromises[model]
    throw error
  })

  transcriberPromises[model] = transcriberPromise
  return transcriberPromise
}

export function resetVoiceHandlerForTests(): void {
  for (const model of [VOICE_MODEL_TINY, VOICE_MODEL_BASE] as const) {
    delete transcriberPromises[model]
  }
}

export function registerVoiceHandlers(): void {
  ipcMain.handle('voice:transcribe-local', async (_event, rawPayload: unknown) => {
    const payload = transcribePayloadSchema.parse(rawPayload)
    const isModernPayload = 'pcm16' in payload
    const model = payload.model ?? (isModernPayload ? VOICE_MODEL_TINY : VOICE_MODEL_BASE)
    const sampleCount = isModernPayload
      ? Math.floor(payload.pcm16.byteLength / 2)
      : payload.samples.length
    if (sampleCount <= 0) {
      throw new Error('Audio payload is empty.')
    }
    const maxSampleCount = payload.sampleRate * MAX_AUDIO_SECONDS
    if (sampleCount > maxSampleCount) {
      throw new Error(`Audio exceeds ${String(MAX_AUDIO_SECONDS)} seconds; record a shorter clip.`)
    }
    const audio = isModernPayload
      ? pcm16BytesToFloat32(payload.pcm16)
      : normalizeLegacySamples(payload.samples)

    let transcriber: WhisperTranscriber
    try {
      transcriber = await loadTranscriber(model)
    } catch (error) {
      throw new Error(mapLoadError(error))
    }

    try {
      const modelConfig = VOICE_MODEL_CONFIG[model]
      const rawResult = await transcriber(audio, {
        task: 'transcribe',
        return_timestamps: false,
        chunk_length_s: 10,
        stride_length_s: 2,
        language: payload.language ?? modelConfig.language,
      })
      const text = extractTranscriptionText(rawResult)
      const response: VoiceTranscriptionResult = { text, model }
      return response
    } catch (error) {
      throw new Error(mapTranscriptionError(error))
    }
  })
}
