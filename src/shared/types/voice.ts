export const VOICE_MODEL_TINY = 'tiny' as const
export const VOICE_MODEL_BASE = 'base' as const

export type VoiceModel = typeof VOICE_MODEL_TINY | typeof VOICE_MODEL_BASE

export interface VoiceTranscriptionRequest {
  pcm16: Uint8Array
  sampleRate: number
  language?: string
  model?: VoiceModel
}

export interface VoiceTranscriptionResult {
  text: string
  model: VoiceModel
}
