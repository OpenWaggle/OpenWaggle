/**
 * Reads the JSON reports of Fallow (`dead-code`, `dupes`) and React Doctor into one finding
 * shape, keeping only findings in the files an agent changed.
 */

export interface Finding {
  readonly tool: 'fallow dead-code' | 'fallow dupes' | 'react-doctor'
  readonly rule: string
  readonly file: string
  readonly line: number | undefined
  readonly message: string
}

type Json = Record<string, unknown>

// Dead-code report keys that hold diagnostics about the run, not findings.
const NON_FINDING_KEYS = new Set([
  'entry_points',
  'next_steps',
  'workspace_diagnostics',
  'gate_outcomes',
  'summary',
  '_meta',
])
const NAME_FIELDS = [
  'export_name',
  'member_name',
  'package_name',
  'specifier',
  'prop_name',
  'entry_name',
] as const

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parse(text: string): Json | undefined {
  try {
    const value: unknown = JSON.parse(text)
    return isObject(value) ? value : undefined
  } catch {
    return undefined
  }
}

function text(value: unknown) {
  return typeof value === 'string' ? value : undefined
}

function lineOf(value: unknown) {
  return typeof value === 'number' ? value : undefined
}

function objects(value: unknown): Json[] {
  return Array.isArray(value) ? value.filter(isObject) : []
}

/** `unused_exports` as `unused-export`, the name Fallow's docs and compact output use. */
function ruleName(key: string) {
  return key.replace(/_/g, '-').replace(/ies$/, 'y').replace(/s$/, '')
}

/** `fallow dead-code --format json`: every finding whose file, or one of whose cycle files, changed. */
export function deadCodeFindings(report: string, changed: ReadonlySet<string>): Finding[] {
  const parsed = parse(report)
  if (parsed === undefined) {
    return []
  }
  return Object.entries(parsed).flatMap(([key, value]) =>
    NON_FINDING_KEYS.has(key)
      ? []
      : objects(value).flatMap((item) => {
          const files = [
            text(item.path),
            ...objects(item.edges).map((edge) => text(edge.path)),
          ].filter((file): file is string => file !== undefined)
          const cycle = Array.isArray(item.files)
            ? item.files.filter((file): file is string => typeof file === 'string')
            : []
          const file = [...files, ...cycle].find((candidate) => changed.has(candidate))
          if (file === undefined) {
            return []
          }
          const name = NAME_FIELDS.map((field) => text(item[field])).find(
            (value) => value !== undefined,
          )
          const parent = text(item.parent_name) ?? text(item.component_name)
          const named = [parent, name].filter(Boolean).join('.')
          const subject =
            cycle.length > 0 ? cycle.join(' -> ') : named || ruleName(key).replace(/-/g, ' ')
          return [
            {
              tool: 'fallow dead-code' as const,
              rule: ruleName(key),
              file,
              line: lineOf(item.line),
              message: subject,
            },
          ]
        }),
  )
}

/** `fallow dupes --format json`: each clone group with an instance in a changed file. */
export function duplicationFindings(report: string, changed: ReadonlySet<string>): Finding[] {
  return objects(parse(report)?.clone_groups).flatMap((group) => {
    const instances = objects(group.instances).flatMap((instance) => {
      const file = text(instance.file)
      return file === undefined
        ? []
        : [{ file, start: lineOf(instance.start_line), end: lineOf(instance.end_line) }]
    })
    const own = instances.find((instance) => changed.has(instance.file))
    if (own === undefined) {
      return []
    }
    const others = instances
      .filter((instance) => instance !== own)
      .map((instance) => `${instance.file}:${instance.start ?? '?'}-${instance.end ?? '?'}`)
    return [
      {
        tool: 'fallow dupes' as const,
        rule: 'code-duplication',
        file: own.file,
        line: own.start,
        message: `lines ${own.start ?? '?'}-${own.end ?? '?'} duplicate ${others.join(', ')}`,
      },
    ]
  })
}

/** `react-doctor --json`: every diagnostic in a changed file. */
export function reactDoctorFindings(report: string, changed: ReadonlySet<string>): Finding[] {
  const parsed = parse(report)
  const diagnostics = [
    ...objects(parsed?.diagnostics),
    ...objects(parsed?.projects).flatMap((project) => objects(project.diagnostics)),
  ]
  return unique(
    diagnostics.flatMap((diagnostic) => {
      const file = text(diagnostic.filePath)
      if (file === undefined || !changed.has(file)) {
        return []
      }
      const plugin = text(diagnostic.plugin)
      const rule = text(diagnostic.rule) ?? 'unknown'
      const help = text(diagnostic.help)
      return [
        {
          tool: 'react-doctor' as const,
          rule: plugin === undefined ? rule : `${plugin}/${rule}`,
          file,
          line: lineOf(diagnostic.line),
          message: [text(diagnostic.message), help].filter(Boolean).join(' '),
        },
      ]
    }),
  )
}

/** One finding per file, line and rule: a report can list a file under several projects. */
function unique(findings: readonly Finding[]) {
  const seen = new Set<string>()
  return findings.filter((finding) => {
    const key = `${finding.file}:${finding.line ?? ''}:${finding.rule}`
    const fresh = !seen.has(key)
    seen.add(key)
    return fresh
  })
}

// One follow-up message stays short enough to read; the rest are counted.
export const MAX_REPORTED_FINDINGS = 40

/** The follow-up message an agent gets when its changes have findings. */
export function feedbackMessage(findings: readonly Finding[]) {
  const shown = findings.slice(0, MAX_REPORTED_FINDINGS)
  const lines = shown.map(
    (finding) =>
      `- ${finding.file}${finding.line === undefined ? '' : `:${finding.line}`} ${finding.tool} ${finding.rule}: ${finding.message}`,
  )
  const hidden = findings.length - shown.length
  return [
    `Quality gates found ${findings.length} issue${findings.length === 1 ? '' : 's'} in files you changed. Fix them before you finish:`,
    '',
    ...lines,
    ...(hidden > 0
      ? [`- and ${hidden} more; run \`bun run check:fallow\` and \`bun run check:react-doctor\`.`]
      : []),
    '',
    'Fix the code. A false positive gets a config fix with a comment giving the reason (.fallowrc.jsonc or doctor.config.ts), never a suppression comment. If you cannot fix one, say so in your final answer.',
  ].join('\n')
}
