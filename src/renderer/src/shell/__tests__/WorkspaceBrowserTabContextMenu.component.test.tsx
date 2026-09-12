import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { WorkspaceBrowserTabContextMenu } from '../WorkspaceBrowserTabContextMenu'

function renderMenu(targetId = 'two') {
  const onClose = vi.fn()
  const onCloseTabs = vi.fn()
  const onSetAudioMuted = vi.fn()
  render(
    <WorkspaceBrowserTabContextMenu
      model={{
        open: true,
        position: { x: 20, y: 30 },
        tabIds: ['one', 'two', 'three'],
        targetId,
        targetAudioMuted: false,
        targetMaterialized: true,
      }}
      actions={{ close: onClose, closeTabs: onCloseTabs, setAudioMuted: onSetAudioMuted }}
    />,
  )
  return { onClose, onCloseTabs, onSetAudioMuted }
}

describe('WorkspaceBrowserTabContextMenu', () => {
  it.each([
    ['Close', ['two']],
    ['Close others', ['one', 'three']],
    ['Close tabs to the right', ['three']],
    ['Close all', ['one', 'two', 'three']],
  ] as const)('targets the correct tabs for %s', (label, expectedIds) => {
    const callbacks = renderMenu()

    fireEvent.click(screen.getByRole('menuitem', { name: label }))

    expect(callbacks.onClose).toHaveBeenCalledOnce()
    expect(callbacks.onCloseTabs).toHaveBeenCalledExactlyOnceWith(expectedIds)
  })

  it('disables close-right when the target is the final tab', () => {
    renderMenu('three')

    expect(screen.getByRole('menuitem', { name: 'Close tabs to the right' })).toBeDisabled()
  })

  it('mutes a materialized tab even while it is quiet', () => {
    const callbacks = renderMenu()

    fireEvent.click(screen.getByRole('menuitem', { name: 'Mute tab' }))

    expect(callbacks.onClose).toHaveBeenCalledOnce()
    expect(callbacks.onSetAudioMuted).toHaveBeenCalledExactlyOnceWith('two', true)
  })
})
