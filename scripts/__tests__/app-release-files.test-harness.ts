import { execFile as execFileCallback } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { bunExecutable } from '../support/node-runtime'

const execFile = promisify(execFileCallback)

/** A CHANGELOG.md with no hand-written notes, as main has between Stable releases. */
export const EMPTY_CHANGELOG = '# Changelog\n\n## [Unreleased]\n'
/** A CHANGELOG.md whose `## [Unreleased]` holds notes written on main. */
export const MAIN_NOTES =
  '# Changelog\n\n## [Unreleased]\n\n### Highlights\n\n- Notes written on main.\n'

/**
 * Runs `scripts/app-release-state.ts` in a fixture repository with its Git environment and returns
 * its stdout, so a fixture's release commits are the ones the workflow itself writes.
 */
export async function runReleaseScript(cwd: string, env: NodeJS.ProcessEnv, ...args: string[]) {
  const script = path.join(process.cwd(), 'scripts/app-release-state.ts')
  const { stdout } = await execFile(bunExecutable(), [script, ...args], { cwd, env })
  return stdout.trim()
}

/** A commit of main plus the generated release files for `version`, on top of the checkout's HEAD. */
export function releaseCommit(
  cwd: string,
  env: NodeJS.ProcessEnv,
  version: string,
  message: string,
) {
  return runReleaseScript(
    cwd,
    env,
    'release-commit',
    '--base',
    'HEAD',
    '--version',
    version,
    '--parent',
    'HEAD',
    '--message',
    message,
  )
}

export function isolatedGitEnv() {
  return {
    ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))),
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 'Release Tests',
    GIT_AUTHOR_EMAIL: 'tests@openwaggle.ai',
    GIT_COMMITTER_NAME: 'Release Tests',
    GIT_COMMITTER_EMAIL: 'tests@openwaggle.ai',
  }
}

export function gitRunner(env: NodeJS.ProcessEnv) {
  return async (cwd: string, ...args: string[]) => {
    const { stdout } = await execFile('git', args, { cwd, env })
    return stdout.trim()
  }
}

export async function readIfPresent(filePath: string) {
  return fs.readFile(filePath, 'utf8').catch(() => '')
}
