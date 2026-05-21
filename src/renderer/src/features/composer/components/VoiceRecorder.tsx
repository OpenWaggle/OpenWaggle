import { ArrowUp, Loader2, Square } from 'lucide-react'
import type { RefObject } from 'react'
import { VoiceVisualizer } from 'react-voice-visualizer'
import { cn } from '@/shared/lib/cn'
import { Button } from '@/shared/ui/Button'
import type { VoiceCaptureController } from '../hooks/useVoiceCapture'
import { formatVoiceDuration } from '../hooks/useVoiceCapture'
import { ComposerAttachButton } from './ComposerAttachButton'

const INLINE_WAVEFORM_BAR_GAP_PX = 1
const INLINE_WAVEFORM_BAR_WIDTH_PX = 2
const INLINE_WAVEFORM_HEIGHT_PX = 40
const INLINE_WAVEFORM_BAR_RADIUS_PX = 5
const VISUALIZER_SPEED = 3

interface VoiceRecorderProps {
  fileInputRef: RefObject<HTMLInputElement | null>
  voice: VoiceCaptureController
}

export function VoiceRecorder({ fileInputRef, voice }: VoiceRecorderProps) {
  return (
    <div className="flex h-11 items-center justify-between px-4">
      <div className="flex size-full items-center gap-3">
        <ComposerAttachButton fileInputRef={fileInputRef} />

        <div className="flex min-w-0 flex-1 items-center gap-2.5 overflow-hidden">
          <div className="relative flex h-9 flex-1 items-center overflow-hidden">
            <VoiceVisualizer {...buildInlineVisualizerProps(voice.visualizerControls)} />
          </div>

          <span className="w-10 text-right text-[12px] tabular-nums text-text-tertiary">
            {formatVoiceDuration(voice.elapsedSeconds)}
          </span>
        </div>

        {voice.mode === 'recording' ? (
          <Button
            variant="unstyled"
            type="button"
            onClick={voice.stopCapture}
            className="flex size-8 shrink-0 items-center justify-center rounded-full border border-border bg-bg-tertiary text-text-primary transition-colors hover:bg-bg-hover"
            title="Stop recording"
          >
            <Square className="size-3.5" />
          </Button>
        ) : (
          <div className="flex size-8 shrink-0 items-center justify-center rounded-full border border-border bg-bg-tertiary text-text-tertiary">
            <Loader2 className="size-3.5 animate-spin" />
          </div>
        )}

        <Button
          variant="unstyled"
          type="button"
          onClick={voice.stopAndSend}
          disabled={voice.mode === 'transcribing'}
          className={cn(
            'flex size-8 shrink-0 items-center justify-center rounded-full transition-colors',
            voice.mode === 'transcribing'
              ? 'cursor-not-allowed border border-border bg-bg-tertiary'
              : 'bg-text-primary text-bg hover:bg-text-primary/90',
          )}
          title="Send recording"
        >
          <ArrowUp
            className={cn('size-4', voice.mode === 'transcribing' ? 'text-text-muted' : 'text-bg')}
          />
        </Button>
      </div>
    </div>
  )
}

function buildInlineVisualizerProps(controls: VoiceCaptureController['visualizerControls']) {
  return {
    animateCurrentPick: true,
    backgroundColor: 'transparent',
    barWidth: INLINE_WAVEFORM_BAR_WIDTH_PX,
    canvasContainerClassName:
      '!m-0 !h-full !w-full !overflow-visible !bg-transparent !border-0 !rounded-none !p-0',
    controls,
    fullscreen: true,
    gap: INLINE_WAVEFORM_BAR_GAP_PX,
    height: INLINE_WAVEFORM_HEIGHT_PX,
    isAudioProcessingTextShown: false,
    isControlPanelShown: false,
    isDefaultUIShown: false,
    isDownloadAudioButtonShown: false,
    isProgressIndicatorOnHoverShown: false,
    isProgressIndicatorShown: false,
    isProgressIndicatorTimeOnHoverShown: false,
    isProgressIndicatorTimeShown: false,
    mainBarColor: '#FFFFFF',
    mainContainerClassName: '!m-0 !h-full !w-full !bg-transparent !border-0 !p-0 !shadow-none',
    onlyRecording: false,
    rounded: INLINE_WAVEFORM_BAR_RADIUS_PX,
    secondaryBarColor: '#5e5e5e',
    speed: VISUALIZER_SPEED,
    width: '100%',
  }
}
