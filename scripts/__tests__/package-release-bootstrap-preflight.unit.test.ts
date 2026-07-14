import { describe, expect, it } from 'vitest'
import { runPackageReleaseBootstrap, type BootstrapCommandResult } from '../package-release-bootstrap'
import {
  commandKey,
  compatibleRuleset,
  createDependencies,
  PACKAGE_NAMES,
  successful,
} from './package-release-bootstrap-test-helpers'

describe('package release namespace bootstrap preflight', () => {
  it('defaults to a complete read-only preflight', async () => {
    const { dependencies, requests } = createDependencies()

    const result = await runPackageReleaseBootstrap(
      { args: [], projectRoot: '/workspace/OpenWaggle' },
      dependencies,
    )

    expect(result.mode).toBe('preflight')
    expect(result.ok).toBe(true)
    expect(result.packages).toEqual(
      PACKAGE_NAMES.map((name) => ({
        name,
        state: 'pending',
        nextAction: 'publish bootstrap placeholder',
      })),
    )
    expect(result.github).toEqual({
      environment: 'pending',
      ruleset: 'pending',
    })
    expect(result.nextAction).toBe('Run pnpm package-release:bootstrap --execute.')
    expect(requests).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ mutates: true }),
      ]),
    )
    expect(requests.map(commandKey)).toContain(
      'gh api --hostname github.com repos/OpenWaggle/OpenWaggle/rulesets?includes_parents=false&per_page=100 --paginate --slurp',
    )
  })

  it('fails closed before any execution mutation when prerequisites are unsafe', async () => {
    const overrides = new Map<string, BootstrapCommandResult>([
      ['npm --version', successful('11.17.0\n')],
      ['git status --porcelain', successful(' M package.json\n')],
      ['git branch --show-current', successful('feature/bootstrap\n')],
      ['git remote get-url origin', successful('git@github.com:fork/OpenWaggle.git\n')],
      ['git rev-parse HEAD', successful('local-sha\n')],
      [
        'git ls-remote --exit-code origin refs/heads/main',
        successful('remote-sha\trefs/heads/main\n'),
      ],
      [
        'npm profile get --json',
        successful(JSON.stringify({ name: 'maintainer', tfa: { mode: 'auth-only' } })),
      ],
      [
        'npm org ls openwaggle maintainer --json',
        successful(JSON.stringify({ maintainer: 'viewer' })),
      ],
      [
        'gh api --hostname github.com repos/OpenWaggle/OpenWaggle --jq .permissions.admin',
        successful('false\n'),
      ],
    ])
    const { dependencies, requests } = createDependencies(overrides)

    const result = await runPackageReleaseBootstrap(
      { args: ['--execute'], projectRoot: '/workspace/OpenWaggle' },
      dependencies,
    )

    expect(result.mode).toBe('execute')
    expect(result.ok).toBe(false)
    expect(result.blockers).toEqual(
      expect.arrayContaining([
        'npm 11.18.0 is required; found 11.17.0.',
        'The worktree must be clean.',
        'The current branch must be main; found feature/bootstrap.',
        'origin must be exactly OpenWaggle/OpenWaggle; found git@github.com:fork/OpenWaggle.git.',
        'Local main must exactly match origin/main.',
        'npm account 2FA must be enabled in auth-and-writes mode.',
        'maintainer must have publish access to the @openwaggle npm organization.',
        'The active GitHub account must have admin access to OpenWaggle/OpenWaggle.',
      ]),
    )
    expect(requests.filter((request) => request.mutates)).toEqual([])
  })

  it('rejects a pending npm 2FA enrollment', async () => {
    const overrides = new Map<string, BootstrapCommandResult>([
      [
        'npm profile get --json',
        successful(
          JSON.stringify({
            name: 'maintainer',
            tfa: { mode: 'auth-and-writes', pending: true },
          }),
        ),
      ],
    ])
    const { dependencies, requests } = createDependencies(overrides)

    const result = await runPackageReleaseBootstrap(
      { args: ['--execute'], projectRoot: '/workspace/OpenWaggle' },
      dependencies,
    )

    expect(result.blockers).toContain(
      'npm account 2FA must be enabled in auth-and-writes mode.',
    )
    expect(requests.filter((request) => request.mutates)).toEqual([])
  })

  it('requires npm whoami to match the authenticated profile', async () => {
    const overrides = new Map<string, BootstrapCommandResult>([
      [
        'npm profile get --json',
        successful(
          JSON.stringify({
            name: 'different-maintainer',
            tfa: { mode: 'auth-and-writes' },
          }),
        ),
      ],
    ])
    const { dependencies, requests } = createDependencies(overrides)

    const result = await runPackageReleaseBootstrap(
      { args: ['--execute'], projectRoot: '/workspace/OpenWaggle' },
      dependencies,
    )

    expect(result.blockers).toContain(
      'npm whoami must match the authenticated profile; found maintainer and different-maintainer.',
    )
    expect(requests.filter((request) => request.mutates)).toEqual([])
  })

  it('rejects a non-canonical npm registry before mutation', async () => {
    const overrides = new Map<string, BootstrapCommandResult>([
      ['npm config get registry', successful('https://registry.example.invalid/\n')],
    ])
    const { dependencies, requests } = createDependencies(overrides)

    const result = await runPackageReleaseBootstrap(
      { args: ['--execute'], projectRoot: '/workspace/OpenWaggle' },
      dependencies,
    )

    expect(result.blockers).toContain(
      'npm registry must be exactly https://registry.npmjs.org/; found https://registry.example.invalid/.',
    )
    expect(requests.filter((request) => request.mutates)).toEqual([])
  })

  it('rejects credential arguments before invoking any command', async () => {
    const { dependencies, requests } = createDependencies()

    await expect(
      runPackageReleaseBootstrap(
        {
          args: ['--token=npm_secret_must_not_be_echoed'],
          projectRoot: '/workspace/OpenWaggle',
        },
        dependencies,
      ),
    ).rejects.toThrow(
      'Credential arguments are not supported; use authenticated npm and gh sessions.',
    )
    expect(requests).toEqual([])
  })

  it('does not echo credential-like values from unknown arguments', async () => {
    const { dependencies, requests } = createDependencies()
    const secret = 'npm_secret_must_not_be_echoed'

    let message = ''
    try {
      await runPackageReleaseBootstrap(
        {
          args: [`--registry=https://example.invalid/${secret}`],
          projectRoot: '/workspace/OpenWaggle',
        },
        dependencies,
      )
    } catch (error) {
      message = error instanceof Error ? error.message : String(error)
    }

    expect(message).toBe('Unknown bootstrap arguments; expected only --execute.')
    expect(message).not.toContain(secret)
    expect(requests).toEqual([])
  })

  it('sanitizes credential values from command failures', async () => {
    const npmSecret = 'plain-npm-secret-value'
    const githubSecret = 'github_pat_abcdefghijklmnopqrstuvwxyz123456'
    const overrides = new Map<string, BootstrapCommandResult>([
      [
        'npm whoami',
        {
          exitCode: 1,
          stderr: `NPM_TOKEN=${npmSecret} Authorization: Bearer ${githubSecret}`,
          stdout: '',
        },
      ],
    ])
    const { dependencies, requests } = createDependencies(overrides)

    let message = ''
    try {
      await runPackageReleaseBootstrap(
        { args: ['--execute'], projectRoot: '/workspace/OpenWaggle' },
        dependencies,
      )
    } catch (error) {
      message = error instanceof Error ? error.message : String(error)
    }

    expect(message).toContain('[redacted]')
    expect(message).not.toContain(npmSecret)
    expect(message).not.toContain(githubSecret)
    expect(requests.filter((request) => request.mutates)).toEqual([])
  })

})
