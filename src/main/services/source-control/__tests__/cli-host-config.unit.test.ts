import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readSourceControlCliHosts } from '../cli-host-config'

let root: string

async function write(relative: string, content: string) {
  const file = join(root, relative)
  await mkdir(join(file, '..'), { recursive: true })
  await writeFile(file, content)
}

describe('reading the hosts gh and glab are configured for', () => {
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'openwaggle-cli-hosts-'))
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('reads GitHub hosts with their accounts and the active one', async () => {
    await write(
      'gh/hosts.yml',
      [
        'github.com:',
        '    git_protocol: ssh',
        '    users:',
        '        jdoe:',
        '        jdoe_acme:',
        '    user: jdoe_acme',
        'GHE.Acme.IO:',
        '    users:',
        '        jdoe:',
        '    user: jdoe',
        '',
      ].join('\n'),
    )

    const hosts = await readSourceControlCliHosts({ gh: [join(root, 'gh')], glab: [] })

    expect(hosts.github).toEqual([
      {
        host: 'github.com',
        accounts: [
          { login: 'jdoe', active: false },
          { login: 'jdoe_acme', active: true },
        ],
      },
      { host: 'ghe.acme.io', accounts: [{ login: 'jdoe', active: true }] },
    ])
    expect(hosts.gitlab).toEqual([])
  })

  it('reads GitLab hosts, signed in or not, with their SSH host aliases', async () => {
    await write(
      'glab-cli/config.yml',
      [
        'git_protocol: ssh',
        'hosts:',
        '    gitlab.com:',
        '        api_protocol: https',
        '        token:',
        '    gitlab.acme.io:',
        '        token: glpat-secret',
        '        ssh_host: ssh.gitlab.acme.io',
        '        user: jdoe',
        '',
      ].join('\n'),
    )

    const hosts = await readSourceControlCliHosts({ gh: [], glab: [join(root, 'glab-cli')] })

    expect(hosts.gitlab).toEqual([
      { host: 'gitlab.com', sshHost: null, accounts: [] },
      {
        host: 'gitlab.acme.io',
        sshHost: 'ssh.gitlab.acme.io',
        accounts: [{ login: 'jdoe', active: true }],
      },
    ])
    expect(JSON.stringify(hosts)).not.toContain('glpat-secret')
  })

  it('uses the first configuration directory that exists', async () => {
    await write('second/hosts.yml', 'code.acme.io:\n    user: jdoe\n    users:\n        jdoe:\n')

    const hosts = await readSourceControlCliHosts({
      gh: [join(root, 'missing'), join(root, 'second')],
      glab: [],
    })

    expect(hosts.github.map((entry) => entry.host)).toEqual(['code.acme.io'])
  })

  it('reads nothing from missing or malformed files', async () => {
    await write('broken/hosts.yml', ':::: not yaml [')

    await expect(
      readSourceControlCliHosts({ gh: [join(root, 'broken')], glab: [join(root, 'none')] }),
    ).resolves.toEqual({ github: [], gitlab: [] })
  })
})
