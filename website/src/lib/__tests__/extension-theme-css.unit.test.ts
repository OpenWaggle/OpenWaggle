import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { extensionThemeCssVariableDeclarations } from '../../../../packages/extension-sdk/src/ui-stylesheet'

const stylesDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../styles')
const themeCss = readFileSync(path.join(stylesDirectory, 'extension-theme.css'), 'utf8')
const extensionReactCss = readFileSync(
  path.resolve(stylesDirectory, '../../../packages/extension-react/styles.css'),
  'utf8',
)

function ruleBody(css: string, selector: string) {
  const start = css.indexOf(`${selector} {\n`)
  if (start < 0) return undefined
  const bodyStart = start + selector.length + 3
  return css.slice(bodyStart, css.indexOf('\n}', bodyStart))
}

describe('extension catalogue theme projection', () => {
  it('declares exactly the SDK default theme on docs extension roots', () => {
    expect(ruleBody(themeCss, '.prose-docs .ow-extension-root')).toBe(
      extensionThemeCssVariableDeclarations(),
    )
  })

  it('defines every variable the extension-react stylesheet reads', () => {
    const declared = new Set(
      [...themeCss.matchAll(/^\s+(--ow-[a-z0-9-]+):/gmu)].map((match) => match[1]),
    )
    const read = new Set(
      [...extensionReactCss.matchAll(/var\((--ow-[a-z0-9-]+)\)/gu)].map((match) => match[1]),
    )
    expect([...read].filter((name) => !declared.has(name))).toEqual([])
  })

  it('repeats the stylesheet panel and stack layout for roots that carry those classes', () => {
    expect(ruleBody(themeCss, '.prose-docs .ow-extension-root.ow-extension-panel')).toBe(
      ruleBody(extensionReactCss, '.ow-extension-root .ow-extension-panel'),
    )
    expect(ruleBody(themeCss, '.prose-docs .ow-extension-root.ow-extension-stack')).toBe(
      ruleBody(extensionReactCss, '.ow-extension-root .ow-extension-stack'),
    )
  })
})
