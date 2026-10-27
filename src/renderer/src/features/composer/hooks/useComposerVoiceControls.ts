import type { LexicalEditor } from 'lexical'
import type { RefObject } from 'react'
import { useStableHotkey } from '@/shared/hooks/useStableHotkey'
import { insertTextAtEditorOrStore } from '../lib/composer-editor-text'
import { useComposerStore } from '../state/composer-store'
import { useVoiceCapture } from './useVoiceCapture'

interface UseComposerVoiceControlsInput {
  readonly disabled?: boolean
  readonly editorRef: RefObject<LexicalEditor | null>
  readonly sendComposed: (text: string) => boolean | Promise<boolean>
  readonly submitCurrentDraft: () => void
  /** Stop-and-send inserts the transcript and calls this instead of sending (a queued-message edit). */
  readonly sendAfterInsert?: (() => void) | null
}

export function useComposerVoiceControls({
  disabled,
  editorRef,
  sendComposed,
  submitCurrentDraft,
  sendAfterInsert = null,
}: UseComposerVoiceControlsInput) {
  const setInput = useComposerStore((s) => s.setInput)
  const voice = useVoiceCapture({
    disabled,
    insertText: (text) => insertTextAtEditorOrStore(editorRef.current, text, setInput),
    sendComposed,
    sendAfterInsert,
  })

  // The hotkey reads the latest callback, so it always sees the latest state. A plain function is
  // correct here; useEffectEvent would violate its "only call from Effects in the same component"
  // contract by being passed as a value (react-doctor/rules-of-hooks).
  function handleVoiceEnter() {
    if (disabled) return
    if (voice.mode === 'transcribing') return
    if (voice.mode === 'recording') {
      voice.stopCapture()
      return
    }
    submitCurrentDraft()
  }

  useStableHotkey('Enter', handleVoiceEnter, {
    enabled: voice.isActive && !disabled,
    preventDefault: true,
    stopPropagation: true,
    ignoreInputs: false,
    conflictBehavior: 'allow',
  })

  return voice
}
