import { useHotkey } from '@tanstack/react-hotkeys';
import { insertTextAtEditorOrStore } from '../lib/composer-editor-text';
import { useComposerStore } from '../state/composer-store';
import { useVoiceCapture } from './useVoiceCapture';
export function useComposerVoiceControls({ editorRef, sendComposed, submitCurrentDraft, }) {
    const setInput = useComposerStore((s) => s.setInput);
    const voice = useVoiceCapture({
        insertText: (text) => insertTextAtEditorOrStore(editorRef.current, text, setInput),
        sendComposed,
    });
    // useHotkey syncs the callback every render, so it always sees the latest
    // state. A plain function is correct here; useEffectEvent would violate its
    // "only call from Effects in the same component" contract by being passed as
    // a value (react-doctor/rules-of-hooks).
    function handleVoiceEnter() {
        if (voice.mode === 'transcribing')
            return;
        if (voice.mode === 'recording') {
            voice.stopCapture();
            return;
        }
        submitCurrentDraft();
    }
    useHotkey('Enter', handleVoiceEnter, {
        enabled: voice.isActive,
        preventDefault: true,
        ignoreInputs: false,
        conflictBehavior: 'allow',
    });
    return voice;
}
