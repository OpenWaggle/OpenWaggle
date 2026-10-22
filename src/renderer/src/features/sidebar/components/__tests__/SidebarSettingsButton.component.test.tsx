import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useScheduledTaskIndexStore } from '@/features/scheduled-tasks/state'
import { SidebarSettingsButton } from '../SidebarNavigation'

function renderFooter(handlers: {
  readonly onOpenSettings?: () => void
  readonly onOpenScheduledTasks?: () => void
  readonly onOpenUsageCost?: () => void
}) {
  render(
    <SidebarSettingsButton
      onOpenSettings={handlers.onOpenSettings ?? vi.fn()}
      onOpenScheduledTasks={handlers.onOpenScheduledTasks ?? vi.fn()}
      onOpenUsageCost={handlers.onOpenUsageCost ?? vi.fn()}
    />,
  )
}

describe('SidebarSettingsButton', () => {
  afterEach(() => useScheduledTaskIndexStore.getState().index([]))

  it('keeps the Settings label beside a compact Usage & Cost icon button', () => {
    const onOpenSettings = vi.fn()
    const onOpenUsageCost = vi.fn()
    renderFooter({ onOpenSettings, onOpenUsageCost })

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

  it('opens Scheduled tasks and marks a task needing attention with a dot', () => {
    const onOpenScheduledTasks = vi.fn()
    useScheduledTaskIndexStore.setState({ attentionCount: 1 })
    renderFooter({ onOpenScheduledTasks })

    const scheduled = screen.getByRole('button', { name: 'Scheduled tasks (needs attention)' })
    expect(scheduled).toHaveClass('size-7.5')
    fireEvent.click(scheduled)
    expect(onOpenScheduledTasks).toHaveBeenCalledOnce()
  })
})
