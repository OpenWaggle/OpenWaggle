import type { McpServerToolView } from '@shared/types/mcp-configuration'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithQueryClient } from '@/test-utils/query-test-utils'
import { mcpServer, mcpView, PROJECT } from './mcp-section.test-fixtures'

const api = vi.hoisted(() => ({ setMcpServerExposure: vi.fn() }))

vi.mock('@/shared/lib/ipc', () => ({ api }))

import { McpExposureEditor } from '../McpExposureEditor'

const TOOLS: readonly McpServerToolView[] = [
  { name: 'take_screenshot', exposure: 'direct', hasApp: false },
  { name: 'navigate', exposure: 'codemode', hasApp: false },
]

/** A server as a `pi` user configures it: every tool direct, one of them by its own entry. */
const DIRECT_SERVER = mcpServer('chrome-devtools', {
  exposure: 'direct',
  toolExposure: { take_screenshot: 'direct', 'emulate*': 'direct' },
})

function optionsOf(select: HTMLElement) {
  return within(select)
    .getAllByRole('option')
    .map((option) => option.textContent)
}

describe('Settings > MCP exposure editor', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    api.setMcpServerExposure.mockResolvedValue(mcpView([DIRECT_SERVER]))
  })

  it('offers codemode or hidden, and shows a file-level direct as codemode', () => {
    renderWithQueryClient(
      <McpExposureEditor projectPath={PROJECT} server={DIRECT_SERVER} tools={TOOLS} />,
    )

    const exposure = screen.getByRole('radiogroup', { name: 'Server exposure' })
    expect(
      within(exposure)
        .getAllByRole('radio')
        .map((radio) => radio.dataset.exposure),
    ).toEqual(['codemode', 'hidden'])
    expect(within(exposure).getByRole('radio', { name: /Codemode/ })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    const screenshot = screen.getByRole('combobox', { name: 'Exposure of take_screenshot' })
    expect(screenshot).toHaveValue('codemode')
    expect(optionsOf(screenshot)).toEqual(['Same as server (Codemode)', 'Codemode', 'Hidden'])
    expect(screen.getByText(/emulate\*/)).toHaveTextContent('emulate* → Codemode')
    // No choice, label, warning or notice names the direct exposure.
    expect(screen.queryByText(/\bdirect\b/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('keeps showing a file-level deferred while it is the current value', async () => {
    const deferred = mcpServer('docs', { exposure: 'deferred' })
    renderWithQueryClient(
      <McpExposureEditor
        projectPath={PROJECT}
        server={deferred}
        tools={[{ name: 'search', exposure: 'deferred', hasApp: false }]}
      />,
    )

    const exposure = screen.getByRole('radiogroup', { name: 'Server exposure' })
    expect(within(exposure).getByRole('radio', { name: /Deferred/ })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    fireEvent.click(within(exposure).getByRole('radio', { name: /Codemode/ }))

    await waitFor(() =>
      expect(api.setMcpServerExposure).toHaveBeenCalledWith({
        projectPath: PROJECT,
        name: 'docs',
        exposure: 'codemode',
      }),
    )
  })
})
