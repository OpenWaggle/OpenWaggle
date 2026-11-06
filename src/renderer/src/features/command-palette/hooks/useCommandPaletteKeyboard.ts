import { match } from '@diegogbrisa/ts-match'
import { $getRoot, COMMAND_PRIORITY_HIGH, KEY_DOWN_COMMAND, type LexicalEditor } from 'lexical'
import { type RefObject, useEffectEvent, useLayoutEffect } from 'react'
import { isGuiOnlyComposerCommand } from '@/features/composer/commands'
import { nextEnabledCommandIndex } from '../lib/command-palette-navigation'
import type { CommandPaletteItem } from '../model'

interface UseCommandPaletteKeyboardInput {
  readonly editor: LexicalEditor | null
  readonly items: readonly CommandPaletteItem[]
  readonly highlightIndex: number
  readonly setHighlightIndex: (index: number) => void
  readonly listRef: RefObject<HTMLDivElement | null>
  readonly onClose: () => void
}

export function useCommandPaletteKeyboard({
  editor,
  items,
  highlightIndex,
  setHighlightIndex,
  listRef,
  onClose,
}: UseCommandPaletteKeyboardInput) {
  function scrollHighlightedIntoView() {
    requestAnimationFrame(() => {
      const highlighted = listRef.current?.querySelector('[data-highlighted="true"]')
      highlighted?.scrollIntoView({ block: 'nearest' })
    })
  }

  /**
   * A built-in command submits on Enter only when it is the whole draft; otherwise the draft would
   * be sent to the model as an ordinary prompt that merely mentions the command.
   */
  function submitsDraftAsCommand(item: CommandPaletteItem) {
    if (!item.submitsOnEnter || !editor) return false
    return isGuiOnlyComposerCommand(editor.getEditorState().read(() => $getRoot().getTextContent()))
  }

  function moveHighlight(delta: 1 | -1) {
    if (items.length === 0) return
    setHighlightIndex(nextEnabledCommandIndex(items, highlightIndex, delta))
    scrollHighlightedIntoView()
  }

  const handleKeyDown = useEffectEvent((event: KeyboardEvent) => {
    match(event.key)
      .with('ArrowDown', () => {
        event.preventDefault()
        moveHighlight(1)
      })
      .with('ArrowUp', () => {
        event.preventDefault()
        moveHighlight(-1)
      })
      .with('Enter', () => {
        const selectedItem = items[highlightIndex]
        if (!selectedItem || selectedItem.disabled || submitsDraftAsCommand(selectedItem)) return
        event.preventDefault()
        selectedItem.action()
      })
      .with('Tab', () => {
        const selectedItem = items[highlightIndex]
        if (!selectedItem || selectedItem.disabled) return
        event.preventDefault()
        selectedItem.action()
      })
      .with('Escape', () => {
        event.preventDefault()
        onClose()
      })
      .otherwise(() => undefined)
    return event.defaultPrevented
  })

  useLayoutEffect(() => {
    if (!editor) return
    return editor.registerCommand<KeyboardEvent>(
      KEY_DOWN_COMMAND,
      (event) => handleKeyDown(event),
      COMMAND_PRIORITY_HIGH,
    )
  }, [editor])
}
