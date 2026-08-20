import type { ExtensionContributionRegistryEntry } from '@shared/types/extensions'
import { useQuery } from '@tanstack/react-query'
import { Search } from 'lucide-react'
import { type KeyboardEvent, useEffect, useRef, useState } from 'react'
import { extensionContributionsQueryOptions } from '@/queries/extensions'
import { CommandDialog } from '@/shared/ui/CommandDialog'
import { TextInput } from '@/shared/ui/TextInput'
import { useGlobalCommandActions } from '../hooks/useGlobalCommandActions'
import { useGlobalExtensionActions } from '../hooks/useGlobalExtensionActions'
import {
  createExtensionCommandItems,
  createExtensionSidePanelItems,
  resolveExtensionCommandInvocationScope,
} from '../lib/extension-command-items'
import {
  createCoreCommandItems,
  createRecentProjectItems,
  createRecentSessionItems,
} from '../lib/global-command-core-items'
import type { CommandPaletteItem } from '../model'
import { CommandPaletteList } from './CommandPaletteList'

function itemMatches(item: CommandPaletteItem, query: string) {
  const value = [item.label, item.description, item.section, item.trailing]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
  return value.includes(query.toLowerCase().trim())
}

function handlePaletteKeyDown(
  event: KeyboardEvent<HTMLInputElement>,
  input: {
    readonly close: () => void
    readonly items: readonly CommandPaletteItem[]
    readonly selectedIndex: number
    readonly setSelectedIndex: (updater: (current: number) => number) => void
  },
) {
  if (event.key === 'Escape') {
    event.preventDefault()
    input.close()
    return
  }
  if (event.key === 'ArrowDown') {
    event.preventDefault()
    if (input.items.length > 0) {
      input.setSelectedIndex((current) => Math.min(current + 1, input.items.length - 1))
    }
    return
  }
  if (event.key === 'ArrowUp') {
    event.preventDefault()
    input.setSelectedIndex((current) => Math.max(0, current - 1))
    return
  }
  if (event.key === 'Enter') {
    event.preventDefault()
    input.items[input.selectedIndex]?.action()
  }
}

export function GlobalCommandPalette() {
  const { actions, close, projectPath, sessionId, sessions, settings } = useGlobalCommandActions()
  const extensionActions = useGlobalExtensionActions({ projectPath, sessionId })
  const [query, setQuery] = useState('')
  const [highlightIndex, setHighlightIndex] = useState(0)
  const listRef = useRef<HTMLDivElement | null>(null)
  const { data: extensionContributions = null } = useQuery(
    extensionContributionsQueryOptions(projectPath ? [projectPath] : [], { sessionId }),
  )
  const extensionItems = [
    ...createExtensionSidePanelItems({
      registry: extensionContributions,
      lowerQuery: '',
      openSidePanel: extensionActions.openExtensionPanel,
    }),
    ...createExtensionCommandItems({
      registry: extensionContributions,
      lowerQuery: '',
      invokeCommand: extensionActions.invokeExtensionCommand,
      canInvokeCommand: (entry: ExtensionContributionRegistryEntry) =>
        resolveExtensionCommandInvocationScope({ entry, projectPath, sessionId }) !== null,
    }),
  ]
  const items = [
    ...createCoreCommandItems(projectPath, settings, actions),
    ...createRecentProjectItems(settings, sessions, actions),
    ...createRecentSessionItems(sessions, actions),
    ...extensionItems,
  ].filter((item) => itemMatches(item, query))
  const boundedHighlightIndex = Math.min(highlightIndex, Math.max(0, items.length - 1))

  useEffect(() => {
    void boundedHighlightIndex
    listRef.current
      ?.querySelector<HTMLElement>('[data-highlighted="true"]')
      ?.scrollIntoView({ block: 'nearest' })
  }, [boundedHighlightIndex])

  return (
    <CommandDialog
      title="Command palette"
      description="Actions, navigation, sessions, projects, and extensions"
      onClose={close}
      footer={
        <>
          <span>↑↓ navigate</span>
          <span>↵ run</span>
          <span>esc close</span>
        </>
      }
    >
      <div className="flex items-center gap-2 border-b border-border px-3">
        <Search className="size-4 shrink-0 text-text-muted" />
        <TextInput
          autoFocus
          variant="transparent"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value)
            setHighlightIndex(0)
          }}
          onKeyDown={(event) =>
            handlePaletteKeyDown(event, {
              close,
              items,
              selectedIndex: boundedHighlightIndex,
              setSelectedIndex: setHighlightIndex,
            })
          }
          placeholder="Search commands…"
          aria-label="Search commands"
          className="h-12 px-0 text-[14px]"
        />
      </div>
      <CommandPaletteList
        items={items}
        highlightIndex={boundedHighlightIndex}
        onHighlightIndexChange={setHighlightIndex}
        listRef={listRef}
      />
    </CommandDialog>
  )
}
