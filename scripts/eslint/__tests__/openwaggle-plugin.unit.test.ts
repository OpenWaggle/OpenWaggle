import { Linter } from 'eslint'
import tseslint from 'typescript-eslint'
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
        parser: tseslint.parser,
        parserOptions: {
          ecmaFeatures: { jsx: true },
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

describe('OpenWaggle ESLint plugin', () => {
  it('reports architecture ignore comments so enforcement cannot be bypassed', () => {
    const messages = lint(
      '// biome-ignore lint/suspicious/noExplicitAny: forbidden\nconst value = 1\n',
      'openwaggle/no-architecture-ignore-comments',
      'src/renderer/src/features/chat/lib/example.ts',
    )

    expect(messages).toHaveLength(1)
    expect(messages.at(0)?.message).toContain('Architecture enforcement must not be bypassed')
  })

  it('reports SAFETY comments so manual trust annotations cannot bypass review', () => {
    const messages = lint(
      '// SAFETY: trust this unchecked value\nconst value = 1\n',
      'openwaggle/no-architecture-ignore-comments',
      'src/main/example.ts',
    )

    expect(messages).toHaveLength(1)
    expect(messages.at(0)?.message).toContain('Architecture enforcement must not be bypassed')
  })

  it('reports cross-feature internal renderer imports', () => {
    const messages = lint(
      "import { useSettings } from '@/features/settings/hooks/useSettings'\nexport const value = useSettings\n",
      'openwaggle/renderer-import-boundaries',
      'src/renderer/src/features/chat/lib/example.ts',
    )

    expect(messages).toHaveLength(1)
    expect(messages.at(0)?.message).toContain('Invalid renderer import boundary')
  })

  it('reports components with too many JSX props but ignores intrinsic elements', () => {
    const messages = lint(
      'const View = () => <><Panel a={1} b={2} c={3} /><div a={1} b={2} c={3} /></>\n',
      'openwaggle/jsx-max-props',
      'src/renderer/src/features/chat/components/View.tsx',
      [{ maximum: 2 }],
    )

    expect(messages).toHaveLength(1)
    expect(messages.at(0)?.message).toContain('JSX elements should receive at most 2 props')
  })

  it('ignores shared UI primitives in JSX prop-count checks', () => {
    const messages = lint(
      '<Button a={1} b={2} c={3} d={4} />\n',
      'openwaggle/jsx-max-props',
      'src/renderer/src/features/chat/components/View.tsx',
      [{ maximum: 2 }],
    )

    expect(messages).toHaveLength(0)
  })

  it('reports raw renderer buttons outside shared primitive implementations', () => {
    const messages = lint(
      '<button type="button">Save</button>\n',
      'openwaggle/no-raw-renderer-buttons',
      'src/renderer/src/features/chat/components/View.tsx',
    )

    expect(messages).toHaveLength(1)
    expect(messages.at(0)?.message).toContain('Use the shared Button primitive')
  })

  it('allows raw renderer buttons inside the shared Button primitive', () => {
    const messages = lint(
      '<button type="button">Save</button>\n',
      'openwaggle/no-raw-renderer-buttons',
      'src/renderer/src/shared/ui/Button.tsx',
    )

    expect(messages).toHaveLength(0)
  })

  it('reports Shoehorn imports outside tests', () => {
    const messages = lint(
      "import { fromPartial } from '@total-typescript/shoehorn'\nexport const value = fromPartial\n",
      'openwaggle/no-shoehorn-outside-tests',
      'src/main/application/example.ts',
    )

    expect(messages).toHaveLength(1)
    expect(messages.at(0)?.message).toContain('test-only escape hatch')
  })

  it('allows Shoehorn imports in tests', () => {
    const messages = lint(
      "import { fromPartial } from '@total-typescript/shoehorn'\nexport const value = fromPartial\n",
      'openwaggle/no-shoehorn-outside-tests',
      'src/main/application/__tests__/example.unit.test.ts',
    )

    expect(messages).toHaveLength(0)
  })

  it('reports React legacy component patterns', () => {
    const messages = lint(
      "import React, { forwardRef, memo } from 'react'\nconst View: React.FC = () => null\nconst Forwarded = forwardRef(() => null)\nconst Memoized = memo(View)\nexport const values = [Forwarded, Memoized]\n",
      'openwaggle/no-react-legacy-patterns',
      'src/renderer/src/features/chat/components/View.tsx',
    )

    expect(messages).toHaveLength(5)
    expect(messages.map((message) => message.message)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Do not use React.FC'),
        expect.stringContaining('Do not use forwardRef'),
        expect.stringContaining('Do not use React.memo'),
      ]),
    )
  })

  it('reports empty infinite for loops', () => {
    const messages = lint(
      'for (;;) {\n  break\n}\n',
      'openwaggle/no-infinite-for-loop',
      'src/main/example.ts',
    )

    expect(messages).toHaveLength(1)
    expect(messages.at(0)?.message).toContain('Do not use `for (;;)` loops')
  })

  it('reports source tests outside __tests__ directories', () => {
    const messages = lint(
      'import { describe } from "vitest"\ndescribe("example", () => {})\n',
      'openwaggle/test-colocation',
      'src/main/application/example.unit.test.ts',
    )

    expect(messages).toHaveLength(1)
    expect(messages.at(0)?.message).toContain('Source tests must live under a local __tests__ directory')
  })

  it('allows source tests under __tests__ directories', () => {
    const messages = lint(
      'import { describe } from "vitest"\ndescribe("example", () => {})\n',
      'openwaggle/test-colocation',
      'src/main/application/__tests__/example.unit.test.ts',
    )

    expect(messages).toHaveLength(0)
  })

  it('reports inline import types outside declaration and test files', () => {
    const messages = lint(
      "type Session = import('@shared/types/ipc').Session\n",
      'openwaggle/no-inline-import-types',
      'src/renderer/src/features/chat/lib/session.ts',
    )

    expect(messages).toHaveLength(1)
    expect(messages.at(0)?.message).toContain('Inline import() types are disallowed')
  })

  it('reports inline magic numbers while allowing named constants', () => {
    const messages = lint(
      'const DELAY_MS = 250\nconst timeout = 500\nconst count = -2\n',
      'openwaggle/no-inline-magic-numbers',
      'src/renderer/src/features/chat/lib/timing.ts',
    )

    expect(messages).toHaveLength(2)
    expect(messages.at(0)?.message).toContain('500')
    expect(messages.at(1)?.message).toContain('-2')
  })

  it('reports main-process architecture boundary violations', () => {
    const messages = lint(
      "import { SessionManager } from '@mariozechner/pi-coding-agent'\nexport const value = SessionManager\n",
      'openwaggle/main-architecture-boundaries',
      'src/main/application/example.ts',
    )

    expect(messages).toHaveLength(1)
    expect(messages.at(0)?.message).toContain('Pi SDK imports are confined')
  })

  it('allows Pi SDK imports inside dedicated Pi packages', () => {
    const messages = lint(
      "import { SessionManager } from '@mariozechner/pi-coding-agent'\nexport const value = SessionManager\n",
      'openwaggle/main-architecture-boundaries',
      'packages/pi-waggle/src/extension.ts',
    )

    expect(messages).toHaveLength(0)
  })

  it('reports Pi SDK imports inside portable Waggle core', () => {
    const messages = lint(
      "import { SessionManager } from '@mariozechner/pi-coding-agent'\nexport const value = SessionManager\n",
      'openwaggle/main-architecture-boundaries',
      'packages/waggle-core/src/config.ts',
    )

    expect(messages).toHaveLength(1)
    expect(messages.at(0)?.message).toContain('packages/waggle-core must stay portable')
  })

  it('reports OpenWaggle app imports inside portable Waggle core', () => {
    const messages = lint(
      "import { waggleConfigSchema } from '@shared/schemas/waggle'\nexport const value = waggleConfigSchema\n",
      'openwaggle/main-architecture-boundaries',
      'packages/waggle-core/src/config.ts',
    )

    expect(messages).toHaveLength(1)
    expect(messages.at(0)?.message).toContain('must not import OpenWaggle app modules')
  })

  it('reports OpenWaggle app imports inside pi-waggle', () => {
    const messages = lint(
      "import { waggleConfigSchema } from '@shared/schemas/waggle'\nexport const value = waggleConfigSchema\n",
      'openwaggle/main-architecture-boundaries',
      'packages/pi-waggle/src/extension.ts',
    )

    expect(messages).toHaveLength(1)
    expect(messages.at(0)?.message).toContain('packages/pi-waggle must stay reusable')
  })

  it('reports renderer imports of pi-waggle adapter package surfaces', () => {
    const messages = lint(
      "import { PI_WAGGLE_TURN_CUSTOM_TYPE } from '@openwaggle/pi-waggle/protocol'\nexport const value = PI_WAGGLE_TURN_CUSTOM_TYPE\n",
      'openwaggle/main-architecture-boundaries',
      'src/renderer/src/features/chat/lib/example.ts',
    )

    expect(messages).toHaveLength(1)
    expect(messages.at(0)?.message).toContain('renderer/shared code may not import pi-waggle')
  })

  it('reports desktop Pi adapter imports of the UI-heavy pi-waggle package root', () => {
    const messages = lint(
      "import { createPiWaggleExtension } from '@openwaggle/pi-waggle'\nexport const value = createPiWaggleExtension\n",
      'openwaggle/main-architecture-boundaries',
      'src/main/adapters/pi/example.ts',
    )

    expect(messages).toHaveLength(1)
    expect(messages.at(0)?.message).toContain('narrow @openwaggle/pi-waggle subpaths')
  })

  it('allows Pi SDK imports inside the Pi adapter boundary', () => {
    const messages = lint(
      "import { SessionManager } from '@mariozechner/pi-coding-agent'\nexport const value = SessionManager\n",
      'openwaggle/main-architecture-boundaries',
      'src/main/adapters/pi/example.ts',
    )

    expect(messages).toHaveLength(0)
  })

  it('reports raw Astro buttons through the ESLint processor', () => {
    const messages = lintAstro(
      '---\nconst label = "Open"\n---\n<button type="button">{label}</button>\n',
      'website/src/components/Header.astro',
    )

    expect(messages).toHaveLength(1)
    expect(messages.at(0)?.ruleId).toBe('openwaggle/no-raw-astro-buttons')
  })

  it('allows raw Astro buttons inside the website Button primitive', () => {
    const messages = lintAstro(
      '---\nconst label = "Open"\n---\n<button type="button">{label}</button>\n',
      'website/src/components/ui/Button.astro',
    )

    expect(messages).toHaveLength(0)
  })
})
