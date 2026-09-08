import type { TerminalPortPreview } from '@shared/types/terminal'
import type { RenderResult } from '@testing-library/react'
import { useTerminalStore } from '../../state/terminal-store'
import {
  getTerminalPaneMocks,
  renderTerminalPanel,
  resetTerminalPaneHarness,
} from './terminal-pane-test-harness'

const mocks = getTerminalPaneMocks()

export const DRAFT_OWNER = 'draft:/tmp/project-x'

export function seedGroup(
  panes: { terminalId: string; cwd: string }[],
  extra: {
    exits?: Record<string, number>
    portPreviews?: Record<string, TerminalPortPreview[]>
  } = {},
) {
  useTerminalStore.setState((state) => ({
    groups: {
      ...state.groups,
      [DRAFT_OWNER]: {
        tabs: [
          {
            id: 'tab-1',
            panes,
            activePaneId: panes[0]?.terminalId ?? '',
            splitDirection: 'side-by-side',
            customName: null,
          },
        ],
        activeTabId: 'tab-1',
        panelOpen: true,
        panelHeight: 228,
      },
    },
    ...extra,
  }))
}

export function renderPanel(defaultCwd: string | null = '/tmp/project-x'): RenderResult {
  return renderTerminalPanel(defaultCwd)
}

export function resetTerminalPanelHarness() {
  resetTerminalPaneHarness()
  mocks.closeTerminal.mockResolvedValue(undefined)
}

export function getTerminalPanelMocks(): ReturnType<typeof getTerminalPaneMocks> {
  return mocks
}
