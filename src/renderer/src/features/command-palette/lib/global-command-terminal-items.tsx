import type { Settings } from '@shared/types/settings'
import { PanelRightOpen, TerminalSquare } from 'lucide-react'
import { formatShortcutBinding } from '@/shared/lib/shortcut-display'
import type { CommandPaletteItem } from '../model'
import type { CoreCommandActions } from './global-command-core-items'

export function createTerminalCommandItems(
  settings: Settings,
  actions: CoreCommandActions,
): CommandPaletteItem[] {
  return [
    {
      id: 'toggle-terminal',
      label: 'Toggle terminal',
      icon: <TerminalSquare className="size-3.5" />,
      section: 'View',
      trailing: formatShortcutBinding(settings.shortcutBindings['terminal.toggle']),
      action: () => actions.finish(actions.toggleTerminal),
    },
    {
      id: 'new-terminal',
      label: 'New terminal',
      icon: <TerminalSquare className="size-3.5" />,
      section: 'View',
      trailing: formatShortcutBinding(settings.shortcutBindings['terminal.new']),
      action: () => actions.finish(actions.newTerminal),
    },
    {
      id: 'new-side-terminal',
      label: 'New terminal in side panel',
      description: 'Create, reveal, and focus a terminal beside the chat',
      icon: <PanelRightOpen className="size-3.5" />,
      section: 'View',
      action: () => actions.finish(actions.newSideTerminal),
    },
    {
      id: 'toggle-side-panel-maximized',
      label: 'Toggle side panel size',
      description: 'Maximize or restore the workspace side panel',
      icon: <PanelRightOpen className="size-3.5" />,
      section: 'View',
      action: () => actions.finish(actions.toggleSidePanelMaximized),
    },
    {
      id: 'split-terminal',
      label: 'Split terminal side by side',
      icon: <TerminalSquare className="size-3.5" />,
      section: 'View',
      trailing: formatShortcutBinding(settings.shortcutBindings['terminal.split']),
      action: () => actions.finish(actions.splitTerminal),
    },
    {
      id: 'split-terminal-vertical',
      label: 'Split terminal vertically',
      icon: <TerminalSquare className="size-3.5" />,
      section: 'View',
      trailing: formatShortcutBinding(settings.shortcutBindings['terminal.splitVertical']),
      action: () => actions.finish(actions.splitTerminalVertical),
    },
    {
      id: 'close-terminal',
      label: 'Close active terminal',
      icon: <TerminalSquare className="size-3.5" />,
      section: 'View',
      trailing: formatShortcutBinding(settings.shortcutBindings['terminal.close']),
      action: () => actions.finish(() => void actions.closeActiveTerminal()),
    },
  ]
}
