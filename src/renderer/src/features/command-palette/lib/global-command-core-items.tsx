import type { SessionSummary } from '@shared/types/session'
import type { Settings } from '@shared/types/settings'
import { shortcutBindingKey } from '@shared/types/shortcuts'
import {
  Archive,
  Command,
  FileSearch,
  Files,
  FolderOpen,
  GitFork,
  LayoutList,
  Link,
  MessageSquarePlus,
  PackageOpen,
  PanelLeft,
  Settings as SettingsIcon,
  Waypoints,
} from 'lucide-react'
import { projectName } from '@/shared/lib/format'
import { formatShortcutBinding } from '@/shared/lib/shortcut-display'
import type { CommandPaletteItem } from '../model'
import { createTerminalCommandItems } from './global-command-terminal-items'

const RECENT_SESSION_LIMIT = 12

export interface CoreCommandActions {
  readonly compactSession: () => Promise<void>
  readonly copySessionLink: (sessionId: string) => void
  readonly finish: (action: () => void) => void
  readonly newSession: (path: string | null) => void
  readonly openBuiltInPanel: (panel: 'diff' | 'session-tree') => void
  readonly openCommandSurface: (surface: 'content' | 'files') => void
  readonly openFeedbackModal: () => void
  readonly requestSessionCommand: (command: 'clone-session' | 'fork-session') => void
  readonly routeToSession: (id: string) => void
  readonly selectProject: (mode: 'new' | 'open') => Promise<void>
  readonly setProjectPath: (path: string) => Promise<void>
  readonly toggleSidebar: () => void
  readonly toggleSessionSummary: () => void
  readonly toggleTerminal: () => void
  readonly newTerminal: () => void
  readonly newSideTerminal: () => void
  readonly splitTerminal: () => void
  readonly splitTerminalVertical: () => void
  readonly toggleSidePanelMaximized: () => void
  readonly closeActiveTerminal: () => Promise<void>
  readonly navigateTo: (target: 'extensions' | 'settings' | 'skills' | 'waggle') => void
}

function createProjectItems(
  projectPath: string | null,
  settings: Settings,
  actions: CoreCommandActions,
): CommandPaletteItem[] {
  return [
    {
      id: 'new-session',
      label: 'New session',
      description: projectPath ? 'Start in the active project' : 'Start a draft session',
      icon: <MessageSquarePlus className="size-3.5" />,
      section: 'Create',
      trailing: formatShortcutBinding(settings.shortcutBindings['chat.new']),
      action: () => actions.finish(() => actions.newSession(projectPath)),
    },
    {
      id: 'new-session-other-project',
      label: 'New session in another project',
      description: 'Choose a project and start with an empty composer',
      icon: <FolderOpen className="size-3.5" />,
      section: 'Create',
      action: () => void actions.selectProject('new'),
    },
    {
      id: 'go-to-file',
      label: 'Go to file',
      description: 'Fuzzy search files in the active project',
      icon: <Files className="size-3.5" />,
      section: 'Project',
      trailing: formatShortcutBinding(settings.shortcutBindings['filePicker.toggle']),
      action: () => actions.openCommandSurface('files'),
    },
    {
      id: 'search-project-contents',
      label: 'Search project contents',
      description: 'Find matching lines across project files',
      icon: <FileSearch className="size-3.5" />,
      section: 'Project',
      action: () => actions.openCommandSurface('content'),
    },
    {
      id: 'open-project',
      label: 'Open project',
      description: 'Choose a folder and resume its latest session',
      icon: <FolderOpen className="size-3.5" />,
      section: 'Project',
      action: () => void actions.selectProject('open'),
    },
  ]
}

/**
 * The Copy session link chord, unless an extension panel the user bound to the same chord takes
 * it: a default yields to such a panel (`unified-shortcut-resolver`), so showing it would mislead.
 */
function copySessionLinkHint(settings: Settings) {
  const binding = settings.shortcutBindings['session.copyLink']
  const takenByPanel =
    binding !== null &&
    Object.values(settings.extensionPanelShortcutBindings).some(
      (panel) => shortcutBindingKey(panel) === shortcutBindingKey(binding),
    )
  return formatShortcutBinding(takenByPanel ? null : binding)
}

/** Only a Session that exists has a link; a new-session draft has none yet (ADR 0056). */
function createSessionLinkItems(
  sessionId: string | null,
  settings: Settings,
  actions: CoreCommandActions,
): CommandPaletteItem[] {
  if (sessionId === null) return []
  return [
    {
      id: 'copy-session-link',
      label: 'Copy session link',
      description: 'Reference this session from another session, the CLI, or a note',
      icon: <Link className="size-3.5" />,
      section: 'Session',
      trailing: copySessionLinkHint(settings),
      action: () => actions.finish(() => actions.copySessionLink(sessionId)),
    },
  ]
}

function createSessionItems(actions: CoreCommandActions): CommandPaletteItem[] {
  return [
    {
      id: 'compact-session',
      label: 'Compact session',
      description: 'Compact the active session context',
      icon: <Archive className="size-3.5" />,
      section: 'Session',
      action: () => {
        actions.finish(() => void actions.compactSession())
      },
    },
    {
      id: 'fork-session',
      label: 'Fork to new session',
      description: 'Choose a user message as the fork point',
      icon: <GitFork className="size-3.5" />,
      section: 'Session',
      action: () => actions.finish(() => actions.requestSessionCommand('fork-session')),
    },
    {
      id: 'clone-session',
      label: 'Clone current session',
      description: 'Copy the active path into a new session',
      icon: <MessageSquarePlus className="size-3.5" />,
      section: 'Session',
      action: () => actions.finish(() => actions.requestSessionCommand('clone-session')),
    },
  ]
}

function createViewAndOpenItems(
  settings: Settings,
  actions: CoreCommandActions,
): CommandPaletteItem[] {
  return [
    {
      id: 'toggle-sidebar',
      label: 'Toggle sidebar',
      icon: <PanelLeft className="size-3.5" />,
      section: 'View',
      trailing: formatShortcutBinding(settings.shortcutBindings['sidebar.toggle']),
      action: () => actions.finish(actions.toggleSidebar),
    },
    {
      id: 'toggle-session-summary',
      label: 'Toggle Session Summary',
      description: 'Show or hide the active session overview',
      icon: <LayoutList className="size-3.5" />,
      section: 'View',
      action: () => actions.finish(actions.toggleSessionSummary),
    },
    ...createTerminalCommandItems(settings, actions),
    {
      id: 'settings',
      label: 'Settings',
      icon: <SettingsIcon className="size-3.5" />,
      section: 'Open',
      action: () => actions.finish(() => actions.navigateTo('settings')),
    },
    {
      id: 'skills',
      label: 'Skills',
      icon: <PackageOpen className="size-3.5" />,
      section: 'Open',
      action: () => actions.finish(() => actions.navigateTo('skills')),
    },
    {
      id: 'waggle',
      label: 'Waggle settings',
      icon: <Waypoints className="size-3.5" />,
      section: 'Open',
      action: () => actions.finish(() => actions.navigateTo('waggle')),
    },
    {
      id: 'extensions',
      label: 'Extensions',
      icon: <PackageOpen className="size-3.5" />,
      section: 'Open',
      action: () => actions.finish(() => actions.navigateTo('extensions')),
    },
    {
      id: 'feedback',
      label: 'Report an issue',
      icon: <Command className="size-3.5" />,
      section: 'Help',
      action: () => actions.finish(actions.openFeedbackModal),
    },
  ]
}

export function createCoreCommandItems(
  projectPath: string | null,
  settings: Settings,
  actions: CoreCommandActions,
  sessionId: string | null = null,
) {
  return [
    ...createProjectItems(projectPath, settings, actions),
    ...createSessionItems(actions),
    ...createSessionLinkItems(sessionId, settings, actions),
    ...createViewAndOpenItems(settings, actions),
  ]
}

export function createRecentProjectItems(
  settings: Settings,
  sessions: readonly SessionSummary[],
  actions: CoreCommandActions,
): CommandPaletteItem[] {
  return settings.recentProjects.map((path) => ({
    id: `project:${path}`,
    label: settings.projectDisplayNames[path] ?? projectName(path),
    description: projectName(path),
    icon: <FolderOpen className="size-3.5" />,
    section: 'Recent projects',
    action: () => {
      actions.finish(() => {
        void actions.setProjectPath(path).then(() => {
          const recent = sessions
            .filter((session) => session.projectPath === path)
            .sort((left, right) => right.updatedAt - left.updatedAt)[0]
          if (recent) actions.routeToSession(String(recent.id))
          else actions.newSession(path)
        })
      })
    },
  }))
}

export function createRecentSessionItems(
  sessions: readonly SessionSummary[],
  actions: CoreCommandActions,
  runningTerminalCounts: ReadonlyMap<string, number> = new Map(),
): CommandPaletteItem[] {
  return [...sessions]
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .slice(0, RECENT_SESSION_LIMIT)
    .map((session) => {
      const runningTerminalCount = runningTerminalCounts.get(String(session.id)) ?? 0
      return {
        id: `session:${String(session.id)}`,
        label: session.title || 'Untitled session',
        description: projectName(session.projectPath),
        icon: <Command className="size-3.5" />,
        section: 'Recent sessions',
        ...(runningTerminalCount > 0
          ? {
              trailingBadge:
                runningTerminalCount === 1
                  ? '1 terminal running'
                  : `${String(runningTerminalCount)} terminals running`,
            }
          : {}),
        action: () => actions.finish(() => actions.routeToSession(String(session.id))),
      }
    })
}
