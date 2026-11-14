/** The `voice:transcribe-local` request: the one source of `VoiceTranscriptionRequest`. */
import { AUDIO_RECORDING, AUDIO_SAMPLE_RATE, LANGUAGE_CODE } from '@shared/constants/audio-config'
import { Schema } from '@shared/schema'
import { VOICE_MODEL_BASE, VOICE_MODEL_TINY } from '@shared/types/voice'

export const voiceTranscriptionRequestSchema = Schema.Struct({
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
  language: Schema.optionalWith(
    Schema.String.pipe(
      Schema.trimmed(),
      Schema.minLength(LANGUAGE_CODE.MIN_LENGTH),
      Schema.maxLength(LANGUAGE_CODE.MAX_LENGTH),
    ),
    { exact: true },
  ),
  model: Schema.optionalWith(Schema.Literal(VOICE_MODEL_TINY, VOICE_MODEL_BASE), { exact: true }),
})
