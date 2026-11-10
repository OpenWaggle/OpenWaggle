import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import type { Violation } from './violation'

/**
 * ADR numbers are unique and contiguous from 0001, and every ADR is listed in each ADR index that
 * exists. A second ADR with a taken number makes "ADR 0063" mean two decisions, and every
 * reference to either one becomes a guess.
 */
export const ADR_DIRECTORY = 'docs/adr'
const ADR_FILE = /^(?<number>\d{4})-[a-z0-9]+(?:-[a-z0-9]+)*\.md$/u
const NUMBER_WIDTH = 4

/**
 * The files that index the ADRs, with the text that precedes each ADR file name in them. An index
 * that does not exist is skipped.
 */
export const ADR_INDEXES: readonly { readonly file: string; readonly prefix: string }[] = [
  { file: 'docs/architecture.md', prefix: `${ADR_DIRECTORY}/` },
  { file: `${ADR_DIRECTORY}/README.md`, prefix: '' },
]
const INDEX_FILE_NAMES = new Set(ADR_INDEXES.map((index) => path.posix.basename(index.file)))

/**
 * Numbers that two ADRs already shared before this check existed. Each pair is frozen as it is:
 * references across the repository name these ADRs by number, so renumbering one would silently
 * change what those references mean. No number may be added here.
 */
export const LEGACY_SHARED_ADR_NUMBERS: ReadonlyMap<string, readonly string[]> = new Map([
  [
    '0015',
    [
      '0015-separate-composer-invocations-from-global-command-surfaces.md',
      '0015-single-design-token-contract.md',
    ],
  ],
  [
    '0025',
    [
      '0025-adopt-monaco-and-shiki-for-workspace-editing.md',
      '0025-compaction-uses-one-native-protocol-and-one-portable-fallback.md',
    ],
  ],
  [
    '0026',
    [
      '0026-adopt-session-summary-and-resource-catalog.md',
      '0026-unified-worker-backed-syntax-service.md',
    ],
  ],
  ['0030', ['0030-adopt-single-local-session-host.md', '0030-session-bound-terminals.md']],
  [
    '0031',
    [
      '0031-adopt-visualize-compatible-inline-visualizations.md',
      '0031-session-owned-browser-preview.md',
    ],
  ],
  ['0035', ['0035-native-project-actions.md', '0035-one-step-mcp-trust-with-a-curated-catalog.md']],
  [
    '0043',
    [
      '0043-generated-session-titles-follow-t3code.md',
      '0043-unified-right-panel-with-a-panel-rail.md',
    ],
  ],
  [
    '0044',
    [
      '0044-follow-up-edits-keep-their-identity-and-hold-the-queue.md',
      '0044-usage-statistics-carry-no-persistent-identifier.md',
    ],
  ],
  [
    '0048',
    [
      '0048-compacted-history-stays-visible-in-the-transcript.md',
      '0048-source-control-resolution-lives-in-the-session-host.md',
    ],
  ],
  [
    '0049',
    [
      '0049-pi-entry-ids-are-full-uuids.md',
      '0049-users-can-recover-desktop-tools-after-an-unclean-quit.md',
    ],
  ],
  [
    '0051',
    [
      '0051-openwaggle-is-the-gui-for-the-pi-ecosystem.md',
      '0051-workers-live-in-a-hive-panel-not-the-sidebar.md',
    ],
  ],
  [
    '0053',
    [
      '0053-mcp-apps-reach-the-origins-their-server-declares.md',
      '0053-the-coordination-surface-is-named-hive-everywhere.md',
    ],
  ],
])

function adrFile(name: string) {
  return `${ADR_DIRECTORY}/${name}`
}

function sameFiles(left: readonly string[], right: readonly string[]) {
  return [...left].sort().join('\n') === [...right].sort().join('\n')
}

function numberingViolations(names: readonly string[]): Violation[] {
  const violations: Violation[] = []
  const byNumber = new Map<string, string[]>()
  for (const name of names) {
    const number = ADR_FILE.exec(name)?.groups?.['number']
    if (number === undefined) {
      violations.push({
        file: adrFile(name),
        message: 'Name an ADR file NNNN-lowercase-words.md with the next free four-digit number.',
      })
      continue
    }
    byNumber.set(number, [...(byNumber.get(number) ?? []), name])
  }
  for (const [number, files] of byNumber) {
    if (files.length === 1) continue
    const legacy = LEGACY_SHARED_ADR_NUMBERS.get(number)
    if (legacy !== undefined && sameFiles(files, legacy)) continue
    violations.push({
      file: ADR_DIRECTORY,
      detail: files.join(', '),
      message: `ADR number ${number} is taken more than once. Give the newer ADR the next free number and update every reference to it.`,
    })
  }
  const numbers = [...byNumber.keys()].map(Number)
  const highest = Math.max(0, ...numbers)
  for (let number = 1; number < highest; number += 1) {
    const padded = String(number).padStart(NUMBER_WIDTH, '0')
    if (!byNumber.has(padded)) {
      violations.push({
        file: ADR_DIRECTORY,
        detail: padded,
        message: 'ADR numbers are contiguous. Use the lowest free number for the next ADR.',
      })
    }
  }
  return violations
}

function escapeRegExp(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
}

function indexViolations(names: readonly string[], indexes: ReadonlyMap<string, string>) {
  const violations: Violation[] = []
  const adrs = new Set(names)
  for (const { file, prefix } of ADR_INDEXES) {
    const contents = indexes.get(file)
    if (contents === undefined) continue
    const listed = new Set(
      [
        ...contents.matchAll(
          new RegExp(`${escapeRegExp(prefix)}(?<name>\\d{${NUMBER_WIDTH}}-[a-z0-9-]+\\.md)`, 'gu'),
        ),
      ].flatMap((match) => match.groups?.['name'] ?? []),
    )
    for (const name of names) {
      if (!listed.has(name)) {
        violations.push({
          file,
          detail: adrFile(name),
          message: 'List every ADR in the ADR index.',
        })
      }
    }
    for (const name of listed) {
      if (!adrs.has(name)) {
        violations.push({
          file,
          detail: adrFile(name),
          message: 'The ADR index lists an ADR that does not exist.',
        })
      }
    }
  }
  return violations
}

/** `names` are the Markdown file names in `docs/adr`; `indexes` holds each existing index file. */
export function collectAdrNumberingViolations(
  names: readonly string[],
  indexes: ReadonlyMap<string, string>,
): Violation[] {
  const adrs = names.filter((name) => !INDEX_FILE_NAMES.has(name)).sort()
  const numbered = adrs.filter((name) => ADR_FILE.test(name))
  return [...numberingViolations(adrs), ...indexViolations(numbered, indexes)]
}

/** The repository-standards entry point: the ADR directory and its indexes, read from disk. */
export function collectRepositoryAdrNumberingViolations(repositoryRoot: string): Violation[] {
  const names = readdirSync(path.join(repositoryRoot, ADR_DIRECTORY)).filter((name) =>
    name.endsWith('.md'),
  )
  const indexes = new Map<string, string>()
  for (const { file } of ADR_INDEXES) {
    const absolute = path.join(repositoryRoot, file)
    if (existsSync(absolute)) indexes.set(file, readFileSync(absolute, 'utf8'))
  }
  return collectAdrNumberingViolations(names, indexes)
}
