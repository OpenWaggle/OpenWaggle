import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { SessionSourceAddMenu } from '../SessionSourceAddMenu'

describe('SessionSourceAddMenu', () => {
  it('offers composer-native attachment and project-reference actions', () => {
    const onAttachFiles = vi.fn()
    const onReferenceProjectFile = vi.fn()
    render(
      <SessionSourceAddMenu
        onAttachFiles={onAttachFiles}
        onReferenceProjectFile={onReferenceProjectFile}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Add a source' }))
    fireEvent.click(screen.getByRole('menuitem', { name: /Attach files/ }))
    expect(onAttachFiles).toHaveBeenCalledOnce()
    expect(screen.queryByRole('menuitem', { name: /Attach files/ })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Add a source' }))
    fireEvent.click(screen.getByRole('menuitem', { name: /Reference project file/ }))
    expect(onReferenceProjectFile).toHaveBeenCalledOnce()
  })
})
