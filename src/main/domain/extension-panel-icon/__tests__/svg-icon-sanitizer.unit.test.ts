import { describe, expect, it } from 'vitest'
import { SVG_ICON_MAX_BYTES, sanitizeSvgIcon } from '../svg-icon-sanitizer'

const SHAPE = '<path d="M2 9h20"/>'

function svgDocument(
  body: string,
  rootAttributes = 'xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"',
) {
  return `<svg ${rootAttributes}>${body}</svg>`
}

function sanitizedSvg(source: string) {
  const result = sanitizeSvgIcon(source)
  if (!result.ok) throw new Error(`Expected a sanitized icon, got: ${result.reason}`)
  return result.svg
}

describe('sanitizeSvgIcon', () => {
  it('keeps shapes and produces standalone markup with the SVG namespace', () => {
    expect(sanitizedSvg(svgDocument(SHAPE))).toBe(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M2 9h20"/></svg>',
    )
  })

  it('accepts an XML declaration, comments and editor metadata', () => {
    const svg = sanitizedSvg(
      `<?xml version="1.0" encoding="UTF-8"?>\n<!-- exported -->\n${svgDocument(
        `<title>Ticket</title><metadata><rdf:RDF/></metadata><sodipodi:namedview/>${SHAPE}`,
      )}`,
    )

    expect(svg).toBe(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M2 9h20"/></svg>',
    )
  })

  it('derives a viewBox from numeric width and height', () => {
    const svg = sanitizedSvg(svgDocument(SHAPE, 'width="16px" height="16"'))

    expect(svg).toContain('viewBox="0 0 16 16"')
  })

  it('rejects an icon without a viewBox or numeric size', () => {
    expect(sanitizeSvgIcon(svgDocument(SHAPE, 'width="100%"'))).toMatchObject({ ok: false })
  })

  it.each([
    ['script', `<script>alert(1)</script>${SHAPE}`],
    ['foreignObject', `<foreignObject><div>x</div></foreignObject>${SHAPE}`],
    ['nested script', `<g><g><script href="x.js"/></g></g>${SHAPE}`],
  ])('rejects %s elements', (_label, body) => {
    const result = sanitizeSvgIcon(svgDocument(body))

    expect(result.ok).toBe(false)
    expect(result.ok ? '' : result.reason).toMatch(/<(script|foreignObject)>/u)
  })

  it('strips event handler attributes', () => {
    const svg = sanitizedSvg(
      svgDocument(
        '<path d="M0 0" onclick="alert(1)" onload="x()" ONMOUSEOVER="y()"/>',
        'viewBox="0 0 24 24" onload="boot()"',
      ),
    )

    expect(svg).not.toMatch(/on[a-z]+=/iu)
    expect(svg).toContain('<path d="M0 0"/>')
  })

  it('strips external href references and keeps local fragments', () => {
    const svg = sanitizedSvg(
      svgDocument(
        '<defs><path id="a" d="M0 0"/></defs><use xlink:href="#a"/><use href="https://evil.test/x.svg#a"/><use xlink:href="data:image/svg+xml,x"/>',
        'xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 24 24"',
      ),
    )

    expect(svg).toContain('<use href="#a"/>')
    expect(svg).not.toContain('evil.test')
    expect(svg).not.toContain('data:')
    expect(svg).not.toContain('xlink')
    expect(svg.match(/<use/gu)).toHaveLength(3)
  })

  it('drops image and animation elements that could load or rewrite references', () => {
    const svg = sanitizedSvg(
      svgDocument(
        `<image href="https://evil.test/a.png"/><set attributeName="href" to="https://evil.test"/>${SHAPE}`,
      ),
    )

    expect(svg).not.toContain('image')
    expect(svg).not.toContain('set')
  })

  it('drops <style> elements that load resources and keeps plain CSS', () => {
    const external = sanitizedSvg(
      svgDocument(`<style>path { fill: url(https://evil.test/a.svg#p) }</style>${SHAPE}`),
    )
    const imported = sanitizedSvg(svgDocument(`<style>@import "x.css";</style>${SHAPE}`))
    const escaped = sanitizedSvg(svgDocument(`<style>path { fill: u\\72l(x) }</style>${SHAPE}`))
    const plain = sanitizedSvg(
      svgDocument(`<style><![CDATA[.a > path { fill: none }]]></style>${SHAPE}`),
    )

    expect(external).not.toContain('<style')
    expect(imported).not.toContain('<style')
    expect(escaped).not.toContain('<style')
    expect(plain).toContain('<style>.a &gt; path { fill: none }</style>')
  })

  it('keeps local url() paint references and drops external ones', () => {
    const svg = sanitizedSvg(
      svgDocument(
        '<path d="M0 0" fill="url(#g)" stroke="url(https://evil.test/p)" style="fill:url(\'https://evil.test\')"/>',
      ),
    )

    expect(svg).toContain('fill="url(#g)"')
    expect(svg).not.toContain('evil.test')
  })

  it('escapes attribute values when serializing', () => {
    const svg = sanitizedSvg(svgDocument('<path id="a&quot;b&lt;" d="M0 0"/>'))

    expect(svg).toContain('id="a&quot;b&lt;"')
  })

  it.each([
    ['DOCTYPE with entities', `<!DOCTYPE svg [<!ENTITY x "y">]>${svgDocument(SHAPE)}`],
    ['mismatched tags', '<svg viewBox="0 0 24 24"><g></svg>'],
    ['multiple roots', `${svgDocument(SHAPE)}${svgDocument(SHAPE)}`],
    ['unknown entity', svgDocument('<path d="&x;"/>')],
    ['malformed numeric reference', svgDocument('<path d="&#12x;"/>')],
    ['unquoted attribute', '<svg viewBox=0><path/></svg>'],
    ['non-svg root', '<html><body/></html>'],
    ['text only', 'not an svg'],
  ])('rejects malformed input: %s', (_label, source) => {
    expect(sanitizeSvgIcon(source).ok).toBe(false)
  })

  it('rejects oversized files', () => {
    const padding = `<!--${'x'.repeat(SVG_ICON_MAX_BYTES)}-->`
    const result = sanitizeSvgIcon(svgDocument(`${padding}${SHAPE}`))

    expect(result).toEqual({ ok: false, reason: expect.stringContaining('larger than') })
  })

  it('rejects deeply nested documents', () => {
    const depth = 40
    const body = `${'<g>'.repeat(depth)}${SHAPE}${'</g>'.repeat(depth)}`

    expect(sanitizeSvgIcon(svgDocument(body)).ok).toBe(false)
  })
})
