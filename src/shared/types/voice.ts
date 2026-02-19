export const VOICE_MODEL_BASE = 'base' as const

export type VoiceModel = typeof VOICE_MODEL_BASE

export interface VoiceTranscriptionRequest {
  samples: number[]
  sampleRate: number
  language?: string
  model?: VoiceModel
}

export interface VoiceTranscriptionResult {
  text: string
  model: VoiceModel
}
