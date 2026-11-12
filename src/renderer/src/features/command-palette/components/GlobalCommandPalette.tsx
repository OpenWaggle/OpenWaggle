import type { ExtensionContributionRegistryEntry } from '@shared/types/extensions'
import { useQuery } from '@tanstack/react-query'
import { Search } from 'lucide-react'
import { type KeyboardEvent, useState } from 'react'
import {
  extensionSidePanelSurfaces,
  openableExtensionSidePanelSurfaceIds,
} from '@/features/extensions'
import {
  createProjectActionCommandItems,
  useProjectActions,
  useRunProjectAction,
} from '@/features/project-actions'
import { useSessionProjectPath } from '@/features/sessions/hooks'
import { useRunningTerminalCounts } from '@/features/terminal'
import { extensionContributionsQueryOptions } from '@/queries/extensions'
import type { RightPanelSurfaceId } from '@/shared/lib/right-panel-surfaces'
import { CommandDialog } from '@/shared/ui/CommandDialog'
import { TextInput } from '@/shared/ui/TextInput'
import { useCommandListHighlight } from '../hooks/useCommandListHighlight'
import { useGlobalCommandActions } from '../hooks/useGlobalCommandActions'
import { useGlobalExtensionActions } from '../hooks/useGlobalExtensionActions'
import { nextEnabledCommandIndex } from '../lib/command-palette-navigation'
import {
  createExtensionCommandItems,
  resolveExtensionCommandInvocationScope,
} from '../lib/extension-command-items'
import {
  createCoreCommandItems,
  createRecentProjectItems,
  createRecentSessionItems,
} from '../lib/global-command-core-items'
import {
  createPanelCommandItems,
  type RightPanelSurfaceDisabledReason,
  showPanelSurface,
} from '../lib/global-command-panel-items'
import type { CommandPaletteItem } from '../model'
import { CommandPaletteListbox } from './CommandPaletteListbox'

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
    readonly setSelectedIndex: (index: number) => void
  },
) {
  if (event.nativeEvent.isComposing) return
  if (event.key === 'Escape') {
    event.preventDefault()
    input.close()
    return
  }
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault()
    if (input.items.length === 0) return
    const delta = event.key === 'ArrowDown' ? 1 : -1
    input.setSelectedIndex(nextEnabledCommandIndex(input.items, input.selectedIndex, delta))
    return
  }
  if (event.key === 'Enter') {
    event.preventDefault()
    const item = input.items[input.selectedIndex]
    if (item !== undefined && item.disabled !== true) item.action()
  }
}

interface GlobalCommandPaletteProps {
  /** Why a Right panel surface cannot be shown now; supplied by the Right panel owner. */
  readonly panelDisabledReason?: RightPanelSurfaceDisabledReason
  /**
   * The checkout the Panel rail asks about (a worktree Session's working path), so the palette
   * lists the same extension panels as the rail. Defaults to the project path.
   */
  readonly panelProjectPath?: string | null
}

export function GlobalCommandPalette({
  panelDisabledReason,
  panelProjectPath,
}: GlobalCommandPaletteProps = {}) {
  const { actions, close, projectPath, sessionId, sessions, settings, viewedSessionId } =
    useGlobalCommandActions()
  const extensionActions = useGlobalExtensionActions({ projectPath, sessionId })
  const actionProjectPath = useSessionProjectPath()
  const projectActions = useProjectActions(actionProjectPath).data ?? []
  const runProjectAction = useRunProjectAction(actionProjectPath)
  const runningTerminalCounts = useRunningTerminalCounts()
  const [query, setQuery] = useState('')
  const { data: extensionContributions = null } = useQuery(
    extensionContributionsQueryOptions(projectPath ? [projectPath] : [], { sessionId }),
  )
  const panelPath = panelProjectPath ?? projectPath
  const { data: panelContributions = null } = useQuery(
    extensionContributionsQueryOptions(panelPath ? [panelPath] : [], { sessionId }),
  )
  const extensionItems = createExtensionCommandItems({
    registry: extensionContributions,
    lowerQuery: '',
    invokeCommand: extensionActions.invokeExtensionCommand,
    canInvokeCommand: (entry: ExtensionContributionRegistryEntry) =>
      resolveExtensionCommandInvocationScope({ entry, projectPath, sessionId }) !== null,
  })
  const panelItems = createPanelCommandItems({
    settings,
    // Panels that only need trust or an update are listed too; the Right panel names why.
    extensionPanels: extensionSidePanelSurfaces(panelContributions).filter(
      (panel) => panel.openable || panel.cannotRunYet,
    ),
    ...(panelDisabledReason === undefined ? {} : { disabledReason: panelDisabledReason }),
    showSurface: (id: RightPanelSurfaceId, panel) => {
      close()
      showPanelSurface(id, panel, {
        openBuiltInPanel: actions.openBuiltInPanel,
        openExtensionPanel: (entry) => extensionActions.openExtensionPanel({ entry }),
      })
    },
  })
  const projectActionItems = createProjectActionCommandItems(
    projectActions,
    settings.shortcutRules,
    (action) => {
      close()
      void runProjectAction(action)
    },
  )
  const items = [
    ...createCoreCommandItems(projectPath, settings, actions, {
      sessionId: viewedSessionId,
      openablePanelIds: openableExtensionSidePanelSurfaceIds(panelContributions),
    }),
    ...panelItems,
    ...projectActionItems,
    ...createRecentProjectItems(settings, sessions, actions),
    ...createRecentSessionItems(sessions, actions, runningTerminalCounts),
    ...extensionItems,
  ].filter((item) => itemMatches(item, query))
  const { activeOptionId, boundedHighlightIndex, listboxId, listRef, setHighlightIndex } =
    useCommandListHighlight(items)

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
            setHighlightIndex(null)
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
          role="combobox"
          aria-expanded="true"
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-activedescendant={activeOptionId}
          autoComplete="off"
          spellCheck={false}
          className="h-12 px-0 text-sm"
        />
      </div>
      <CommandPaletteListbox
        items={items}
        highlightIndex={boundedHighlightIndex}
        onHighlightIndexChange={setHighlightIndex}
        listRef={listRef}
        listboxId={listboxId}
        label="Commands"
      />
    </CommandDialog>
  )
}
