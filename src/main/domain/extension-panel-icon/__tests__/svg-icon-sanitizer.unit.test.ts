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

  it('drops every <style> element and style or class attribute', () => {
    const svg = sanitizedSvg(
      svgDocument(
        `<style><![CDATA[.a > path { fill: none }]]></style><style>@font-face { src: "x.woff" }</style><path class="a" style="fill:red" d="M0 0"/>`,
      ),
    )

    expect(svg).toBe(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M0 0"/></svg>',
    )
  })

  it('keeps local url() paint references and drops external ones', () => {
    const svg = sanitizedSvg(
      svgDocument(
        '<path d="M0 0" fill="url(#g)" stroke="url(https://evil.test/p)" mask="url( \'#m\' )"/>',
      ),
    )

    expect(svg).toContain('fill="url(#g)"')
    expect(svg).toContain('mask="url( \'#m\' )"')
    expect(svg).not.toContain('evil.test')
  })

  it.each([
    ['image-set()', 'image-set("https://evil.test/a.png" 1x)'],
    ['-webkit-image-set()', '-webkit-image-set(url(#a) 1x, "https://evil.test/b.png" 2x)'],
    ['image()', 'image("https://evil.test/a.png")'],
    ['cross-fade()', 'cross-fade(url(#a), url(#b))'],
    ['element()', 'element(#a)'],
    ['src()', 'src("https://evil.test/a.svg")'],
    ['bare quoted URL', '"https://evil.test/a.svg"'],
    ['url() after a local reference', 'url(#a) url(https://evil.test/b)'],
    ['escaped url()', 'u\\72l(https://evil.test/a)'],
  ])('drops attribute values that name resources through %s', (_label, value) => {
    const svg = sanitizedSvg(svgDocument(`<path d="M0 0" fill='${value}'/>`))

    expect(svg).toBe(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M0 0"/></svg>',
    )
  })

  it('keeps only the first usable reference when href and xlink:href are both present', () => {
    const svg = sanitizedSvg(
      svgDocument(
        '<defs><path id="a" d="M0 0"/><path id="b" d="M1 1"/></defs><use href="#a" xlink:href="#b"/><use href="https://evil.test/x#a" xlink:href="#b"/>',
        'xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 24 24"',
      ),
    )

    expect(svg).toContain('<use href="#a"/><use href="#b"/>')
  })

  it.each([
    ['only structure', '<g><defs/></g>'],
    ['only dropped elements', '<image href="#a"/><text>Hi</text>'],
    ['empty root', ''],
  ])('rejects an icon without any shape: %s', (_label, body) => {
    expect(sanitizeSvgIcon(svgDocument(body))).toEqual({
      ok: false,
      reason: 'The SVG file has no usable shapes.',
    })
  })

  it('accepts an icon whose only shape is a <use> reference', () => {
    expect(sanitizeSvgIcon(svgDocument('<use href="#a"/>')).ok).toBe(true)
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
    ['control character reference', svgDocument('<path id="&#x1;" d="M0 0"/>')],
    ['NUL character reference', svgDocument('<path id="&#0;" d="M0 0"/>')],
    ['surrogate character reference', svgDocument('<path id="&#xD800;" d="M0 0"/>')],
    ['U+FFFE character reference', svgDocument('<path id="&#xFFFE;" d="M0 0"/>')],
    ['U+FFFF character reference', svgDocument('<path id="&#65535;" d="M0 0"/>')],
    ['out-of-range character reference', svgDocument('<path id="&#x110000;" d="M0 0"/>')],
    ['raw control character', svgDocument('<path id="a\u0001" d="M0 0"/>')],
    ['raw lone surrogate', svgDocument('<path id="a\uD800" d="M0 0"/>')],
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
