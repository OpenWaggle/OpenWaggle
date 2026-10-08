import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { updateProjectSourceControlConfig } from '../../../config/project-source-control-config'
import {
  configureSourceControl,
  resolveChangeRequestOpenDestination,
} from '../source-control-configuration'
import { CLI_HOSTS, memoryAccess } from './source-control-settings-memory'

let projectPath: string

describe('source-control configuration', () => {
  beforeEach(async () => {
    projectPath = await realpath(
      await mkdtemp(join(tmpdir(), 'openwaggle-source-control-configure-')),
    )
    execFileSync('git', ['init', '--quiet', projectPath])
  })

  afterEach(async () => {
    await rm(projectPath, { recursive: true, force: true })
  })

  describe('the Change request open destination', () => {
    it('defaults to the inspector', async () => {
      const { access } = memoryAccess()
      await expect(resolveChangeRequestOpenDestination(projectPath, access)).resolves.toEqual({
        destination: 'inspector',
        source: 'default',
      })
    })

    it('uses the project-local override, then the user choice, then the shared file', async () => {
      await updateProjectSourceControlConfig(projectPath, {
        changeRequestOpenDestination: 'website',
      })
      const shared = memoryAccess()
      await expect(
        resolveChangeRequestOpenDestination(projectPath, shared.access),
      ).resolves.toEqual({
        destination: 'website',
        source: 'project-shared',
      })

      const user = memoryAccess({ changeRequestOpenDestination: 'inspector' })
      await expect(resolveChangeRequestOpenDestination(projectPath, user.access)).resolves.toEqual({
        destination: 'inspector',
        source: 'user',
      })

      const local = memoryAccess({
        changeRequestOpenDestination: 'inspector',
        changeRequestOpenDestinationByProject: { [projectPath]: 'website' },
      })
      await expect(resolveChangeRequestOpenDestination(projectPath, local.access)).resolves.toEqual(
        {
          destination: 'website',
          source: 'project-local',
        },
      )
    })

    it('resolves the user-wide destination without a project', async () => {
      const { access } = memoryAccess({ changeRequestOpenDestination: 'website' })
      await expect(resolveChangeRequestOpenDestination(null, access)).resolves.toEqual({
        destination: 'website',
        source: 'user',
      })
    })
  })

  describe('configuring', () => {
    it('sets and forgets a host provider, clearing what was detected for it', async () => {
      const { access, current } = memoryAccess({
        sourceControlDetectedHostProviders: { 'git.acme.io': 'github' },
      })

      await expect(
        configureSourceControl(
          { kind: 'set-host-provider', host: 'Git.Acme.IO', provider: 'gitlab' },
          access,
        ),
      ).resolves.toEqual({ ok: true })
      expect(current().sourceControlHostProviders).toEqual({ 'git.acme.io': 'gitlab' })

      await configureSourceControl(
        { kind: 'set-host-provider', host: 'git.acme.io', provider: null },
        access,
      )
      expect(current().sourceControlHostProviders).toEqual({})
      expect(current().sourceControlDetectedHostProviders).toEqual({})
    })

    it('rejects a host that is not a hostname', async () => {
      const { access } = memoryAccess()
      await expect(
        configureSourceControl(
          { kind: 'set-host-provider', host: 'https://git.acme.io/x', provider: 'gitlab' },
          access,
        ),
      ).resolves.toMatchObject({ ok: false })
    })

    it('declares a project host in the shared file and approves it locally', async () => {
      const { access, current } = memoryAccess()

      await configureSourceControl(
        { kind: 'declare-project-host', projectPath, host: 'git.acme.io', provider: 'gitlab' },
        access,
      )

      const file = JSON.parse(
        await readFile(join(projectPath, '.openwaggle', 'settings.json'), 'utf-8'),
      )
      expect(file.sourceControl).toEqual({ hosts: { 'git.acme.io': 'gitlab' } })
      expect(current().sourceControlProjectDeclarations[projectPath]).toEqual({
        approved: { 'git.acme.io': 'gitlab' },
        declined: {},
      })
    })

    it('only writes the shared file at a repository root', async () => {
      const nested = join(projectPath, 'nested')
      await mkdir(nested)
      const { access } = memoryAccess()

      await expect(
        configureSourceControl(
          {
            kind: 'declare-project-host',
            projectPath,
            workingPath: nested,
            host: 'git.acme.io',
            provider: 'gitlab',
          },
          access,
        ),
      ).resolves.toMatchObject({ ok: false })
      await expect(
        configureSourceControl(
          {
            kind: 'set-open-destination',
            scope: 'project-shared',
            projectPath: 'relative/path',
            destination: 'website',
          },
          access,
        ),
      ).resolves.toMatchObject({ ok: false })
    })

    it('never approves another declared host the user has not seen', async () => {
      await updateProjectSourceControlConfig(projectPath, { hosts: { 'evil.acme.io': 'github' } })
      const { access, current } = memoryAccess()

      await configureSourceControl(
        { kind: 'declare-project-host', projectPath, host: 'git.acme.io', provider: 'gitlab' },
        access,
      )

      expect(current().sourceControlProjectDeclarations[projectPath]).toEqual({
        approved: { 'git.acme.io': 'gitlab' },
        declined: {},
      })
    })

    it('keeps an approval that covered the other declared hosts', async () => {
      await updateProjectSourceControlConfig(projectPath, { hosts: { 'old.acme.io': 'github' } })
      const { access, current } = memoryAccess({
        sourceControlProjectDeclarations: {
          [projectPath]: { approved: { 'old.acme.io': 'github' }, declined: {} },
        },
      })

      await configureSourceControl(
        { kind: 'declare-project-host', projectPath, host: 'git.acme.io', provider: 'gitlab' },
        access,
      )

      expect(current().sourceControlProjectDeclarations[projectPath]).toEqual({
        approved: { 'old.acme.io': 'github', 'git.acme.io': 'gitlab' },
        declined: {},
      })
    })

    it('marks a host as neither provider and forgets that again', async () => {
      const { access, current } = memoryAccess()

      await configureSourceControl(
        { kind: 'set-host-provider', host: 'code.acme.io', provider: 'unsupported' },
        access,
      )
      expect(current().sourceControlHostProviders).toEqual({ 'code.acme.io': 'unsupported' })

      await configureSourceControl(
        { kind: 'set-host-provider', host: 'code.acme.io', provider: null },
        access,
      )
      expect(current().sourceControlHostProviders).toEqual({})
    })

    it('records a decision on exactly the declarations shown', async () => {
      const { access, current } = memoryAccess()

      await configureSourceControl(
        {
          kind: 'decide-project-declaration',
          projectPath,
          decision: 'declined',
          hosts: { 'Git.Acme.IO': 'gitlab' },
        },
        access,
      )

      expect(current().sourceControlProjectDeclarations).toEqual({
        [projectPath]: { approved: {}, declined: { 'git.acme.io': 'gitlab' } },
      })
    })

    it('keeps each host’s own decision when another host is decided', async () => {
      const { access, current } = memoryAccess()
      const decide = (decision: 'approved' | 'declined', host: string) =>
        configureSourceControl(
          {
            kind: 'decide-project-declaration',
            projectPath,
            decision,
            hosts: { [host]: 'gitlab' },
          },
          access,
        )

      await decide('approved', 'a.acme.io')
      await decide('declined', 'b.acme.io')
      expect(current().sourceControlProjectDeclarations[projectPath]).toEqual({
        approved: { 'a.acme.io': 'gitlab' },
        declined: { 'b.acme.io': 'gitlab' },
      })

      await decide('approved', 'b.acme.io')
      expect(current().sourceControlProjectDeclarations[projectPath]).toEqual({
        approved: { 'a.acme.io': 'gitlab', 'b.acme.io': 'gitlab' },
        declined: {},
      })
    })

    it('sets and clears open destinations at each scope', async () => {
      const { access, current } = memoryAccess()

      await configureSourceControl(
        { kind: 'set-open-destination', scope: 'user', destination: 'website' },
        access,
      )
      await configureSourceControl(
        {
          kind: 'set-open-destination',
          scope: 'project-local',
          projectPath,
          destination: 'inspector',
        },
        access,
      )
      await configureSourceControl(
        {
          kind: 'set-open-destination',
          scope: 'project-shared',
          projectPath,
          destination: 'website',
        },
        access,
      )
      expect(current().changeRequestOpenDestination).toBe('website')
      expect(current().changeRequestOpenDestinationByProject).toEqual({
        [projectPath]: 'inspector',
      })
      const file = JSON.parse(
        await readFile(join(projectPath, '.openwaggle', 'settings.json'), 'utf-8'),
      )
      expect(file.sourceControl).toEqual({ changeRequestOpenDestination: 'website' })

      await configureSourceControl(
        { kind: 'set-open-destination', scope: 'project-local', projectPath, destination: null },
        access,
      )
      expect(current().changeRequestOpenDestinationByProject).toEqual({})
    })

    it('requires a project for the project scopes', async () => {
      const { access } = memoryAccess()
      await expect(
        configureSourceControl(
          { kind: 'set-open-destination', scope: 'project-local', destination: 'website' },
          access,
        ),
      ).resolves.toMatchObject({ ok: false })
    })

    it('remembers only a Provider account the CLI holds for the repository host', async () => {
      const { access, current } = memoryAccess()
      const readCliHosts = async () => CLI_HOSTS

      await expect(
        configureSourceControl(
          { kind: 'set-repository-account', repository: 'github.com/acme/app', login: 'jdoe_acme' },
          access,
          { readCliHosts },
        ),
      ).resolves.toEqual({ ok: true })
      expect(current().sourceControlRepositoryAccounts).toEqual({
        'github.com/acme/app': 'jdoe_acme',
      })

      await expect(
        configureSourceControl(
          { kind: 'set-repository-account', repository: 'github.com/acme/app', login: 'stranger' },
          access,
          { readCliHosts },
        ),
      ).resolves.toMatchObject({ ok: false })

      await configureSourceControl(
        { kind: 'set-repository-account', repository: 'github.com/acme/app', login: null },
        access,
        { readCliHosts },
      )
      expect(current().sourceControlRepositoryAccounts).toEqual({})
    })
  })
})
