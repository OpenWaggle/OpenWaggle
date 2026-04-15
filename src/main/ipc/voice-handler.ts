import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { AUDIO_RECORDING, AUDIO_SAMPLE_RATE, LANGUAGE_CODE } from '@shared/constants/audio-config'
import { DOUBLE_FACTOR } from '@shared/constants/math'
import { VOICE_TIMEOUT } from '@shared/constants/time'
import { decodeUnknownOrThrow, Schema } from '@shared/schema'
import {
  VOICE_MODEL_BASE,
  VOICE_MODEL_TINY,
  type VoiceModel,
  type VoiceTranscriptionResult,
} from '@shared/types/voice'
import * as Effect from 'effect/Effect'
import { app } from 'electron'
import { typedHandle } from './typed-ipc'

const PCM16_SIGNED_NORMALIZATION_FACTOR = 32768

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

const modernTranscribePayloadSchema = Schema.Struct({
  pcm16: Schema.Uint8ArrayFromSelf.pipe(
    Schema.filter((value) => {
      if (value.byteLength <= 0) {
        return 'pcm16 payload is invalid.'
      }
      return value.byteLength <= AUDIO_RECORDING.MAX_PCM16_BYTES || 'pcm16 payload is invalid.'
    }),
  ),
  sampleRate: Schema.Number.pipe(
    Schema.int(),
    Schema.greaterThanOrEqualTo(AUDIO_SAMPLE_RATE.MIN_HZ),
    Schema.lessThanOrEqualTo(AUDIO_SAMPLE_RATE.MAX_HZ),
  ),
  language: Schema.optional(
    Schema.String.pipe(
      Schema.trimmed(),
      Schema.minLength(LANGUAGE_CODE.MIN_LENGTH),
      Schema.maxLength(LANGUAGE_CODE.MAX_LENGTH),
    ),
  ),
  model: Schema.optional(Schema.Literal(VOICE_MODEL_TINY, VOICE_MODEL_BASE)),
})
const transcribePayloadSchema = modernTranscribePayloadSchema

type WhisperTranscriber = (
  audio: Float32Array,
  options?: WhisperTranscriberOptions,
) => Promise<unknown>

interface WhisperTranscriberOptions {
  readonly quantized?: boolean
  readonly task?: 'transcribe'
  readonly return_timestamps?: boolean
  readonly chunk_length_s?: number
  readonly stride_length_s?: number
  readonly language?: string
}

function isWhisperTranscriber(value: unknown): value is WhisperTranscriber {
  return typeof value === 'function'
}

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
  pipeline: (task: string, model: string, options?: WhisperTranscriberOptions) => Promise<unknown>
}

const MODEL_IDLE_TIMEOUT = VOICE_TIMEOUT.MODEL_IDLE_MS
const VOICE_MODELS: readonly VoiceModel[] = [VOICE_MODEL_TINY, VOICE_MODEL_BASE]

const transcriberPromises: Partial<Record<VoiceModel, Promise<WhisperTranscriber>>> = {}
const lastUsedAt: Partial<Record<VoiceModel, number>> = {}
const evictionTimers: Partial<Record<VoiceModel, ReturnType<typeof setTimeout>>> = {}

function isTransformersModule(value: unknown): value is TransformersModule {
  if (typeof value !== 'object' || value === null) return false
  if (!('pipeline' in value) || typeof value.pipeline !== 'function') return false
  if (!('env' in value) || typeof value.env !== 'object' || value.env === null) return false
  return true
}

function pcm16BytesToFloat32(bytes: Uint8Array): Float32Array {
  const sampleCount = Math.floor(bytes.byteLength / DOUBLE_FACTOR)
  const normalized = new Float32Array(sampleCount)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  for (let index = 0; index < sampleCount; index += 1) {
    const value = view.getInt16(index * DOUBLE_FACTOR, true)
    normalized[index] = Math.max(-1, Math.min(1, value / PCM16_SIGNED_NORMALIZATION_FACTOR))
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

function mapLoadError(error: unknown, model: VoiceModel): string {
  const message = error instanceof Error ? error.message : 'Unknown model load error.'
  const label = model === VOICE_MODEL_BASE ? 'base' : 'tiny'
  if (
    /sharp/i.test(message) &&
    /(cannot find module|went wrong installing|sharp-darwin|sharp-linux|sharp-win32)/i.test(message)
  ) {
    return 'Local voice dependency is missing (sharp). Run `pnpm install` or `pnpm rebuild sharp`, then restart OpenWaggle.'
  }
  if (/(network|fetch|download|ENOTFOUND|ECONN|timed out)/i.test(message)) {
    return `Local Whisper ${label} model is not available yet. Connect once to download it, then retry.`
  }
  return `Unable to load local Whisper ${label} model. Verify local dependencies and retry.`
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
    if (!isWhisperTranscriber(transcriber)) {
      throw new Error('Whisper transcriber could not be created.')
    }
    return transcriber
  })().catch((error) => {
    delete transcriberPromises[model]
    throw error
  })

  transcriberPromises[model] = transcriberPromise
  return transcriberPromise
}

function scheduleEviction(model: VoiceModel): void {
  const existingTimer = evictionTimers[model]
  if (existingTimer) clearTimeout(existingTimer)

  evictionTimers[model] = setTimeout(() => {
    const last = lastUsedAt[model] ?? 0
    if (Date.now() - last >= MODEL_IDLE_TIMEOUT) {
      delete transcriberPromises[model]
      delete lastUsedAt[model]
      delete evictionTimers[model]
    }
  }, MODEL_IDLE_TIMEOUT)
}

function markModelUsed(model: VoiceModel): void {
  lastUsedAt[model] = Date.now()
  scheduleEviction(model)
}

export function resetVoiceHandlerForTests(): void {
  for (const model of VOICE_MODELS) {
    delete transcriberPromises[model]
    delete lastUsedAt[model]
    const timer = evictionTimers[model]
    if (timer) clearTimeout(timer)
    delete evictionTimers[model]
  }
}

export function registerVoiceHandlers(): void {
  typedHandle('voice:transcribe-local', (_event, rawPayload: unknown) =>
    Effect.gen(function* () {
      const payload = decodeUnknownOrThrow(transcribePayloadSchema, rawPayload)
      const model = payload.model ?? VOICE_MODEL_BASE
      const sampleCount = Math.floor(payload.pcm16.byteLength / DOUBLE_FACTOR)
      if (sampleCount <= 0) {
        return yield* Effect.fail(new Error('Audio payload is empty.'))
      }
      const maxSampleCount = payload.sampleRate * AUDIO_RECORDING.MAX_SECONDS
      if (sampleCount > maxSampleCount) {
        return yield* Effect.fail(
          new Error(
            `Audio exceeds ${String(AUDIO_RECORDING.MAX_SECONDS)} seconds; record a shorter clip.`,
          ),
        )
      }
      const audio = pcm16BytesToFloat32(payload.pcm16)

      const transcriber = yield* Effect.tryPromise({
        try: () => loadTranscriber(model),
        catch: (error) => new Error(mapLoadError(error, model)),
      })

      const modelConfig = VOICE_MODEL_CONFIG[model]
      const rawResult = yield* Effect.tryPromise({
        try: () =>
          transcriber(audio, {
            task: 'transcribe',
            return_timestamps: false,
            chunk_length_s: AUDIO_RECORDING.CHUNK_LENGTH_S,
            stride_length_s: AUDIO_RECORDING.STRIDE_LENGTH_S,
            language: payload.language ?? modelConfig.language,
          }),
        catch: (error) => new Error(mapTranscriptionError(error)),
      })
      markModelUsed(model)
      const text = extractTranscriptionText(rawResult)
      const response: VoiceTranscriptionResult = { text, model }
      return response
    }),
  )
}
