import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { VOICE_MODEL_BASE, type VoiceTranscriptionResult } from '@shared/types/voice'
import { app, ipcMain } from 'electron'
import { z } from 'zod'

const SAMPLE_RATE_MIN = 8_000
const SAMPLE_RATE_MAX = 48_000
const MAX_AUDIO_SECONDS = 90
const MAX_SAMPLE_COUNT = SAMPLE_RATE_MAX * MAX_AUDIO_SECONDS
const WHISPER_BASE_MODEL_ID = 'Xenova/whisper-base'

const transcribePayloadSchema = z.object({
  samples: z.array(z.number().finite()).min(1).max(MAX_SAMPLE_COUNT),
  sampleRate: z.number().int().min(SAMPLE_RATE_MIN).max(SAMPLE_RATE_MAX),
  language: z.string().trim().min(2).max(16).optional(),
  model: z.literal(VOICE_MODEL_BASE).optional(),
})

type WhisperTranscriber = (
  audio: Float32Array,
  options?: Record<string, unknown>,
) => Promise<unknown>

interface TransformersEnv {
  allowLocalModels?: boolean
  allowRemoteModels?: boolean
  cacheDir?: string
}

interface TransformersModule {
  env: TransformersEnv
  pipeline: (task: string, model: string, options?: Record<string, unknown>) => Promise<unknown>
}

let transcriberPromise: Promise<WhisperTranscriber> | null = null

function isTransformersModule(value: unknown): value is TransformersModule {
  if (typeof value !== 'object' || value === null) return false
  if (!('pipeline' in value) || typeof value.pipeline !== 'function') return false
  if (!('env' in value) || typeof value.env !== 'object' || value.env === null) return false
  return true
}

function normalizeSamples(samples: number[]): Float32Array {
  const normalized = new Float32Array(samples.length)
  for (let index = 0; index < samples.length; index += 1) {
    const value = samples[index]
    normalized[index] = Math.max(-1, Math.min(1, value))
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
  if (/(network|fetch|download|ENOTFOUND|ECONN|timed out)/i.test(message)) {
    return 'Local Whisper base model is not available yet. Connect once to download it, then retry.'
  }
  return `Unable to load local Whisper base model: ${message}`
}

function mapTranscriptionError(error: unknown): string {
  const message = error instanceof Error ? error.message : 'Unknown transcription error.'
  return `Local voice transcription failed: ${message}`
}

async function loadWhisperBaseTranscriber(): Promise<WhisperTranscriber> {
  if (transcriberPromise) return transcriberPromise

  transcriberPromise = (async () => {
    const imported: unknown = await import('@xenova/transformers')
    if (!isTransformersModule(imported)) {
      throw new Error('Transformers runtime is unavailable.')
    }

    const cacheDir = path.join(app.getPath('userData'), 'models', 'transformers')
    await mkdir(cacheDir, { recursive: true })

    imported.env.allowLocalModels = true
    imported.env.allowRemoteModels = true
    imported.env.cacheDir = cacheDir

    const transcriber = await imported.pipeline(
      'automatic-speech-recognition',
      WHISPER_BASE_MODEL_ID,
      { quantized: false },
    )
    if (typeof transcriber !== 'function') {
      throw new Error('Whisper transcriber could not be created.')
    }
    return transcriber as WhisperTranscriber
  })().catch((error) => {
    transcriberPromise = null
    throw error
  })

  return transcriberPromise
}

export function resetVoiceHandlerForTests(): void {
  transcriberPromise = null
}

export function registerVoiceHandlers(): void {
  ipcMain.handle('voice:transcribe-local', async (_event, rawPayload: unknown) => {
    const payload = transcribePayloadSchema.parse(rawPayload)
    const model = payload.model ?? VOICE_MODEL_BASE
    const audio = normalizeSamples(payload.samples)

    let transcriber: WhisperTranscriber
    try {
      transcriber = await loadWhisperBaseTranscriber()
    } catch (error) {
      throw new Error(mapLoadError(error))
    }

    try {
      const rawResult = await transcriber(audio, {
        task: 'transcribe',
        return_timestamps: false,
        chunk_length_s: 20,
        stride_length_s: 4,
        language: payload.language,
      })
      const text = extractTranscriptionText(rawResult)
      const response: VoiceTranscriptionResult = { text, model }
      return response
    } catch (error) {
      throw new Error(mapTranscriptionError(error))
    }
  })
}
