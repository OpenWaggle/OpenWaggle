import { type ChangedFile, classifyArea, compareRisk, type RiskLevel } from './blast-radius-rules'
import {
  BLAST_RADIUS_COMMENT_MARKER,
  BLAST_RADIUS_SECTION_END,
  BLAST_RADIUS_SECTION_START,
} from './managed-content'
import { changedPackageFields, classifyPackageJsonChange } from './package-json-risk'

const SHORT_SHA_LENGTH = 12
const GATE_COMMANDS = ['bun run check', 'bun run test', 'bun run build']

interface Assessment {
  readonly file: ChangedFile
  readonly key: string
  readonly label: string
  readonly reason: string
  readonly risk: RiskLevel
}

interface AreaGroup {
  readonly files: ChangedFile[]
  readonly label: string
  risk: RiskLevel
}

export interface BlastRadiusInput {
  readonly changedFiles: readonly ChangedFile[]
  readonly headSha: string
  /** `package.json` at the merge base and at the head; undefined when absent. */
  readonly packageJson: { readonly current?: string; readonly previous?: string }
  readonly range: string
}

function assess(file: ChangedFile, input: BlastRadiusInput) {
  if (file.path === 'package.json') {
    const fields = changedPackageFields(input.packageJson.previous, input.packageJson.current)
    const { reason, risk } = classifyPackageJsonChange(fields)
    return {
      file,
      key: 'package-json',
      label: 'Root package manifest',
      reason,
      risk,
    } satisfies Assessment
  }
  const area = classifyArea(file.path)
  return {
    file,
    key: area.key,
    label: area.label,
    reason: `${area.label} changed.`,
    risk: area.risk,
  } satisfies Assessment
}

function highestRisk(assessments: readonly Assessment[]) {
  return assessments.reduce<RiskLevel>(
    (highest, assessment) =>
      compareRisk(assessment.risk, highest) > 0 ? assessment.risk : highest,
    'Low',
  )
}

function groupByArea(assessments: readonly Assessment[]) {
  const groups = new Map<string, AreaGroup>()
  for (const assessment of assessments) {
    const group = groups.get(assessment.key)
    if (group === undefined) {
      groups.set(assessment.key, {
        files: [assessment.file],
        label: assessment.label,
        risk: assessment.risk,
      })
      continue
    }
    group.files.push(assessment.file)
    if (compareRisk(assessment.risk, group.risk) > 0) {
      group.risk = assessment.risk
    }
  }
  return [...groups.values()].sort(
    (left, right) => compareRisk(right.risk, left.risk) || left.label.localeCompare(right.label),
  )
}

function verificationFor(files: readonly string[]) {
  const checks = [...GATE_COMMANDS]
  const touches = (prefix: string) => files.some((file) => file.startsWith(prefix))
  if (touches('src/renderer/')) {
    checks.push('React Doctor, and desktop QA with the `electron-qa` skill when practical')
  }
  if (touches('src/preload/') || touches('src/main/ipc/')) {
    checks.push('Desktop QA of the changed IPC path')
  }
  if (touches('packages/')) {
    checks.push('`api:snapshot:check` and `package-docs:check`; a `feat`, `fix` or `revert` title')
  }
  if (touches('src/main/adapters/pi/')) {
    checks.push('Pi integration review against `.agents/skills/pi-integration/SKILL.md`')
  }
  if (touches('website/src/content/docs/')) {
    checks.push('Docs review against `.agents/skills/write-docs/SKILL.md`')
  }
  return checks
}

function fileCount(count: number) {
  return count === 1 ? '1 file' : `${String(count)} files`
}

function formatFile(file: ChangedFile) {
  const previous = file.previousPath === undefined ? '' : ` (from ${file.previousPath})`
  return `- ${file.status} \`${file.path}\`${previous}`
}

export function renderBlastRadius(input: BlastRadiusInput) {
  const assessments = input.changedFiles.map((file) => assess(file, input))
  const risk = highestRisk(assessments)
  const groups = groupByArea(assessments)
  const reasons = [
    ...new Set(assessments.map((assessment) => `${assessment.risk}: ${assessment.reason}`)),
  ].sort((left, right) => left.localeCompare(right))
  const verification = verificationFor(input.changedFiles.map((file) => file.path))
  const shortSha = input.headSha.slice(0, SHORT_SHA_LENGTH)
  const report = [
    BLAST_RADIUS_COMMENT_MARKER,
    '## Blast radius report',
    '',
    `- Risk: **${risk}**`,
    `- Head: \`${shortSha}\`, range \`${input.range}\``,
    `- Changed files: ${String(input.changedFiles.length)}`,
    '',
    '### Risk reasons',
    '',
    ...reasons.map((reason) => `- ${reason}`),
    '',
    '### Changed areas',
    '',
    ...groups.flatMap((group) => [
      `<details><summary>${group.label} (${group.risk}, ${fileCount(group.files.length)})</summary>`,
      '',
      ...group.files.map(formatFile),
      '',
      '</details>',
      '',
    ]),
    '### Verification',
    '',
    ...verification.map((check) => `- ${check}`),
    '',
  ].join('\n')
  const summary = (reportUrl: string) =>
    [
      BLAST_RADIUS_SECTION_START,
      '## Blast radius',
      '',
      `- Risk: **${risk}** across ${fileCount(input.changedFiles.length)} at \`${shortSha}\``,
      ...groups.map((group) => `- ${group.label}: ${group.risk}, ${fileCount(group.files.length)}`),
      `- Full report: ${reportUrl}`,
      '- Written by `bun run pr:ready`; edits inside this section are replaced on the next run.',
      '',
      BLAST_RADIUS_SECTION_END,
    ].join('\n')
  return { report, risk, summary }
}

/** Parses `git diff --name-status --find-renames` output. */
export function parseNameStatus(output: string) {
  return output
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      const [status = '', first = '', second] = line.split('\t')
      return second === undefined
        ? { path: first, status }
        : { path: second, previousPath: first, status }
    })
}
