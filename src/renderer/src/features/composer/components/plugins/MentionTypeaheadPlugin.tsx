import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { useProject } from '@/features/sessions/hooks'
import { useMentionDetection } from '../../hooks/useMentionDetection'
import { useMentionKeyboard } from '../../hooks/useMentionKeyboard'
import { useMentionSelection } from '../../hooks/useMentionSelection'
import { useMentionSuggestions } from '../../hooks/useMentionSuggestions'
import { MentionTypeaheadDropdown } from '../mentions/MentionTypeaheadDropdown'

export function MentionTypeaheadPlugin() {
  const [editor] = useLexicalComposerContext()
  const { projectPath } = useProject()
  const detection = useMentionDetection(editor)
  const suggestionState = useMentionSuggestions({
    projectPath,
    query: detection.match?.query ?? null,
  })
  const isOpen = detection.match !== null && suggestionState.suggestions.length > 0

  function handleClose() {
    detection.clearMatch()
    suggestionState.clearSuggestions()
  }

  const handleSelectMention = useMentionSelection({
    editor,
    match: detection.match,
    onClose: handleClose,
  })

  useMentionKeyboard({
    editor,
    isOpen,
    suggestions: suggestionState.suggestions,
    highlightIndex: suggestionState.highlightIndex,
    setHighlightIndex: suggestionState.setHighlightIndex,
    onSelect: handleSelectMention,
    onClose: handleClose,
  })

  if (!isOpen) return null

  return (
    <MentionTypeaheadDropdown
      items={suggestionState.suggestions}
      highlightIndex={suggestionState.highlightIndex}
      position={detection.position}
      onSelect={handleSelectMention}
      onClose={handleClose}
    />
  )
}
