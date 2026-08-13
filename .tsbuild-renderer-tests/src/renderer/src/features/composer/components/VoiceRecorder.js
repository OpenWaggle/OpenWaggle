import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { ArrowUp, Loader2, Square } from 'lucide-react';
import { VoiceVisualizer } from 'react-voice-visualizer';
import { cn } from '@/shared/lib/cn';
import { Button } from '@/shared/ui/Button';
import { formatVoiceDuration } from '../hooks/useVoiceCapture';
import { ComposerAttachButton } from './ComposerAttachButton';
const INLINE_WAVEFORM_BAR_GAP_PX = 1;
const INLINE_WAVEFORM_BAR_WIDTH_PX = 2;
const INLINE_WAVEFORM_HEIGHT_PX = 40;
const INLINE_WAVEFORM_BAR_RADIUS_PX = 5;
const VISUALIZER_SPEED = 3;
export function VoiceRecorder({ fileInputRef, voice }) {
    return (_jsx("div", { className: "flex h-11 items-center justify-between px-4", children: _jsxs("div", { className: "flex size-full items-center gap-3", children: [_jsx(ComposerAttachButton, { fileInputRef: fileInputRef }), _jsxs("div", { className: "flex min-w-0 flex-1 items-center gap-2.5 overflow-hidden", children: [_jsx("div", { className: "relative flex h-9 flex-1 items-center overflow-hidden", children: _jsx(VoiceVisualizer, { ...buildInlineVisualizerProps(voice.visualizerControls) }) }), _jsx("span", { className: "w-10 text-right text-[12px] tabular-nums text-text-tertiary", children: formatVoiceDuration(voice.elapsedSeconds) })] }), voice.mode === 'recording' ? (_jsx(Button, { variant: "unstyled", type: "button", onClick: voice.stopCapture, className: "flex size-8 shrink-0 items-center justify-center rounded-full border border-border bg-bg-tertiary text-text-primary transition-colors hover:bg-bg-hover", title: "Stop recording", children: _jsx(Square, { className: "size-3.5" }) })) : (_jsx("div", { className: "flex size-8 shrink-0 items-center justify-center rounded-full border border-border bg-bg-tertiary text-text-tertiary", children: _jsx(Loader2, { className: "size-3.5 animate-spin" }) })), _jsx(Button, { variant: "unstyled", type: "button", onClick: voice.stopAndSend, disabled: voice.mode === 'transcribing', className: cn('flex size-8 shrink-0 items-center justify-center rounded-full transition-colors', voice.mode === 'transcribing'
                        ? 'cursor-not-allowed border border-border bg-bg-tertiary'
                        : 'bg-text-primary text-bg hover:bg-text-primary/90'), title: "Send recording", children: _jsx(ArrowUp, { className: cn('size-4', voice.mode === 'transcribing' ? 'text-text-muted' : 'text-bg') }) })] }) }));
}
function buildInlineVisualizerProps(controls) {
    return {
        animateCurrentPick: true,
        backgroundColor: 'transparent',
        barWidth: INLINE_WAVEFORM_BAR_WIDTH_PX,
        canvasContainerClassName: '!m-0 !h-full !w-full !overflow-visible !bg-transparent !border-0 !rounded-none !p-0',
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
    };
}
