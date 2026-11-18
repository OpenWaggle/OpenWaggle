import { render } from '@testing-library/react'
import { GitCompareArrows } from 'lucide-react'
import { describe, expect, it } from 'vitest'
import { SessionRowGlyph } from '../SessionRowParts'

/**
 * Chromium runs an SVG element's CSS animation on the main thread, restyling and repainting on
 * every frame, while an HTML box's opacity or transform animation runs on the compositor. A
 * working Session's pulsing icon kept the renderer busy for as long as its Run lasted.
 */
describe('SessionRowGlyph', () => {
  it('animates an HTML box around the status icon, never the SVG itself', () => {
    const { container } = render(
      <SessionRowGlyph
        StatusIcon={GitCompareArrows}
        animateClass="animate-pulse"
        hasInterruptedRun={false}
      />,
    )

    const svg = container.querySelector('svg')
    expect(svg?.getAttribute('class')).not.toContain('animate-')
    expect(svg?.closest('.animate-pulse')?.tagName).toBe('SPAN')
  })

  it('does not animate an interruption', () => {
    const { container } = render(
      <SessionRowGlyph
        StatusIcon={GitCompareArrows}
        animateClass="animate-pulse"
        hasInterruptedRun
      />,
    )

    expect(container.querySelector('.animate-pulse')).toBeNull()
  })
})
