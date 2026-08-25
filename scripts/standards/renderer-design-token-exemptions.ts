import { readFileSync } from 'node:fs'
import type { Violation } from './violation'

const EXEMPTIONS_URL = new URL('../renderer-design-token-exemptions.json', import.meta.url)
const EXEMPTIONS_FILE = 'scripts/renderer-design-token-exemptions.json'
const RENDERER_SOURCE_FILE = /^src\/renderer\/src\/.+\.tsx?$/u
const IGNORED_RENDERER_FILES = new Set([
  'src/renderer/src/routeTree.gen.ts',
  'src/renderer/src/vite-env.d.ts',
])

export function readRendererDesignTokenExemptions() {
  const parsed: unknown = JSON.parse(readFileSync(EXEMPTIONS_URL, 'utf8'))
  if (!Array.isArray(parsed) || !parsed.every((entry) => typeof entry === 'string')) {
    throw new Error(`${EXEMPTIONS_FILE} must contain a JSON array of file paths`)
  }

  return parsed
}

export function collectRendererDesignTokenExemptionViolations(
  repositoryFiles: ReadonlySet<string>,
  exemptions: readonly string[],
): readonly Violation[] {
  const violations: Violation[] = []
  const sorted = [...exemptions].sort()

  if (new Set(exemptions).size !== exemptions.length) {
    violations.push({
      file: EXEMPTIONS_FILE,
      message: 'Renderer design-token exemptions must be unique.',
    })
  }

  if (exemptions.some((entry, index) => entry !== sorted[index])) {
    violations.push({
      file: EXEMPTIONS_FILE,
      message: 'Renderer design-token exemptions must be sorted.',
    })
  }

  for (const exemption of exemptions) {
    if (
      exemption.includes('\\') ||
      exemption.startsWith('/') ||
      !RENDERER_SOURCE_FILE.test(exemption)
    ) {
      violations.push({
        file: EXEMPTIONS_FILE,
        message: 'Renderer design-token exemptions must be repository-relative renderer TS/TSX paths.',
        detail: exemption,
      })
      continue
    }

    if (IGNORED_RENDERER_FILES.has(exemption)) {
      violations.push({
        file: EXEMPTIONS_FILE,
        message: 'ESLint-ignored generated files cannot be design-token exemptions.',
        detail: exemption,
      })
      continue
    }

    if (!repositoryFiles.has(exemption)) {
      violations.push({
        file: EXEMPTIONS_FILE,
        message: 'Remove missing renderer design-token exemption.',
        detail: exemption,
      })
    }
  }

  return violations
}
