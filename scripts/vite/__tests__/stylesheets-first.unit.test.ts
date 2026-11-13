import { describe, expect, it } from 'vitest'
import { stylesheetsFirst } from '../stylesheets-first'

const BUILT = `<head>
    <title>OpenWaggle</title>
    <script>inline()</script>
    <script type="module" crossorigin src="./assets/index.js"></script>
    <link rel="modulepreload" crossorigin href="./assets/a.js">
    <link rel="modulepreload" crossorigin href="./assets/b.js">
    <link rel="stylesheet" crossorigin href="./assets/index.css">
  </head>`

describe('stylesheetsFirst', () => {
  it('moves every stylesheet ahead of the first module script, keeping the rest in order', () => {
    const html = stylesheetsFirst(BUILT)
    const order = ['inline()', 'index.css', 'index.js', 'a.js', 'b.js'].map((part) =>
      html.indexOf(part),
    )
    expect(order.every((at) => at >= 0)).toBe(true)
    expect([...order].sort((left, right) => left - right)).toEqual(order)
    expect(html.match(/rel="stylesheet"/gu)).toHaveLength(1)
  })

  it('leaves a page without stylesheets or module scripts as it is', () => {
    expect(stylesheetsFirst('<head><title>x</title></head>')).toBe('<head><title>x</title></head>')
  })
})
