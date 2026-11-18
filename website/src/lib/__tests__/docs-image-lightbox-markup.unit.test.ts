import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { LIGHTBOX_IDS } from '../docs-image-lightbox'

// Source checks, so they run in the root unit tier on every pull request; Astro's renderer is not
// available there. docs-image-lightbox.unit.test.ts tests the script itself in a DOM.
const COMPONENT = readFileSync(
  new URL('../../components/docs/DocsImageLightbox.astro', import.meta.url),
  'utf8',
)
const BUTTON = readFileSync(new URL('../../components/ui/Button.astro', import.meta.url), 'utf8')
const LAYOUT = readFileSync(new URL('../../layouts/DocsLayout.astro', import.meta.url), 'utf8')

describe('the docs image lightbox markup', () => {
  it('is a labelled native dialog whose Close button submits a dialog form', () => {
    expect(COMPONENT).toMatch(
      /<dialog id=\{LIGHTBOX_IDS\.dialog\}[^>]*aria-label="Full-size image"/u,
    )
    // The native dialog closes on Escape and on a method="dialog" submit; the script focuses Close.
    expect(COMPONENT).toMatch(
      /<form method="dialog">\s*<Button id=\{LIGHTBOX_IDS\.close\} type="submit"[^>]*>Close<\/Button>\s*<\/form>/u,
    )
    expect(COMPONENT).toMatch(
      /<Button id=\{LIGHTBOX_IDS\.original\}[^>]*>Open image file<\/Button>/u,
    )
    expect(COMPONENT).toContain('<img id={LIGHTBOX_IDS.image}')
  })

  it('uses ids the script looks up, and a Button that forwards id and type', () => {
    expect(new Set(Object.values(LIGHTBOX_IDS)).size).toBe(Object.keys(LIGHTBOX_IDS).length)
    expect(BUTTON).toMatch(/type = 'button',[\s\S]*\.\.\.attributes/u)
    expect(BUTTON).toMatch(/<button[^>]*type=\{type\}[^>]*\{\.\.\.attributes\}/u)
  })

  it('runs the lightbox script', () => {
    expect(COMPONENT).toMatch(
      /<script>[\s\S]*\benhanceDocsImageLightbox\(document\);[\s\S]*<\/script>/u,
    )
  })

  it('is on every docs page', () => {
    expect(LAYOUT).toContain('<DocsImageLightbox />')
  })
})
