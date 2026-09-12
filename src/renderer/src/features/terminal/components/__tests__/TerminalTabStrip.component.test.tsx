import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { TerminalTabState } from '../../state/terminal-store'
import { TerminalTabStrip } from '../TerminalTabStrip'

const OWNER = 'session-1'

function tab(id: string, terminalId: string, customName: string | null): TerminalTabState {
  return {
    id,
    panes: [{ terminalId, cwd: '/repo' }],
    activePaneId: terminalId,
    splitDirection: 'side-by-side',
    customName,
  }
}

function renderStrip(overrides: { activeTabId?: string } = {}) {
  const handlers = {
    onSelectTab: vi.fn(),
    onCloseTab: vi.fn(),
    onRenameTab: vi.fn(),
  }
  render(
    <TerminalTabStrip
      ownerKey={OWNER}
      tabs={[tab('tab-1', 'term-1', 'build'), tab('tab-2', 'term-2', null)]}
      activeTabId={overrides.activeTabId ?? 'tab-1'}
      activity={{ [`${OWNER}::term-2`]: 'vite' }}
      {...handlers}
    />,
  )
  return handlers
}

describe('TerminalTabStrip', () => {
  it('exposes tab semantics and keyboard navigation', () => {
    const handlers = renderStrip()
    const tabs = screen.getAllByRole('tab')

    expect(tabs[0]).toHaveAttribute('aria-selected', 'true')
    expect(tabs[1]).toHaveAttribute('aria-selected', 'false')
    const firstTab = tabs[0]
    if (firstTab === undefined) throw new Error('Expected the first terminal tab')
    fireEvent.keyDown(firstTab, { key: 'ArrowRight' })

    expect(handlers.onSelectTab).toHaveBeenCalledWith('tab-2')
  })

  it('prefills rename and Escape cancels without clearing the custom name', () => {
    const handlers = renderStrip()
    fireEvent.doubleClick(screen.getByRole('tab', { name: 'build' }))

    const input = screen.getByRole('textbox', { name: 'Terminal name' })
    expect(input).toHaveValue('build')
    fireEvent.keyDown(input, { key: 'Escape' })

    expect(handlers.onRenameTab).not.toHaveBeenCalled()
    expect(screen.getByRole('tab', { name: 'build' })).toBeInTheDocument()
  })

  it('saves an edited name on Enter and closes from the keyboard', () => {
    const handlers = renderStrip()
    const firstTab = screen.getByRole('tab', { name: 'build' })
    fireEvent.keyDown(firstTab, { key: 'F2' })
    const input = screen.getByRole('textbox', { name: 'Terminal name' })
    fireEvent.change(input, { target: { value: 'server' } })
    const renameForm = input.closest('form')
    if (renameForm === null) throw new Error('Expected the terminal rename form')
    fireEvent.submit(renameForm)

    expect(handlers.onRenameTab).toHaveBeenCalledWith('tab-1', 'server')

    const secondTab = screen.getByRole('tab', { name: 'vite' })
    fireEvent.keyDown(secondTab, { key: 'Delete' })
    expect(handlers.onCloseTab).toHaveBeenCalledWith('tab-2')
  })

  it('uses the focused split pane process for the active tab identity', () => {
    const splitTab: TerminalTabState = {
      ...tab('tab-1', 'term-1', null),
      panes: [
        { terminalId: 'term-1', cwd: '/repo' },
        { terminalId: 'term-2', cwd: '/repo' },
      ],
      activePaneId: 'term-2',
    }

    render(
      <TerminalTabStrip
        ownerKey={OWNER}
        tabs={[splitTab]}
        activeTabId="tab-1"
        activity={{ [`${OWNER}::term-1`]: 'zsh', [`${OWNER}::term-2`]: 'vite' }}
        onSelectTab={vi.fn()}
        onCloseTab={vi.fn()}
        onRenameTab={vi.fn()}
      />,
    )

    expect(screen.getByRole('tab', { name: 'vite (2)' })).toBeInTheDocument()
  })
})
