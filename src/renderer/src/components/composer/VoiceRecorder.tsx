import { SECONDS_PER_MINUTE } from '@shared/constants/constants'
import { ArrowUp, Loader2, Plus, Square } from 'lucide-react'
import type { RefObject } from 'react'
import { cn } from '@/lib/cn'
import { useComposerStore } from '@/stores/composer-store'

const PAD_START_ARG_1 = 2
const MAX_ARG_1 = 4
const FUNCTION_VALUE_28 = 28
const MAX_ARG_1_VALUE_0_35 = 0.35

function formatVoiceDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds))
  const minutesPart = Math.floor(seconds / SECONDS_PER_MINUTE)
  const secondsPart = seconds % SECONDS_PER_MINUTE
  return `${String(minutesPart)}:${String(secondsPart).padStart(PAD_START_ARG_1, '0')}`
}

interface VoiceRecorderProps {
  onSendVoice: () => void
  mediaRecorderRef: RefObject<MediaRecorder | null>
}

export function VoiceRecorder({
  onSendVoice,
  mediaRecorderRef,
}: VoiceRecorderProps): React.JSX.Element {
  const isListening = useComposerStore((s) => s.isListening)
  const isTranscribingVoice = useComposerStore((s) => s.isTranscribingVoice)
  const voiceElapsedSeconds = useComposerStore((s) => s.voiceElapsedSeconds)
  const voiceWaveform = useComposerStore((s) => s.voiceWaveform)

  return (
    <div className="h-[60px] px-4 py-[12px]">
      <div className="flex h-full items-center gap-3 rounded-lg border border-border bg-bg px-2.5">
        <button
          type="button"
          className="flex items-center justify-center h-6 w-6 text-text-tertiary/90 transition-colors hover:text-text-primary"
          title="Attach files"
          disabled
        >
          <Plus className="h-3.5 w-3.5" />
        </button>

        <div className="flex min-w-0 flex-1 items-center gap-3">
          <div className="relative flex h-8 flex-1 items-center gap-[2px] overflow-hidden">
            <div className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 border-t border-dashed border-text-tertiary/55" />
            {isListening ? (
              voiceWaveform.map((level, index) => (
                <span
                  key={`voice-wave-${String(index)}`}
                  className="relative z-10 inline-flex h-full items-center"
                >
                  <span
                    className="w-[3px] rounded-[2px] bg-text-primary/95"
                    style={{
                      height: `${String(Math.max(MAX_ARG_1, Math.round(level * FUNCTION_VALUE_28)))}px`,
                      opacity: Math.max(MAX_ARG_1_VALUE_0_35, level),
                      transition: 'height 800ms ease, opacity 800ms ease',
                    }}
                  />
                </span>
              ))
            ) : (
              <div className="relative z-10 flex items-center gap-2 text-[12px] text-text-secondary">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                <span>Transcribing locally...</span>
              </div>
            )}
          </div>
          <span className="w-10 text-right text-[12px] tabular-nums text-text-tertiary">
            {isListening ? formatVoiceDuration(voiceElapsedSeconds) : '...'}
          </span>
        </div>

        {isListening ? (
          <button
            type="button"
            onClick={() => mediaRecorderRef.current?.stop()}
            className="flex h-8 w-8 items-center justify-center rounded-full border border-border bg-bg-tertiary text-text-primary transition-colors hover:bg-bg-hover"
            title="Stop recording"
          >
            <Square className="h-3.5 w-3.5" />
          </button>
        ) : (
          <div className="flex h-8 w-8 items-center justify-center rounded-full border border-border bg-bg-tertiary text-text-tertiary">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          </div>
        )}
        <button
          type="button"
          onClick={onSendVoice}
          disabled={isTranscribingVoice}
          className={cn(
            'flex h-8 w-8 items-center justify-center rounded-full transition-colors',
            isTranscribingVoice
              ? 'border border-border bg-bg-tertiary cursor-not-allowed'
              : 'bg-text-primary text-bg hover:bg-text-primary/90',
          )}
          title="Send recording"
        >
          <ArrowUp className={cn('h-4 w-4', isTranscribingVoice ? 'text-text-muted' : 'text-bg')} />
        </button>
      </div>
    </div>
  )
}
