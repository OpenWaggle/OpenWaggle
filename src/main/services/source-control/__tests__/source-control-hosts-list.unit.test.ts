import { describe, expect, it } from 'vitest'
import { listSourceControlHosts } from '../source-control-hosts-list'
import { CLI_HOSTS, memoryAccess } from './source-control-settings-memory'

describe('the Source control hosts list', () => {
  it('merges CLI hosts with user choices and detected hosts', async () => {
    const { access } = memoryAccess({
      sourceControlHostProviders: { 'code.acme.io': 'github', 'bb.acme.io': 'unsupported' },
      sourceControlDetectedHostProviders: { 'git2.acme.io': 'gitlab' },
      sourceControlProjectDeclarations: {
        '/p': { approved: { 'decl.acme.io': 'gitlab' }, declined: {} },
        '/q': { approved: {}, declined: { 'nope.acme.io': 'github' } },
      },
    })

    const overview = await listSourceControlHosts(access, {
      readCliHosts: async () => CLI_HOSTS,
      isCliInstalled: async (cli) => cli === 'gh',
    })

    expect(overview.cliInstalled).toEqual({ gh: true, glab: false })
    expect(overview.hosts).toEqual([
      {
        host: 'bb.acme.io',
        provider: null,
        source: 'user-choice',
        unsupported: true,
        cli: null,
        cliInstalled: false,
        accounts: [],
      },
      {
        host: 'code.acme.io',
        provider: 'github',
        source: 'user-choice',
        unsupported: false,
        cli: 'gh',
        cliInstalled: true,
        accounts: [],
      },
      {
        host: 'decl.acme.io',
        provider: 'gitlab',
        source: 'project-declaration',
        unsupported: false,
        cli: 'glab',
        cliInstalled: false,
        accounts: [],
      },
      {
        host: 'git.acme.io',
        provider: 'gitlab',
        source: 'cli-sign-in',
        unsupported: false,
        cli: 'glab',
        cliInstalled: false,
        accounts: [{ login: 'jdoe', active: true }],
      },
      {
        host: 'git2.acme.io',
        provider: 'gitlab',
        source: 'remote-refs',
        unsupported: false,
        cli: 'glab',
        cliInstalled: false,
        accounts: [],
      },
      {
        host: 'github.com',
        provider: 'github',
        source: 'public-host',
        unsupported: false,
        cli: 'gh',
        cliInstalled: true,
        accounts: [
          { login: 'jdoe', active: true },
          { login: 'jdoe_acme', active: false },
        ],
      },
    ])
  })
})
