import type { ShortcutCommand } from '@shared/types/shortcuts'
import {
  FolderTree,
  GitCompare,
  Globe2,
  LayoutGrid,
  type LucideIcon,
  Network,
  Paperclip,
  Play,
} from 'lucide-react'
import type { BuiltInRightPanelSurfaceId } from './right-panel-surfaces'

export interface BuiltInRightPanelSurfaceDefinition {
  readonly id: BuiltInRightPanelSurfaceId
  readonly title: string
  readonly description: string
  readonly icon: LucideIcon
  /** The Shortcut registry command that toggles this surface like its rail icon. */
  readonly command: ShortcutCommand
  readonly group: 'Workspace' | 'Session' | null
}

/** Built-in Right panel surfaces in their default Panel rail order (ADR 0043). */
export const BUILT_IN_RIGHT_PANEL_SURFACES = [
  {
    id: 'all-panels',
    title: 'All panels',
    description: 'Every panel you can open here, with its shortcut',
    icon: LayoutGrid,
    command: 'rightPanel.allPanels',
    group: null,
  },
  {
    id: 'changes',
    title: 'Changes',
    description: 'Review the working tree diff',
    icon: GitCompare,
    command: 'diff.toggle',
    group: 'Workspace',
  },
  {
    id: 'project-actions',
    title: 'Project Actions',
    description: 'Run, stop and inspect project actions',
    icon: Play,
    command: 'rightPanel.projectActions',
    group: 'Workspace',
  },
  {
    id: 'browser',
    title: 'Browser',
    description: 'Preview pages in the session browser',
    icon: Globe2,
    command: 'preview.toggle',
    group: 'Workspace',
  },
  {
    id: 'files',
    title: 'Files',
    description: 'Browse and edit workspace files',
    icon: FolderTree,
    command: 'rightPanel.files',
    group: 'Workspace',
  },
  {
    id: 'session-tree',
    title: 'Session Tree',
    description: 'Inspect branches and session history',
    icon: Network,
    command: 'sessionTree.toggle',
    group: 'Session',
  },
  {
    id: 'resources',
    title: 'Resources',
    description: 'Sources and outputs captured in this session',
    icon: Paperclip,
    command: 'rightPanel.resources',
    group: 'Session',
  },
] as const satisfies readonly BuiltInRightPanelSurfaceDefinition[]

export function builtInRightPanelSurface(id: BuiltInRightPanelSurfaceId) {
  const surface = BUILT_IN_RIGHT_PANEL_SURFACES.find((candidate) => candidate.id === id)
  if (surface === undefined) throw new Error(`Unknown Right panel surface: ${id}`)
  return surface
}
