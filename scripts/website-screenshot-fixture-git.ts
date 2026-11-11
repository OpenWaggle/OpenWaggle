import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { buildSafeAppEnvironment } from './safe-app-environment'

const execFileAsync = promisify(execFile)

/** The author and committer of every fixture commit. */
const FIXTURE_GIT_IDENTITY = {
  name: 'OpenWaggle Screenshot Fixture',
  email: 'screenshots@openwaggle.local',
} as const

/** An empty directory inside the scratch HOME, so no hook of the developer's ever runs. */
const EMPTY_HOOKS_DIRECTORY = path.join('.cache', 'openwaggle-fixture-git-hooks')

/**
 * The environment of a fixture Git command: only the allow-listed variables, the scratch HOME,
 * and no global or system config, so the developer's `~/.gitconfig` (signing, hooks, templates,
 * credential helpers) and any inherited `GIT_*` variable never apply.
 */
function fixtureGitEnvironment(scratchHome: string) {
  return buildSafeAppEnvironment({
    HOME: scratchHome,
    USERPROFILE: scratchHome,
    GIT_CONFIG_GLOBAL: os.devNull,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_TERMINAL_PROMPT: '0',
  })
}

/**
 * Runs `git` for a screenshot fixture repository. Every fixture repository goes through here, so
 * a capture never reaches the developer's keys, hooks or HOME: commits and tags are unsigned,
 * hooks point at an empty directory, and the identity is the fixture's.
 */
export async function fixtureGit(cwd: string, args: readonly string[], scratchHome: string) {
  const hooksPath = path.join(scratchHome, EMPTY_HOOKS_DIRECTORY)
  await fs.mkdir(hooksPath, { recursive: true })
  return execFileAsync(
    'git',
    [
      '-c',
      `user.name=${FIXTURE_GIT_IDENTITY.name}`,
      '-c',
      `user.email=${FIXTURE_GIT_IDENTITY.email}`,
      '-c',
      'commit.gpgsign=false',
      '-c',
      'tag.gpgsign=false',
      '-c',
      `core.hooksPath=${hooksPath}`,
      ...args,
    ],
    { cwd, env: fixtureGitEnvironment(scratchHome) },
  )
}
