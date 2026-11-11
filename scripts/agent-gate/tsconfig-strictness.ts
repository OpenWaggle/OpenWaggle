/**
 * TS-01 in the agent gate: a tsconfig change may make type checking stricter, never weaker. When
 * the agent changed a tsconfig file, scripts/tsconfig-strictness compares the projects reachable
 * from tsconfig.json under the baseline configs and the current ones, over today's files. A
 * dropped source file or a flag that checks less on any file blocks; there is no approval for it.
 * Moving files to a stricter project, adding references and excluding build outputs pass.
 */
import type { RunProcess } from '../agent-quality-gates/process'
import { compareConfigs } from '../tsconfig-strictness/compare'
import { isWeaker, weakeningMessages } from '../tsconfig-strictness/coverage'
import { TSCONFIG_FILE } from '../tsconfig-strictness/projects'
import type { Finding, ToolFailure } from './findings'
import { git } from './git'

export { TSCONFIG_FILE }

const LISTING_TIMEOUT_MS = 15_000

export interface TsconfigCheckInput {
  readonly root: string
  /** Files changed since the baseline, deleted ones included. */
  readonly files: readonly string[]
  readonly run: RunProcess
  readonly before: (file: string) => Promise<string | undefined>
  readonly after: (file: string) => Promise<string | undefined>
}

export interface TsconfigCheckResult {
  readonly findings: readonly Finding[]
  readonly failures: readonly ToolFailure[]
}

export async function tsconfigCheck(input: TsconfigCheckInput): Promise<TsconfigCheckResult> {
  const configs = input.files.filter((file) => TSCONFIG_FILE.test(file)).sort()
  const location = configs[0]
  if (location === undefined) return { findings: [], failures: [] }
  const listing = await git(
    input.run,
    input.root,
    ['ls-files', '-co', '--exclude-standard', '-z'],
    LISTING_TIMEOUT_MS,
  )
  try {
    if (listing === undefined) throw new Error('git ls-files failed')
    const { weakening } = await compareConfigs({
      root: input.root,
      listing,
      extraConfigs: configs,
      before: input.before,
      after: input.after,
    })
    if (!isWeaker(weakening)) return { findings: [], failures: [] }
    return {
      findings: weakeningMessages(weakening).map((message) => ({
        file: location,
        rule: 'gate/tsconfig',
        id: 'TS-01',
        message: `${message}; a tsconfig change may only check more`,
        severity: 'block' as const,
      })),
      failures: [],
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    return { findings: [], failures: [{ check: 'tsconfig', files: configs, reason }] }
  }
}
