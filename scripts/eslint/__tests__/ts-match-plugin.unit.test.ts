import { Linter } from 'eslint'
import tseslint from 'typescript-eslint'
import { describe, expect, it } from 'vitest'
import { tsMatchPlugin } from '../ts-match-plugin'

function lint(code: string, ruleName: string) {
  const linter = new Linter({ configType: 'flat' })
  return linter.verify(code, {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parser: tseslint.parser,
    },
    plugins: {
      'ts-match': tsMatchPlugin,
    },
    rules: {
      [ruleName]: 'error',
    },
  }, { filename: 'src/example.ts' })
}

describe('ts-match ESLint plugin', () => {
  it('reports switch statements as match candidates', () => {
    const messages = lint(
      'switch (status) { case "ready": break; default: break }\n',
      'ts-match/prefer-match-over-switch',
    )

    expect(messages).toHaveLength(1)
    expect(messages.at(0)?.message).toContain('Switch statements are disallowed')
  })

  it('reports else-if chains as match candidates', () => {
    const messages = lint(
      'if (status === "ready") {} else if (status === "idle") {}\n',
      'ts-match/prefer-match-over-else-if',
    )

    expect(messages).toHaveLength(1)
    expect(messages.at(0)?.message).toContain('Else-if chains are disallowed')
  })

  it('allows plain guard clauses', () => {
    const messages = lint(
      'if (!status) { throw new Error("missing") }\nif (status === "ready") {}\n',
      'ts-match/prefer-match-over-else-if',
    )

    expect(messages).toHaveLength(0)
  })
})
