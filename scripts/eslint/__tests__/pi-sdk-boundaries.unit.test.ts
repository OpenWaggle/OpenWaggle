import { Linter } from 'eslint'
import babelParser from '@babel/eslint-parser'
import { describe, expect, it } from 'vitest'
import { openwagglePlugin } from '../openwaggle-plugin'

function lintBoundaries(code: string, filename: string) {
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
        'openwaggle/main-architecture-boundaries': 'error',
      },
    },
    { filename },
  )
}

/* Every Pi SDK package, not only pi-coding-agent, stays inside the Pi adapter boundary. */
describe('Pi SDK import boundary', () => {
  it.each([
    ["import { complete } from '@earendil-works/pi-ai'", 'src/main/application/example.ts'],
    ["import type { Model } from '@earendil-works/pi-ai'", 'src/shared/types/example.ts'],
    ["import { McpClient } from '@earendil-works/pi-mcp'", 'src/main/adapters/mcp/example.ts'],
    ["import { createCodemode } from '@earendil-works/pi-codemode'", 'src/main/services/example.ts'],
    ["import type { Agent } from '@earendil-works/pi-agent-core'", 'src/renderer/src/example.ts'],
    ["import { Text } from '@earendil-works/pi-tui/components'", 'src/main/ipc/example.ts'],
  ])('reports every Pi package outside the Pi adapter: %s in %s', (source, filename) => {
    const messages = lintBoundaries(
      `${source}\nexport const value = 1\n`,
      filename,
    )

    expect(messages).toHaveLength(1)
    expect(messages.at(0)?.message).toContain('Pi SDK imports are confined')
  })

  it.each([
    "import type { Model } from '@earendil-works/pi-ai'",
    "import { McpClient } from '@earendil-works/pi-mcp'",
  ])('allows %s inside the Pi adapter boundary', (source) => {
    const messages = lintBoundaries(
      `${source}\nexport const value = 1\n`,
      'src/main/adapters/pi/example.ts',
    )

    expect(messages).toHaveLength(0)
  })

  it('reports any Pi package inside portable Waggle core', () => {
    const messages = lintBoundaries(
      "import type { Model } from '@earendil-works/pi-ai'\nexport const value = 1\n",
      'packages/waggle-core/src/config.ts',
    )

    expect(messages).toHaveLength(1)
    expect(messages.at(0)?.message).toContain('packages/waggle-core must stay portable')
  })

  it('does not treat other @earendil-works packages as Pi packages', () => {
    const messages = lintBoundaries(
      "import { chord } from '@earendil-works/chord'\nexport const value = chord\n",
      'src/main/application/example.ts',
    )

    expect(messages).toHaveLength(0)
  })

  it.each([
    ["const pi = await import('@earendil-works/pi-ai')", 'dynamic import()'],
    ["type Mcp = typeof import('@earendil-works/pi-mcp')", 'typeof import()'],
    ["type Run = import('@earendil-works/pi-codemode').Run", 'an import() type'],
    ["const tui = require('@earendil-works/pi-tui')", 'a literal require()'],
    ['const pi = await import(`@earendil-works/pi-ai`)', 'a template-literal import()'],
    ['const tui = require(`@earendil-works/pi-tui`)', 'a template-literal require()'],
  ])('reports %s (%s) outside the Pi adapter', (source) => {
    const messages = lintBoundaries(`${source}\nexport const value = 1\n`, 'src/main/application/example.ts')

    expect(messages).toHaveLength(1)
    expect(messages.at(0)?.message).toContain('Pi SDK imports are confined')
  })

  it.each([
    "const pi = await import('@earendil-works/pi-ai')",
    "type Mcp = typeof import('@earendil-works/pi-mcp')",
    "const tui = require('@earendil-works/pi-tui')",
  ])('allows %s inside the Pi adapter', (source) => {
    expect(
      lintBoundaries(`${source}\nexport const value = 1\n`, 'src/main/adapters/pi/example.ts'),
    ).toHaveLength(0)
  })

  it('ignores a require() or import() whose specifier is not a literal', () => {
    const messages = lintBoundaries(
      "const name = '@earendil-works/pi-ai'\nconst a = require(name)\nconst b = await import(name)\nexport const value = [a, b]\n",
      'src/main/application/example.ts',
    )

    expect(messages).toHaveLength(0)
  })

  it('ignores a template-literal import() whose specifier is computed', () => {
    const messages = lintBoundaries(
      "const pkg = 'pi-ai'\nconst pi = await import(`@earendil-works/${pkg}`)\nexport const value = pi\n",
      'src/main/application/example.ts',
    )

    expect(messages).toHaveLength(0)
  })

  it('reports a dynamic Pi import inside portable Waggle core', () => {
    const messages = lintBoundaries(
      "const pi = await import('@earendil-works/pi-ai')\nexport const value = pi\n",
      'packages/waggle-core/src/config.ts',
    )

    expect(messages).toHaveLength(1)
    expect(messages.at(0)?.message).toContain('packages/waggle-core must stay portable')
  })

  it('lets development scripts load Pi dynamically, and still checks their static imports', () => {
    const dynamic = "const pi = await import('@earendil-works/pi-ai/providers/all')\nexport const value = pi\n"
    const declared = "import { SessionManager } from '@earendil-works/pi-coding-agent'\nexport const value = SessionManager\n"

    expect(lintBoundaries(dynamic, 'scripts/generate-catalog.ts')).toHaveLength(0)
    expect(lintBoundaries(declared, 'scripts/generate-catalog.ts')).toHaveLength(1)
  })
})
