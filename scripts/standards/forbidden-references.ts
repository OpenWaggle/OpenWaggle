import type { Violation } from '../check-repository-standards'

const legacyAgentFile = [['CLA', 'UDE'].join(''), 'md'].join('.')
const legacyAgentDirectory = ['.', 'claude'].join('')
const legacyLearningsName = ['learn', 'ings'].join('')
const legacyLessonsName = ['less', 'ons'].join('')
const legacyLearningsFile = ['docs', [legacyLearningsName, 'md'].join('.')].join('/')
const legacyLessonsFile = ['docs', [legacyLessonsName, 'md'].join('.')].join('/')
const legacyLearningsAlias = [legacyLearningsName.toUpperCase(), 'md'].join('.')
const legacyLessonsAlias = [legacyLessonsName.toUpperCase(), 'md'].join('.')
const legacyVendorRuntime = ['Claude', 'Code'].join(' ')

const forbiddenReferences: string[] = [
  legacyAgentFile,
  legacyAgentDirectory,
  legacyLearningsFile,
  legacyLessonsFile,
  legacyLearningsAlias,
  legacyLessonsAlias,
  legacyVendorRuntime,
]

/**
 * The token benchmark must name the agents it compares, including the legacy
 * vendor runtime, or the comparison is unverifiable. These paths report
 * measured facts about other products; they carry no legacy configuration.
 */
const forbiddenReferenceExemptFiles: string[] = [
  'MEMORY.md',
  'scripts/benchmark-docker/inside.sh',
  // results/ is untracked raw evidence; the curated copy is exempt below.
  'scripts/benchmark-docker/parse-results.py',
  'scripts/benchmark-docker/results/results.json',
  'scripts/benchmark-first-turn-tokens.ts',
  'scripts/benchmark-report-shared.ts',
  'website/src/content/docs/using-openwaggle/token-benchmarks.mdx',
  'website/src/data/benchmark-results.json',
  'website/src/data/benchmarks.ts',
  'website/src/pages/benchmarks.astro',
]

/**
 * The legacy agent directory is a dotted name, so a bare substring search also
 * matches inside unrelated dotted identifiers -- notably every Bedrock Anthropic
 * model id (`eu.anthropic.claude-...`), which we legitimately reference when
 * documenting review tooling. Require the match not to be preceded by an
 * identifier character, so a real path reference still trips the guard while a
 * dotted identifier does not.
 */
function containsForbiddenReference(contents: string, reference: string) {
  if (!reference.startsWith('.')) {
    return contents.includes(reference)
  }
  const escaped = reference.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`)
  return new RegExp(String.raw`(?<![0-9A-Za-z])` + escaped).test(contents)
}

export function collectForbiddenReferenceViolations(
  file: string,
  contents: string,
): Violation[] {
  if (forbiddenReferenceExemptFiles.includes(file)) {
    return []
  }

  const violations: Violation[] = []

  for (const reference of forbiddenReferences) {
    if (!containsForbiddenReference(contents, reference)) {
      continue
    }

    violations.push({
      detail: reference,
      file,
      message: 'Remove stale legacy-agent instruction reference.',
    })
  }

  return violations
}
