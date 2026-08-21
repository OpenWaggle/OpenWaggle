import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Guards the contract that no internal identifier reaches a visible label.
 *
 * Deliberately a source scan rather than a render assertion. The previous guards used
 * `queryByText('pi-tui-custom')`, which matches only a text node whose entire content equals that
 * string, so restoring a label like `Custom interaction · pi-tui-custom` would have left them green.
 * Scanning the source catches the identifier wherever it is interpolated.
 */

function findRepoRoot(start: string) {
  let current = start
  while (!existsSync(join(current, 'pnpm-workspace.yaml'))) {
    const parent = dirname(current)
    if (parent === current) throw new Error('Could not locate the repository root')
    current = parent
  }
  return current
}

const REPO_ROOT = findRepoRoot(import.meta.dirname)
const RENDERER_UI_DIRECTORIES = [
  'src/renderer/src/features/chat/components',
  'src/renderer/src/features/extensions/components',
]

function readRendererSources() {
  return RENDERER_UI_DIRECTORIES.flatMap((directory) =>
    readdirSync(join(REPO_ROOT, directory), { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.tsx'))
      .map((entry) => ({
        path: join(directory, entry.name),
        source: readFileSync(join(REPO_ROOT, directory, entry.name), 'utf-8'),
      })),
  )
}

/** Strips comments, so an explanatory note naming an identifier is not mistaken for a label. */
function withoutComments(source: string) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

/** JSX text and string literals, which is where a visible label would live. */
function renderableText(source: string) {
  const withoutImports = withoutComments(source)
    .split('\n')
    .filter((line) => !line.trim().startsWith('import '))
    .join('\n')
  return withoutImports
}

describe('no internal identifier is visible in renderer UI', () => {
  const sources = readRendererSources()

  it('scans a meaningful number of components', () => {
    expect(sources.length).toBeGreaterThan(10)
  })

  it.each([
    ['pi-tui-custom', /['"`>][^'"`<]*pi-tui-custom/],
    ['pi-ui', /['"`>][^'"`<]*\bpi-ui\b/],
    ['factoryName', /factoryName/],
  ])('never renders %s', (_label, pattern) => {
    const offenders = sources
      .filter(({ source }) => pattern.test(renderableText(source)))
      .map(({ path }) => path)

    expect(offenders).toEqual([])
  })

  it('never renders the word Pi as a product name', () => {
    // Allowed: identifiers such as `piSessionId`. Disallowed: user-facing prose naming the runtime.
    const offenders = sources
      .filter(({ source }) => /(?:>|["'`])[^<"'`]*\bPi\b(?!\w)/.test(renderableText(source)))
      .map(({ path }) => path)

    expect(offenders).toEqual([])
  })

  it('never renders a raw interaction id or lifecycle state token', () => {
    const offenders = sources
      .filter(({ source }) => {
        const text = renderableText(source)
        return /\{interaction\.id\}/.test(text) || /\{interaction\.state\}/.test(text)
      })
      .map(({ path }) => path)

    expect(offenders).toEqual([])
  })

  it('never renders a raw interaction kind discriminant', () => {
    const offenders = sources
      .filter(({ source }) => /\{interaction\.kind\}/.test(renderableText(source)))
      .map(({ path }) => path)

    expect(offenders).toEqual([])
  })
})
