import type { SchemaType } from '@shared/schema'
import type { voiceTranscriptionRequestSchema } from '@shared/schemas/voice'

export const VOICE_MODEL_TINY = 'tiny' as const
export const VOICE_MODEL_BASE = 'base' as const

export type VoiceModel = typeof VOICE_MODEL_TINY | typeof VOICE_MODEL_BASE

export type VoiceTranscriptionRequest = SchemaType<typeof voiceTranscriptionRequestSchema>

export interface VoiceTranscriptionResult {
  text: string
  model: VoiceModel
}
