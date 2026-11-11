/**
 * `bun scripts/check-tsconfig-strictness.ts [--base <ref>]` [TS-01]: a tsconfig change may only
 * make type checking stricter. It compares the projects reachable from tsconfig.json under the
 * configs at the base ref (the merge base with origin/main by default) and the current ones, over
 * today's files, and fails when a source file is no longer checked by any project or a
 * strictness flag checks less on any file. Moving files to a stricter project, adding references
 * and excluding build outputs pass. With no tsconfig changed since the base it reads nothing.
 */
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import { pathToFileURL } from 'node:url'
import { compareConfigs } from './tsconfig-strictness/compare'
import { coverageOf, isWeaker, weakeningMessages } from './tsconfig-strictness/coverage'
import { ROOT_CONFIG, TSCONFIG_FILE } from './tsconfig-strictness/projects'
import { gitOrUndefined, parseBaseArgument, resolveBase } from './support/git-base'

const CHECK = 'tsconfig-strictness'
const FIRST_ARGUMENT = 2
const MILLISECONDS_PER_SECOND = 1000
const SHORT_SHA_LENGTH = 12

function lines(output: string | undefined) {
  return (output ?? '').split('\n').filter((line) => line !== '')
}

export async function main(argv: readonly string[]) {
  const started = performance.now()
  const root = (await gitOrUndefined(process.cwd(), ['rev-parse', '--show-toplevel'])) ?? '.'
  const base = await resolveBase(root, parseBaseArgument(argv), CHECK)
  const [changed, untracked] = await Promise.all([
    gitOrUndefined(root, ['diff', '--name-only', '--no-renames', base, '--']),
    gitOrUndefined(root, ['ls-files', '--others', '--exclude-standard']),
  ])
  const configs = [...lines(changed), ...lines(untracked)].filter((file) =>
    TSCONFIG_FILE.test(file),
  )
  const seconds = () => ((performance.now() - started) / MILLISECONDS_PER_SECOND).toFixed(1)
  if (configs.length === 0) {
    console.log(`${CHECK}: no tsconfig changed since ${base.slice(0, SHORT_SHA_LENGTH)}`)
    return 0
  }
  const listing = (await gitOrUndefined(root, ['ls-files', '-co', '--exclude-standard'])) ?? ''
  const result = await compareConfigs({
    root,
    listing,
    extraConfigs: configs,
    before: (file) => gitOrUndefined(root, ['show', `${base}:${file}`]),
    after: (file) => readFile(path.join(root, file), 'utf8').catch(() => undefined),
  })
  if (!isWeaker(result.weakening)) {
    const files = coverageOf(result.after).size
    console.log(
      `${CHECK}: ${configs.length} changed, ${result.after.length} projects from ${ROOT_CONFIG}, ${files} source files, none checked less (${seconds()}s)`,
    )
    return 0
  }
  const location = [...configs].sort()[0] ?? ROOT_CONFIG
  for (const message of weakeningMessages(result.weakening)) {
    console.log(
      `${location}:1:1 ${CHECK} [TS-01] ${message}; a tsconfig change may only check more`,
    )
  }
  return 1
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.slice(FIRST_ARGUMENT))
}
