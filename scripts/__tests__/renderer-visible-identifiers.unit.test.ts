import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
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

const REPO_ROOT = findRepoRoot(dirname(fileURLToPath(import.meta.url)))
/**
 * Scanned recursively, and including `.ts`.
 *
 * A non-recursive `.tsx`-only scan of two directories could not see the places user-facing strings
 * actually live: nested component directories, every other feature, and the plain `.ts` modules that
 * hold label maps and command descriptions. It reported green while user-visible copy named the
 * runtime, which is worse than no guard because it implies the opposite.
 */
const RENDERER_UI_DIRECTORIES = [
  'src/renderer/src/features',
  'src/renderer/src/shared/ui',
  'src/shared/types',
]

function readRendererSources() {
  return RENDERER_UI_DIRECTORIES.flatMap((directory) =>
    readdirSync(join(REPO_ROOT, directory), { recursive: true, withFileTypes: true })
      .filter(
        (entry) =>
          entry.isFile() &&
          (entry.name.endsWith('.tsx') || entry.name.endsWith('.ts')) &&
          !entry.name.endsWith('.d.ts') &&
          !join(entry.parentPath, entry.name).includes('__tests__'),
      )
      .map((entry) => ({
        path: join(entry.parentPath, entry.name).replace(`${REPO_ROOT}/`, ''),
        source: readFileSync(join(entry.parentPath, entry.name), 'utf-8'),
      })),
  )
}

/** Strips comments, so an explanatory note naming an identifier is not mistaken for a label. */
function withoutComments(source: string) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

/**
 * The text a user could actually see.
 *
 * Import lines, type declarations and log calls are dropped. A discriminant such as
 * `source === 'pi-ui'` is data, not a label, so scanning every string literal would report those as
 * leaks and the guard would have to be weakened to stay green. Log messages are not user-facing
 * either.
 */
function renderableText(source: string) {
  return withoutComments(source)
    .split('\n')
    .filter((line) => {
      const trimmed = line.trim()
      return (
        !trimmed.startsWith('import ') &&
        !trimmed.startsWith('export type') &&
        !trimmed.startsWith('readonly ') &&
        !/logger\.(?:warn|error|info|debug)\(/.test(trimmed)
      )
    })
    .join('\n')
}

/** JSX text between tags, and the attributes whose values are rendered to the user. */
function visibleLabels(source: string) {
  const text = renderableText(source)
  const jsxText = [...text.matchAll(/>([^<>{}]+)</g)].map((match) => match[1] ?? '')
  const labelAttributes = [
    ...text.matchAll(
      /(?:aria-label|title|placeholder|label|description|emptyText|loadingText)=(?:"([^"]*)"|'([^']*)'|\{'([^']*)'\})/g,
    ),
  ].map((match) => match[1] ?? match[2] ?? match[3] ?? '')
  return [...jsxText, ...labelAttributes].join('\n')
}

describe('no internal identifier is visible in renderer UI', () => {
  const sources = readRendererSources()

  it('scans a meaningful number of components', () => {
    expect(sources.length).toBeGreaterThan(200)
  })

  it.each([
    ['pi-tui-custom', /pi-tui-custom/],
    ['pi-ui', /\bpi-ui\b/],
    ['factoryName', /factoryName/],
  ])('never renders %s', (_label, pattern) => {
    const offenders = sources
      .filter(({ source }) => pattern.test(visibleLabels(source)))
      .map(({ path }) => path)

    expect(offenders).toEqual([])
  })

  it('never renders the word Pi as a product name', () => {
    // Allowed: identifiers such as `piSessionId`. Disallowed: user-facing prose naming the runtime.
    const offenders = sources
      .filter(({ source }) => /\bPi\b(?!\w)/.test(visibleLabels(source)))
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
