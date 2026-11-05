import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { SettingsSectionContainer } from '../SettingsSectionContainer'

function widthCapClasses(element: Element | null | undefined) {
  return [...(element?.classList ?? [])].filter(
    (name) => name.startsWith('max-w-') || name === 'mx-auto',
  )
}

describe('SettingsSectionContainer', () => {
  it('scrolls flow sections with the shared padding and fills the available width', () => {
    render(
      <SettingsSectionContainer className="space-y-6">
        <p>Section body</p>
      </SettingsSectionContainer>,
    )

    const content = screen.getByText('Section body').parentElement
    const scrollArea = content?.parentElement
    expect(scrollArea).toHaveAttribute('data-settings-section-layout', 'flow')
    expect(scrollArea).toHaveClass('size-full', 'min-w-0', 'overflow-y-auto', 'px-4', 'py-5')
    expect(content).toHaveClass('w-full', 'min-w-0', 'space-y-6')
    expect(widthCapClasses(scrollArea)).toEqual([])
    expect(widthCapClasses(content)).toEqual([])
  })

  it('hands the whole content area to fill sections', () => {
    render(
      <SettingsSectionContainer layout="fill" className="bg-bg">
        <p>Pane body</p>
      </SettingsSectionContainer>,
    )

    const root = screen.getByText('Pane body').parentElement
    expect(root).toHaveAttribute('data-settings-section-layout', 'fill')
    expect(root).toHaveClass('flex', 'size-full', 'min-h-0', 'min-w-0', 'flex-col', 'bg-bg')
    expect(root).not.toHaveClass('overflow-y-auto')
  })
})
