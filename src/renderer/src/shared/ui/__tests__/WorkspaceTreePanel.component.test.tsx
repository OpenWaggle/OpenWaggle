import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { WorkspaceTreePanel } from '../WorkspaceTreePanel'

describe('WorkspaceTreePanel', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('renders after the primary content as a right-side navigator', () => {
    render(
      <div className="flex">
        <main data-testid="primary-content">Code</main>
        <WorkspaceTreePanel open>
          <div>Files</div>
        </WorkspaceTreePanel>
      </div>,
    )

    const primary = screen.getByTestId('primary-content')
    const navigator = screen.getByRole('complementary', { name: 'Workspace navigator' })
    expect(primary.nextElementSibling).toBe(navigator)
    expect(navigator).toHaveClass('border-l')
  })

  it('does not keep a hidden navigator in the layout', () => {
    render(
      <WorkspaceTreePanel open={false}>
        <div>Files</div>
      </WorkspaceTreePanel>,
    )

    expect(screen.queryByRole('complementary', { name: 'Workspace navigator' })).toBeNull()
  })

  it('resizes with the keyboard and shares the persisted width across mounts', () => {
    const { unmount } = render(
      <WorkspaceTreePanel open>
        <div>Files</div>
      </WorkspaceTreePanel>,
    )

    const rail = screen.getByRole('button', { name: /Resize workspace navigator/ })
    // Left widens because the navigator is docked on the right.
    fireEvent.keyDown(rail, { key: 'ArrowLeft' })
    expect(rail).toHaveAccessibleName(/236 pixels/)

    unmount()
    render(
      <WorkspaceTreePanel open>
        <div>Files</div>
      </WorkspaceTreePanel>,
    )
    expect(screen.getByRole('button', { name: /Resize workspace navigator/ })).toHaveAccessibleName(
      /236 pixels/,
    )
  })

  it('clamps the shared width at its minimum', () => {
    render(
      <WorkspaceTreePanel open>
        <div>Files</div>
      </WorkspaceTreePanel>,
    )
    const rail = screen.getByRole('button', { name: /Resize workspace navigator/ })

    for (let press = 0; press < 12; press += 1) {
      fireEvent.keyDown(rail, { key: 'ArrowRight' })
    }

    expect(rail).toHaveAccessibleName(/140 pixels/)
  })
})
