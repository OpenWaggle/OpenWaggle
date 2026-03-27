import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import type { FileSuggestion } from '@shared/types/composer'
import {
  $createTextNode,
  $getSelection,
  $isRangeSelection,
  $isTextNode,
  COMMAND_PRIORITY_HIGH,
  KEY_DOWN_COMMAND,
} from 'lexical'
import { useDeferredValue, useEffect, useEffectEvent, useRef, useState } from 'react'
import { useProject } from '@/hooks/useProject'
import { api } from '@/lib/ipc'
import { createRendererLogger } from '@/lib/logger'
import { MentionTypeaheadDropdown } from '../mentions/MentionTypeaheadDropdown'
import { $createFileMentionNode } from '../nodes/FileMentionNode'

const DROPDOWN_GAP_PX = 4
const logger = createRendererLogger('mention-typeahead')

interface MentionMatch {
  query: string
  startOffset: number
}

export function MentionTypeaheadPlugin(): React.ReactNode {
  const [editor] = useLexicalComposerContext()
  const { projectPath } = useProject()

  const [match, setMatch] = useState<MentionMatch | null>(null)
  const [suggestions, setSuggestions] = useState<FileSuggestion[]>([])
  const [highlightIndex, setHighlightIndex] = useState(0)
  const [position, setPosition] = useState({ top: 0, left: 0 })

  const deferredQuery = useDeferredValue(match?.query ?? null)
  const queryVersionRef = useRef(0)
  const isOpen = match !== null && suggestions.length > 0

  // Detect @ trigger on every editor update
  useEffect(() => {
    return editor.registerUpdateListener(({ editorState }) => {
      editorState.read(() => {
        const selection = $getSelection()
        if (!$isRangeSelection(selection) || !selection.isCollapsed()) {
          setMatch(null)
          return
        }

        const anchor = selection.anchor
        const anchorNode = anchor.getNode()

        if (!$isTextNode(anchorNode)) {
          setMatch(null)
          return
        }

        const textContent = anchorNode.getTextContent()
        const offset = anchor.offset
        const textBeforeCursor = textContent.slice(0, offset)

        const atIndex = textBeforeCursor.lastIndexOf('@')

        if (atIndex === -1) {
          setMatch(null)
          return
        }

        // Ensure @ is at start or after whitespace
        if (atIndex > 0 && !/\s/.test(textBeforeCursor[atIndex - 1])) {
          setMatch(null)
          return
        }

        const query = textBeforeCursor.slice(atIndex + 1)

        // No spaces in the query (if space found, the mention is "closed")
        if (/\s/.test(query)) {
          setMatch(null)
          return
        }

        // Trigger on bare @ (query.length === 0) or with any query text
        setMatch({ query, startOffset: atIndex })
      })

      // Update dropdown position — place ABOVE the @ character
      requestAnimationFrame(() => {
        const windowSelection = window.getSelection()
        if (windowSelection && windowSelection.rangeCount > 0) {
          const range = windowSelection.getRangeAt(0)
          if (typeof range.getBoundingClientRect !== 'function') return
          const rect = range.getBoundingClientRect()
          if (rect.top > 0) {
            setPosition({ top: rect.top - DROPDOWN_GAP_PX, left: rect.left })
          }
        }
      })
    })
  }, [editor])

  // Fetch suggestions when deferred query changes
  useEffect(() => {
    if (deferredQuery === null || !projectPath) {
      setSuggestions([])
      return
    }

    if (typeof api.suggestFiles !== 'function') {
      setSuggestions([])
      return
    }

    queryVersionRef.current += 1
    const version = queryVersionRef.current

    void api
      .suggestFiles(projectPath, deferredQuery)
      .then((results) => {
        // Ignore stale responses from earlier queries
        if (version !== queryVersionRef.current) return
        setSuggestions(results)
        setHighlightIndex(0)
      })
      .catch((error: unknown) => {
        if (version !== queryVersionRef.current) return
        logger.warn('File suggestion failed', {
          error: error instanceof Error ? error.message : String(error),
        })
        setSuggestions([])
      })
  }, [deferredQuery, projectPath])

  const handleSelectMention = useEffectEvent((item: FileSuggestion) => {
    editor.update(() => {
      const selection = $getSelection()
      if (!$isRangeSelection(selection) || !match) return

      const anchor = selection.anchor
      const anchorNode = anchor.getNode()

      if (!$isTextNode(anchorNode)) return

      const textContent = anchorNode.getTextContent()

      const beforeAt = textContent.slice(0, match.startOffset)
      const afterQuery = textContent.slice(match.startOffset + 1 + match.query.length)

      anchorNode.setTextContent(beforeAt)

      const mentionNode = $createFileMentionNode(item.path, item.basename)
      const trailingText = $createTextNode(`${afterQuery} `)

      anchorNode.insertAfter(mentionNode)
      mentionNode.insertAfter(trailingText)
      trailingText.select()
    })

    setMatch(null)
    setSuggestions([])
    editor.focus()
  })

  // Keyboard navigation when dropdown is open
  useEffect(() => {
    if (!isOpen) return

    return editor.registerCommand<KeyboardEvent>(
      KEY_DOWN_COMMAND,
      (event) => {
        if (event.key === 'ArrowDown') {
          event.preventDefault()
          setHighlightIndex((prev) => (prev + 1) % suggestions.length)
          return true
        }
        if (event.key === 'ArrowUp') {
          event.preventDefault()
          setHighlightIndex((prev) => (prev - 1 + suggestions.length) % suggestions.length)
          return true
        }
        if (event.key === 'Enter' || event.key === 'Tab') {
          event.preventDefault()
          const selected = suggestions[highlightIndex]
          if (selected) {
            handleSelectMention(selected)
          }
          return true
        }
        if (event.key === 'Escape') {
          event.preventDefault()
          setMatch(null)
          setSuggestions([])
          return true
        }
        return false
      },
      COMMAND_PRIORITY_HIGH,
    )
  }, [editor, isOpen, suggestions, highlightIndex])

  function handleClose(): void {
    setMatch(null)
    setSuggestions([])
  }

  if (!isOpen) return null

  return (
    <MentionTypeaheadDropdown
      items={suggestions}
      highlightIndex={highlightIndex}
      position={position}
      onSelect={handleSelectMention}
      onClose={handleClose}
    />
  )
}
