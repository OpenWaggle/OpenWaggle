import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { SidebarSettingsButton } from '../SidebarNavigation'

describe('SidebarSettingsButton', () => {
  it('keeps the Settings label beside a compact Usage & Cost icon button', () => {
    const onOpenSettings = vi.fn()
    const onOpenUsageCost = vi.fn()
    render(
      <SidebarSettingsButton onOpenSettings={onOpenSettings} onOpenUsageCost={onOpenUsageCost} />,
    )

    const settings = screen.getByRole('button', { name: 'Settings' })
    const usage = screen.getByRole('button', { name: 'Usage & Cost' })
    expect(settings).toHaveTextContent('Settings')
    expect(settings).toHaveClass('flex-1')
    // A full-width Usage button squeezed the Settings label out of the footer.
    expect(usage).not.toHaveClass('w-full')
    expect(usage).toHaveClass('size-7.5')

    fireEvent.click(usage)
    expect(onOpenUsageCost).toHaveBeenCalledOnce()
    expect(onOpenSettings).not.toHaveBeenCalled()

    fireEvent.click(settings)
    expect(onOpenSettings).toHaveBeenCalledOnce()
  })
})
