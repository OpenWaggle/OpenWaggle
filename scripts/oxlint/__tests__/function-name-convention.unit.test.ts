import { describe, expect, it } from 'vitest'
import { openwagglePlugin } from '../openwaggle-plugin.ts'
import { lintWithRule } from './lint-rule.ts'

function lint(code: string) {
  return lintWithRule(
    openwagglePlugin,
    'openwaggle/function-name-convention',
    code,
    'src/main/example.ts',
  )
}

describe('function-name-convention', () => {
  it('reports invalid function names and overlong function-valued variable names', () => {
    const messages = lint(`
function snake_case() {}
const ${'overlongFunctionName'.repeat(4)} = () => undefined
`)

    expect(messages).toHaveLength(2)
    expect(messages.every((message) => message.message.includes('camelCase or PascalCase'))).toBe(
      true,
    )
  })

  it('allows concise camelCase and PascalCase function names', () => {
    const messages = lint(
      'function loadSession() {}\nfunction $createNode() {}\nconst ExtensionPanel = () => null\n',
    )

    expect(messages).toHaveLength(0)
  })
})
