import { Linter } from 'eslint'
import babelParser from '@babel/eslint-parser'
import { describe, expect, it } from 'vitest'
import { openwagglePlugin } from '../openwaggle-plugin'

function lint(
  code: string,
  ruleName: string,
  filename: string,
  options: readonly unknown[] = [],
) {
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
          babelOptions: {
            parserOpts: {
              plugins: ['typescript', 'jsx'],
            },
          },
          ecmaFeatures: { jsx: true },
          requireConfigFile: false,
        },
      },
      plugins: {
        openwaggle: openwagglePlugin,
      },
      rules: {
        [ruleName]: ['error', ...options],
      },
    },
    { filename },
  )
}

function lintAstro(code: string, filename: string) {
  const linter = new Linter({ configType: 'flat' })
  return linter.verify(
    code,
    {
      files: ['**/*.astro'],
      plugins: {
        openwaggle: openwagglePlugin,
      },
      processor: 'openwaggle/astro-template',
    },
    { filename },
  )
}

describe('main-process layer boundaries', () => {
  it('reports an adapter importing from the IPC layer', () => {
    /*
     * The rule was documented in prose - a Pi adapter even says so in a comment - but unenforced, and
     * an adapter did import an IPC module that contained no handler at all. Adding it immediately
     * caught a second violation in a Pi adapter test.
     */
    const messages = lint(
      "import { runGit } from '../../ipc/git/shared'\nexport const value = runGit\n",
      'openwaggle/main-architecture-boundaries',
      'src/main/adapters/git/example.ts',
    )

    expect(messages).toHaveLength(1)
    expect(messages.at(0)?.message).toContain('Adapters must not depend on IPC handlers')
  })

  it('allows an adapter importing from services, which is the intended direction', () => {
    const messages = lint(
      "import { helper } from '../../services/git/example'\nexport const value = helper\n",
      'openwaggle/main-architecture-boundaries',
      'src/main/adapters/git/example.ts',
    )

    expect(messages).toHaveLength(0)
  })

  it('allows an IPC handler importing from adapters', () => {
    const messages = lint(
      "import { runGit } from '../../adapters/git/run-git'\nexport const value = runGit\n",
      'openwaggle/main-architecture-boundaries',
      'src/main/ipc/git/example.ts',
    )

    expect(messages).toHaveLength(0)
  })
})
