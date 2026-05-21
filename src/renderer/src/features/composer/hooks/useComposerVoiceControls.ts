import { useHotkey } from '@tanstack/react-hotkeys'
import type { LexicalEditor } from 'lexical'
import type { RefObject } from 'react'
import { useEffectEvent } from 'react'
import { insertTextAtEditorOrStore } from '../lib/composer-editor-text'
import { useComposerStore } from '../state/composer-store'
import { useVoiceCapture } from './useVoiceCapture'

interface UseComposerVoiceControlsInput {
  readonly editorRef: RefObject<LexicalEditor | null>
  readonly sendComposed: (text: string) => boolean
  readonly submitCurrentDraft: () => void
}

export function useComposerVoiceControls({
  editorRef,
  sendComposed,
  submitCurrentDraft,
}: UseComposerVoiceControlsInput) {
  const setInput = useComposerStore((s) => s.setInput)
  const voice = useVoiceCapture({
    insertText: (text) => insertTextAtEditorOrStore(editorRef.current, text, setInput),
    sendComposed,
  })

  const handleVoiceEnter = useEffectEvent(() => {
    if (voice.mode === 'transcribing') return
    if (voice.mode === 'recording') {
      voice.stopCapture()
      return
    }
    submitCurrentDraft()
  })

  useHotkey('Enter', handleVoiceEnter, {
    enabled: voice.isActive,
    preventDefault: true,
    ignoreInputs: false,
    conflictBehavior: 'allow',
  })

  return voice
}
