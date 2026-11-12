import type { Violation } from './violation'

/**
 * Website Astro templates use the shared Button primitive instead of raw `<button>` elements. Lint
 * reads only the script parts of `.astro` files, so this textual check covers the template.
 */
const RAW_BUTTON_PATTERN = /<button\b/g
const ASTRO_FILE = /^website\/src\/.*\.astro$/u
const RAW_BUTTON_OWNERS = new Set(['website/src/components/ui/Button.astro'])

function lineColumnForIndex(text: string, index: number) {
  const before = text.slice(0, index)
  const lineStart = before.lastIndexOf('\n') + 1
  return { line: before.split('\n').length, column: index - lineStart + 1 }
}

export function collectAstroRawButtonViolations(file: string, contents: string) {
  if (!ASTRO_FILE.test(file) || RAW_BUTTON_OWNERS.has(file)) {
    return [] satisfies Violation[]
  }

  return [...contents.matchAll(RAW_BUTTON_PATTERN)].map((match) => {
    const { line, column } = lineColumnForIndex(contents, match.index)
    return {
      detail: `${file}:${line}:${column}`,
      file,
      message: 'Use the shared website Button primitive instead of raw <button> in Astro files.',
    }
  }) satisfies Violation[]
}
