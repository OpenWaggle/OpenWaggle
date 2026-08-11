import babelParser from '@babel/eslint-parser'
import { Linter } from 'eslint'
import { describe, expect, it } from 'vitest'
import { openwagglePlugin } from '../openwaggle-plugin'

function lint(code: string) {
  const linter = new Linter({ configType: 'flat' })
  return linter.verify(
    code,
    {
      files: ['**/*.{ts,tsx}'],
      languageOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        parser: babelParser,
        parserOptions: {
          babelOptions: { parserOpts: { plugins: ['typescript', 'jsx'] } },
          requireConfigFile: false,
        },
      },
      plugins: { openwaggle: openwagglePlugin },
      rules: { 'openwaggle/function-name-convention': 'error' },
    },
    { filename: 'src/main/example.ts' },
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
