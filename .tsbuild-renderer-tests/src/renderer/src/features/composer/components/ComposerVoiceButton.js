import { jsx as _jsx } from "react/jsx-runtime";
import { Loader2, Mic } from 'lucide-react';
import { cn } from '@/shared/lib/cn';
import { Button } from '@/shared/ui/Button';
export function ComposerVoiceButton({ mode, onToggleVoice }) {
    const isListening = mode === 'recording';
    const isTranscribing = mode === 'transcribing';
    return (_jsx(Button, { variant: "unstyled", type: "button", onClick: onToggleVoice, disabled: isTranscribing, className: cn('flex size-5 items-center justify-center transition-colors', getVoiceButtonTone(isTranscribing, isListening)), title: getVoiceButtonTitle(mode), children: isTranscribing ? (_jsx(Loader2, { className: "size-[15px] animate-spin" })) : (_jsx(Mic, { className: "size-[15px]" })) }));
}
function getVoiceButtonTone(isTranscribing, isListening) {
    if (isTranscribing)
        return 'cursor-not-allowed text-text-tertiary';
    return isListening ? 'text-accent' : 'text-text-secondary hover:text-text-primary';
}
function getVoiceButtonTitle(mode) {
    if (mode === 'transcribing')
        return 'Transcribing audio';
    return mode === 'recording' ? 'Stop voice input' : 'Start voice input';
}
