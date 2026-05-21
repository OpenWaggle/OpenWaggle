import { Loader2, Mic } from 'lucide-react'
import { cn } from '@/shared/lib/cn'
import { Button } from '@/shared/ui/Button'
import type { VoiceRecorderMode } from '../hooks/useVoiceCapture'

interface ComposerVoiceButtonProps {
  readonly mode: VoiceRecorderMode
  readonly onToggleVoice: () => void
}

export function ComposerVoiceButton({ mode, onToggleVoice }: ComposerVoiceButtonProps) {
  const isListening = mode === 'recording'
  const isTranscribing = mode === 'transcribing'

  return (
    <Button
      variant="unstyled"
      type="button"
      onClick={onToggleVoice}
      disabled={isTranscribing}
      className={cn(
        'flex h-5 w-5 items-center justify-center transition-colors',
        getVoiceButtonTone(isTranscribing, isListening),
      )}
      title={getVoiceButtonTitle(mode)}
    >
      {isTranscribing ? (
        <Loader2 className="h-[15px] w-[15px] animate-spin" />
      ) : (
        <Mic className="h-[15px] w-[15px]" />
      )}
    </Button>
  )
}

function getVoiceButtonTone(isTranscribing: boolean, isListening: boolean) {
  if (isTranscribing) return 'cursor-not-allowed text-text-tertiary'
  return isListening ? 'text-accent' : 'text-text-secondary hover:text-text-primary'
}

function getVoiceButtonTitle(mode: VoiceRecorderMode) {
  if (mode === 'transcribing') return 'Transcribing audio'
  return mode === 'recording' ? 'Stop voice input' : 'Start voice input'
}
