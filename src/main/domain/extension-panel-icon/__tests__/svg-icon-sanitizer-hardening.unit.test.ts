import { describe, expect, it } from 'vitest'
import { SVG_ICON_MAX_BYTES, sanitizeSvgIcon } from '../svg-icon-sanitizer'

const SHAPE = '<path d="M2 9h20"/>'
/** A linear pass over 32 KB takes a few milliseconds; quadratic work takes about a second. */
const SANITIZE_BUDGET_MS = 300
const ROOT_TAG_BYTES = 120
const LONG_RUN = ' '.repeat(SVG_ICON_MAX_BYTES - ROOT_TAG_BYTES)

function sanitizeWithinBudget(source: string) {
  expect(source.length).toBeLessThanOrEqual(SVG_ICON_MAX_BYTES)
  const started = performance.now()
  const result = sanitizeSvgIcon(source)
  expect(performance.now() - started).toBeLessThan(SANITIZE_BUDGET_MS)
  return result
}

function svgDocument(body: string, viewBox = '0 0 24 24') {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}">${body}</svg>`
}

describe('sanitizeSvgIcon hardening', () => {
  it('stays linear on url( values that never close', () => {
    const result = sanitizeWithinBudget(svgDocument(`<path d="M0 0" fill="url(${LONG_RUN}x"/>`))
    expect(result.ok).toBe(true)
    expect(result.ok && result.svg).not.toContain('fill=')
  })

  it('stays linear on long whitespace runs inside references and the viewBox', () => {
    expect(sanitizeWithinBudget(svgDocument(`${SHAPE}<use href="#a${LONG_RUN}b"/>`)).ok).toBe(true)
    expect(sanitizeWithinBudget(svgDocument(SHAPE, `0${LONG_RUN}0 24 24`)).ok).toBe(true)
  })

  it('keeps quoted and spaced local url() references but not CSS-escaped or non-ASCII ones', () => {
    const kept = sanitizeSvgIcon(
      svgDocument(`<path d="M0 0" fill="url( '#paint' )" clip-path="url(#clip)"/>`),
    )
    expect(kept.ok && kept.svg).toContain(`fill="url( '#paint' )"`)
    expect(kept.ok && kept.svg).toContain('clip-path="url(#clip)"')

    const dropped = sanitizeSvgIcon(
      svgDocument(`<path d="M0 0" fill="url(&#xA0;#a)" stroke="url(#a\\)http://e/x)"/>`),
    )
    expect(dropped.ok && dropped.svg).not.toContain('fill=')
    expect(dropped.ok && dropped.svg).not.toContain('stroke=')
  })

  it.each([
    ['shapes only inside <defs>', '<defs><path d="M0 0h4"/></defs>'],
    ['a path without geometry', '<path/>'],
    ['a path whose geometry named a resource', '<path d="url(http://e)"/>'],
    ['a rect without a height', '<rect width="4"/>'],
    ['a use whose reference was dropped', '<use href="https://e/x.svg#a"/>'],
  ])('rejects an icon that draws nothing: %s', (_label, body) => {
    expect(sanitizeSvgIcon(svgDocument(body))).toEqual({
      ok: false,
      reason: 'The SVG file has no usable shapes.',
    })
  })

  it('accepts a shape drawn through <use> of a definition', () => {
    const result = sanitizeSvgIcon(
      svgDocument('<defs><path id="a" d="M0 0h4"/></defs><use href="#a"/>'),
    )
    expect(result.ok).toBe(true)
  })

  it.each([
    ['hex numbers', '0 0 0x10 24'],
    ['a zero width', '0 0 0 24'],
    ['a negative height', '0 0 24 -1'],
    ['Infinity', '0 0 Infinity 24'],
    ['a trailing decimal point', '0 0 24. 24'],
  ])('rejects a viewBox with %s', (_label, viewBox) => {
    expect(sanitizeSvgIcon(svgDocument(SHAPE, viewBox)).ok).toBe(false)
  })

  it('accepts a viewBox written with exponents and commas, normalized for browsers', () => {
    const result = sanitizeSvgIcon(svgDocument(SHAPE, ' 0, 0,2.4e1 , 24 '))
    expect(result.ok && result.svg).toContain('viewBox="0 0 2.4e1 24"')
  })

  it.each([
    ['repeated commas', '0,,0 24 24'],
    ['a non-breaking space', '0\u00A00 24 24'],
  ])('rejects a viewBox with %s', (_label, viewBox) => {
    expect(sanitizeSvgIcon(svgDocument(SHAPE, viewBox)).ok).toBe(false)
  })

  it('accepts a public DOCTYPE but not one with an internal subset', () => {
    const doctype =
      '<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">'
    expect(sanitizeSvgIcon(`${doctype}${svgDocument(SHAPE)}`).ok).toBe(true)
    expect(sanitizeSvgIcon(`<!DOCTYPE svg [<!ENTITY a "b">]>${svgDocument(SHAPE)}`).ok).toBe(false)
  })

  it('keeps url() references to ids that start with a digit', () => {
    const result = sanitizeSvgIcon(svgDocument('<path d="M0 0" clip-path="url(#1a)"/>'))
    expect(result.ok && result.svg).toContain('clip-path="url(#1a)"')
  })
})
