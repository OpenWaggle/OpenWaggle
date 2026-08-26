import babelParser from '@babel/eslint-parser'
import { Linter } from 'eslint'
import { describe, expect, it } from 'vitest'
import { openwagglePlugin } from '../openwaggle-plugin'
import { repositoryRelativeRendererFilename } from '../rules/renderer-design-token-guardrails'

const RULE_NAME = 'openwaggle/renderer-design-token-guardrails'
const FILENAME = 'src/renderer/src/features/chat/components/Example.tsx'

function lint(code: string, filename = FILENAME, exemptFiles: readonly string[] = []) {
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
          ecmaFeatures: { jsx: true },
          requireConfigFile: false,
        },
      },
      plugins: { openwaggle: openwagglePlugin },
      rules: {
        [RULE_NAME]: ['error', { exemptFiles }],
      },
    },
    { filename },
  )
}

describe('renderer design-token guardrails', () => {
  it('allows standard utilities and semantic color roles', () => {
    const messages = lint(
      `const classes = 'text-sm p-2 h-8 rounded-md bg-bg text-neutral border-border'`,
    )

    expect(messages).toHaveLength(0)
  })

  it('reports arbitrary values in snapped utility families and CSS properties', () => {
    const messages = lint(
      `const classes = 'hover:text-[13px] -mt-[5px] !-scroll-mt-[7px] min-h-[90vh] rounded-tl-[5px] [width:17px]'`,
    )

    expect(messages).toHaveLength(6)
    expect(messages.every((message) => message.message.includes('Tailwind v4 standard'))).toBe(true)
  })

  it('allows arbitrary values outside the snapped families', () => {
    const messages = lint(
      `const classes = "grid-cols-[1fr_2fr] content-[''] bg-[color-mix(in_oklab,var(--color-bg),transparent)]"`,
    )

    expect(messages).toHaveLength(0)
  })

  it('reports raw hex in JSX, plain values, and template elements', () => {
    const messages = lint(
      'const color = "#fff"\nconst style = { color: "#11223344" }\nconst view = <div className="bg-[#ABCDEF]" />\nconst template = `text-[#1234]`',
    )

    expect(messages.filter((message) => message.message.includes('raw color'))).toHaveLength(4)
  })

  it('does not report comments as raw colors', () => {
    const messages = lint('// Legacy example: #fff\nconst value = 1')

    expect(messages).toHaveLength(0)
  })

  it('allows standalone numeric references without allowing numeric utility colors', () => {
    const testFilename = 'src/renderer/src/features/chat/components/Example.component.test.tsx'
    const messages = lint(`const issueLabel = '#113'\nconst classes = 'bg-[#113]'`, testFilename)

    expect(messages).toHaveLength(1)
    expect(messages.at(0)?.message).toContain('raw color')
    expect(lint(`const color = '#113'`)).toHaveLength(1)
  })

  it('reports Tailwind palette colors through variants and opacity modifiers', () => {
    const messages = lint(
      `const classes = 'hover:bg-red-500 dark:text-amber-300 border-t-zinc-400/60 ring-white/40 from-violet-500/20'`,
    )

    expect(messages).toHaveLength(5)
    expect(messages.every((message) => message.message.includes('semantic color role'))).toBe(true)
  })

  it('distinguishes the semantic neutral role from the Tailwind neutral palette', () => {
    expect(lint(`const classes = 'text-neutral'`)).toHaveLength(0)
    expect(lint(`const classes = 'text-neutral-500'`)).toHaveLength(1)
  })

  it('suppresses known violating files and reports stale exemptions', () => {
    expect(lint(`const classes = 'text-[13px]'`, FILENAME, [FILENAME])).toHaveLength(0)

    const staleMessages = lint(`const classes = 'text-sm'`, FILENAME, [FILENAME])
    expect(staleMessages).toHaveLength(1)
    expect(staleMessages.at(0)?.message).toContain('no longer violates')
  })

  it('normalizes absolute and Windows renderer filenames for exemptions', () => {
    const posixFilename = `/repo/${FILENAME}`
    const windowsFilename = `C:\\repo\\${FILENAME.replaceAll('/', '\\')}`

    expect(repositoryRelativeRendererFilename(posixFilename)).toBe(FILENAME)
    expect(repositoryRelativeRendererFilename(windowsFilename)).toBe(FILENAME)
  })
})
