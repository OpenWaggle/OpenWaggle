import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ExtensionPanelIcon } from '../ExtensionPanelIcon'

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M2 9h20"/></svg>'

function renderedIcon(container: HTMLElement) {
  const icon = container.querySelector('[data-extension-panel-icon]')
  if (!(icon instanceof HTMLElement)) throw new Error('Panel icon was not rendered.')
  return icon
}

describe('ExtensionPanelIcon', () => {
  it('paints the icon as a CSS mask over currentColor without inserting SVG', () => {
    const { container } = render(
      <ExtensionPanelIcon icon={{ source: 'svg', svg: SVG }} title="Issues" className="extra" />,
    )

    const icon = renderedIcon(container)
    const style = icon.getAttribute('style') ?? ''
    expect(icon.dataset.extensionPanelIcon).toBe('svg')
    expect(icon.getAttribute('aria-hidden')).toBe('true')
    expect(icon.className).toContain('size-4')
    expect(icon.className).toContain('bg-current')
    expect(icon.className).toContain('extra')
    expect(style).toContain(
      `mask-image: url("data:image/svg+xml;charset=utf-8,${encodeURIComponent(SVG)}")`,
    )
    expect(style).toContain('-webkit-mask-image')
    expect(container.querySelector('svg')).toBeNull()
    expect(icon.textContent).toBe('')
  })

  it('marks Lucide icons with their source', () => {
    const { container } = render(
      <ExtensionPanelIcon icon={{ source: 'lucide', svg: SVG }} title="Issues" />,
    )

    expect(renderedIcon(container).dataset.extensionPanelIcon).toBe('lucide')
  })

  it('falls back to a letter tile with the title initial', () => {
    const { container } = render(<ExtensionPanelIcon title="  issues board" />)

    const icon = renderedIcon(container)
    expect(icon.dataset.extensionPanelIcon).toBe('letter')
    expect(icon.textContent).toBe('I')
    expect(icon.getAttribute('style')).toBeNull()
    expect(icon.className).toContain('size-4')
  })

  it('uses a placeholder letter for an empty title', () => {
    const { container } = render(<ExtensionPanelIcon title="   " />)

    expect(renderedIcon(container).textContent).toBe('?')
  })
})
