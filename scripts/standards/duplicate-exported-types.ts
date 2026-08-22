import type { Violation } from './violation'

/**
 * Two exported types with the same name in sibling modules is a trap this repository has
 * already fallen into.
 *
 * Observed failure: `SessionSummaryRow` exists in both `store/sessions/types.ts` and
 * `store/session-details/types.ts` with different shapes, and each has its own
 * `hydrateSessionSummary`. A change meant for the session list was made to the
 * detail-side function instead. It typechecked, its own test passed, and the feature was
 * simply absent until the app was opened.
 *
 * The existing collisions are listed rather than fixed here: several are legitimate
 * (independent extension enums), and the row-type pairs are a refactor of their own. The
 * value is that the list is checked in — so the traps are visible — and that adding a
 * new collision fails.
 */
export const KNOWN_DUPLICATE_EXPORTED_TYPES: readonly string[] = [
  'ExtensionBuildRunStatus',
  'ExtensionDiagnosticCode',
  'ExtensionDiagnosticSeverity',
  'ExtensionInstallSource',
  'ExtensionReloadStatus',
  'ExtensionStorageKind',
  'ExtensionStorageScope',
  'MutableValueRef',
  'SessionActiveRunRow',
  'SessionBranchRow',
  'SessionBranchStateRow',
  'SessionSummaryRow',
  'UpdateSessionRuntimeInput',
  'WaggleInfo',
]

const DUPLICATE_DECLARATION_THRESHOLD = 2

const EXPORTED_TYPE_DECLARATION = /^export (?:interface|type) ([A-Za-z0-9_]+)/gmu

export function collectDuplicateExportedTypes(
  filesWithContents: ReadonlyMap<string, string>,
): readonly Violation[] {
  const declarationsByName = new Map<string, string[]>()
  for (const [file, contents] of filesWithContents) {
    /*
     * Scoped to src/. packages/extension-sdk deliberately mirrors shared types as its
     * public surface, so those pairs are by design rather than a trap.
     */
    if (!file.startsWith('src/')) continue
    if (file.includes('__tests__') || !/\.tsx?$/u.test(file)) continue
    for (const match of contents.matchAll(EXPORTED_TYPE_DECLARATION)) {
      const name = match[1]
      if (name === undefined) continue
      const files = declarationsByName.get(name) ?? []
      files.push(file)
      declarationsByName.set(name, files)
    }
  }

  return [
    ...findUnlistedDuplicates(declarationsByName),
    ...findStaleDuplicateExemptions(declarationsByName),
  ]
}

function findUnlistedDuplicates(
  declarationsByName: ReadonlyMap<string, readonly string[]>,
): readonly Violation[] {
  const violations: Violation[] = []
  for (const [name, declaringFiles] of [...declarationsByName].sort()) {
    const unique = [...new Set(declaringFiles)].sort()
    if (unique.length < DUPLICATE_DECLARATION_THRESHOLD) continue
    if (KNOWN_DUPLICATE_EXPORTED_TYPES.includes(name)) continue
    violations.push({
      file: unique[0] ?? name,
      message: `Exported type "${name}" is declared in ${unique.length} modules; give each a name that says which it is`,
      detail: unique.join(', '),
    })
  }
  return violations
}

/** The exemption list can only shrink: a resolved collision must be removed from it. */
function findStaleDuplicateExemptions(
  declarationsByName: ReadonlyMap<string, readonly string[]>,
): readonly Violation[] {
  const violations: Violation[] = []
  for (const name of KNOWN_DUPLICATE_EXPORTED_TYPES) {
    const unique = new Set(declarationsByName.get(name) ?? [])
    if (unique.size >= DUPLICATE_DECLARATION_THRESHOLD) continue
    violations.push({
      file: 'scripts/check-repository-standards.ts',
      message: `"${name}" is no longer a duplicate exported type; remove it from KNOWN_DUPLICATE_EXPORTED_TYPES`,
    })
  }
  return violations
}

