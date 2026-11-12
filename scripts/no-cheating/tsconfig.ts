/**
 * `tsconfig`: a tsconfig change may make type checking stricter, never weaker. When a tsconfig
 * file changed, scripts/tsconfig-strictness compares the projects reachable from tsconfig.json under
 * the base configs and the current ones, over today's files. A dropped source file or a flag that
 * checks less on any file is a finding. Moving files to a stricter project, adding references,
 * a stricter `extends` and excluding build outputs pass.
 */
import { compareConfigs } from '../tsconfig-strictness/compare'
import { isWeaker, weakeningMessages } from '../tsconfig-strictness/coverage'
import { TSCONFIG_FILE } from '../tsconfig-strictness/projects'
import type { Finding } from './findings'

export interface TsconfigCheckInput {
  readonly root: string
  /** Files changed since the base, deleted ones included. */
  readonly files: readonly string[]
  /** Tracked and untracked files now, NUL-separated, as `git ls-files -co -z` prints them. */
  readonly listing: string
  readonly before: (file: string) => Promise<string | undefined>
  readonly after: (file: string) => Promise<string | undefined>
}

export async function tsconfigFindings(input: TsconfigCheckInput): Promise<Finding[]> {
  const configs = input.files.filter((file) => TSCONFIG_FILE.test(file)).sort()
  const location = configs[0]
  if (location === undefined) return []
  const { weakening } = await compareConfigs({
    root: input.root,
    listing: input.listing,
    extraConfigs: configs,
    before: input.before,
    after: input.after,
  })
  if (!isWeaker(weakening)) return []
  return weakeningMessages(weakening).map((message) => ({
    file: location,
    id: 'tsconfig',
    message: `${message}; a tsconfig change may only check more`,
  }))
}
