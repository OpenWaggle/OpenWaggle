import { describe, expect, it } from 'vitest'
import { collectAstroRawButtonViolations } from '../standards/astro-raw-buttons'

const TEMPLATE = '---\nconst label = "Open"\n---\n<button type="button">{label}</button>\n'

describe('Astro raw button standard', () => {
  it('reports a raw <button> in a website Astro template with its position', () => {
    const violations = collectAstroRawButtonViolations(
      'website/src/components/Header.astro',
      TEMPLATE,
    )

    expect(violations).toHaveLength(1)
    expect(violations.at(0)?.detail).toBe('website/src/components/Header.astro:4:1')
    expect(violations.at(0)?.message).toContain('shared website Button primitive')
  })

  it('allows raw buttons inside the website Button primitive', () => {
    expect(
      collectAstroRawButtonViolations('website/src/components/ui/Button.astro', TEMPLATE),
    ).toHaveLength(0)
  })

  it('ignores files that are not website Astro templates', () => {
    expect(collectAstroRawButtonViolations('src/renderer/src/App.tsx', TEMPLATE)).toHaveLength(0)
  })
})
