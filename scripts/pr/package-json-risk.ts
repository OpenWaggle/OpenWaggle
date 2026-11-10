import type { RiskLevel } from './blast-radius-rules'

/** Fields that change what installs, ships or runs. */
const HIGH_RISK_FIELDS = new Set([
  'bin',
  'dependencies',
  'devDependencies',
  'engines',
  'exports',
  'files',
  'main',
  'optionalDependencies',
  'overrides',
  'packageExtensions',
  'packageManager',
  'patchedDependencies',
  'peerDependencies',
  'pnpm',
  'resolutions',
  'trustedDependencies',
  'type',
  'workspaces',
])
const MEDIUM_RISK_FIELDS = new Set(['scripts', 'build'])

function topLevelFields(text: string | undefined) {
  if (text === undefined) {
    return undefined
  }
  const value: unknown = JSON.parse(text)
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined
  }
  return new Map(Object.entries(value).map(([key, field]) => [key, JSON.stringify(field)]))
}

/** Top-level `package.json` fields that differ between two versions; undefined when unreadable. */
export function changedPackageFields(previous: string | undefined, current: string | undefined) {
  try {
    const before = topLevelFields(previous) ?? new Map<string, string>()
    const after = topLevelFields(current)
    if (after === undefined) {
      return undefined
    }
    const keys = new Set([...before.keys(), ...after.keys()])
    return [...keys].filter((key) => before.get(key) !== after.get(key)).sort()
  } catch {
    return undefined
  }
}

function assessment(reason: string, risk: RiskLevel) {
  return { reason, risk }
}

export function classifyPackageJsonChange(fields: readonly string[] | undefined) {
  if (fields === undefined) {
    return assessment('package.json changed and could not be compared.', 'High')
  }
  const high = fields.filter((field) => HIGH_RISK_FIELDS.has(field))
  if (high.length > 0) {
    return assessment(`package.json changed ${high.join(', ')}.`, 'High')
  }
  const medium = fields.filter((field) => MEDIUM_RISK_FIELDS.has(field))
  if (medium.length > 0) {
    return assessment(`package.json changed ${medium.join(', ')}.`, 'Medium')
  }
  return assessment(`package.json changed ${fields.join(', ') || 'formatting'}.`, 'Low')
}
