import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fixtureGit } from '../website-screenshot-fixture-git'

const FAILING_HOOK = '#!/bin/sh\necho "developer hook ran" >&2\nexit 1\n'

describe('fixture git', () => {
  let scratch = ''

  beforeEach(async () => {
    scratch = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-fixture-git-')))
  })

  afterEach(async () => {
    vi.unstubAllEnvs()
    await fs.rm(scratch, { recursive: true, force: true })
  })

  it("ignores the developer's global config, signing, hooks and GIT_* variables", async () => {
    // A developer HOME that signs every commit with a program that fails and runs a failing hook.
    const developerHome = path.join(scratch, 'developer-home')
    const developerHooks = path.join(developerHome, 'hooks')
    await fs.mkdir(developerHooks, { recursive: true })
    await fs.writeFile(path.join(developerHooks, 'pre-commit'), FAILING_HOOK, { mode: 0o755 })
    const developerConfig = path.join(developerHome, '.gitconfig')
    await fs.writeFile(
      developerConfig,
      [
        '[commit]',
        '\tgpgsign = true',
        '[gpg]',
        '\tprogram = false',
        '[core]',
        `\thooksPath = ${developerHooks}`,
        '[user]',
        '\tname = Real Developer',
        '',
      ].join('\n'),
    )
    vi.stubEnv('HOME', developerHome)
    vi.stubEnv('GIT_CONFIG_GLOBAL', developerConfig)
    vi.stubEnv('GIT_DIR', path.join(scratch, 'elsewhere.git'))

    const scratchHome = path.join(scratch, 'home')
    const repository = path.join(scratch, 'fixture')
    await fs.mkdir(repository)
    await fixtureGit(repository, ['init', '--initial-branch=main'], scratchHome)
    await fs.writeFile(path.join(repository, 'README.md'), '# fixture\n')
    await fixtureGit(repository, ['add', 'README.md'], scratchHome)
    await fixtureGit(repository, ['commit', '-m', 'chore: seed'], scratchHome)

    const { stdout } = await fixtureGit(repository, ['log', '-1', '--format=%an|%G?'], scratchHome)
    expect(stdout.trim()).toBe('OpenWaggle Screenshot Fixture|N')
    await expect(fs.stat(path.join(scratch, 'elsewhere.git'))).rejects.toThrow()
  })
})
