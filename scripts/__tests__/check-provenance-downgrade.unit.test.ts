import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  checkProvenanceDowngrades,
  compactProvenanceCache,
  createRegistryClient,
  formatProvenanceFailures,
  lockedRegistryVersions,
  packumentUrl,
  parseProvenanceCache,
  type RegistryClient,
} from '../check-provenance-downgrade'
import {
  findProvenanceDowngrade,
  type LockedVersion,
  type PackageProvenance,
  parseAbbreviatedPackument,
  parsePublishTimes,
} from '../provenance-downgrade'
import { PROVENANCE_DOWNGRADE_EXCEPTIONS } from '../provenance-downgrade-policy'

const FIXTURES = path.join(import.meta.dirname, 'fixtures/provenance-downgrade')
const NOW = new Date('2026-11-10T00:00:00.000Z')
const WINDOW_DAYS = 30

function readFixture(name: string) {
  const parsed: unknown = JSON.parse(readFileSync(path.join(FIXTURES, name), 'utf8'))
  return parsed
}

function fixtureRegistry() {
  const synthetic = readFixture('synthetic-registry.json')
  if (typeof synthetic !== 'object' || synthetic === null) {
    throw new Error('Invalid registry fixture.')
  }
  const registry = new Map<string, { readonly abbreviated: unknown; readonly full: unknown }>(
    Object.entries(synthetic).map(
      ([name, documents]: [string, { abbreviated: unknown; full: unknown }]) => [name, documents],
    ),
  )
  registry.set('@pierre/theme', {
    abbreviated: readFixture('pierre-theme.abbreviated.json'),
    full: readFixture('pierre-theme.full.json'),
  })
  return registry
}

function recordingClient() {
  const registry = fixtureRegistry()
  const requests: string[] = []
  const client: RegistryClient = {
    async fetchPackument(name, abbreviated) {
      requests.push(`${abbreviated ? 'abbreviated' : 'full'} ${name}`)
      const documents = registry.get(name)
      if (!documents) {
        throw new Error(`Could not read the registry metadata for ${name}: 404 Not Found`)
      }
      return abbreviated ? documents.abbreviated : documents.full
    },
  }
  return { client, requests }
}

function check(locked: readonly LockedVersion[], client: RegistryClient, cache = { packages: {} }) {
  return checkProvenanceDowngrades({
    locked,
    cache,
    client,
    exceptions: PROVENANCE_DOWNGRADE_EXCEPTIONS,
    now: NOW,
    windowDays: WINDOW_DAYS,
  })
}

describe('provenance downgrade check', () => {
  it('reads provenance from abbreviated registry metadata', () => {
    expect(
      parseAbbreviatedPackument(readFixture('pierre-theme.abbreviated.json'), '@pierre/theme'),
    ).toEqual({
      '1.0.2': true,
      '1.0.3': true,
      '1.1.0': false,
      '2.0.0': false,
    })
    expect(parsePublishTimes(readFixture('pierre-theme.full.json'), '@pierre/theme')).toEqual({
      '1.0.2': '2026-05-18T22:31:07.725Z',
      '1.0.3': '2026-05-18T22:44:21.199Z',
      '1.1.0': '2026-06-26T00:09:31.326Z',
      '2.0.0': '2026-07-24T22:01:50.133Z',
    })
    expect(() => parseAbbreviatedPackument({ error: 'Not found' }, 'missing')).toThrow(
      'has no versions object',
    )
  })

  it('fails a recent release that lost the provenance earlier releases had', async () => {
    const { client } = recordingClient()
    const result = await check([{ name: 'takeover-package', version: '1.2.0' }], client)

    expect(result.violations).toEqual([
      { name: 'takeover-package', version: '1.2.0', lastAttestedVersion: '1.1.0' },
    ])
    expect(formatProvenanceFailures(result, WINDOW_DAYS)).toEqual([
      'takeover-package@1.2.0 has no npm provenance, but takeover-package@1.1.0 did, and it was published ' +
        'less than 30 days ago. Pin an attested version, or review it and add an exception with its reason ' +
        'to scripts/provenance-downgrade-policy.ts.',
      'The provenance exception for @pierre/theme matches no locked downgrade; remove it from ' +
        'scripts/provenance-downgrade-policy.ts.',
    ])
  })

  it('passes attested, never-attested, canary-only and later-adopting packages', async () => {
    const { client } = recordingClient()
    const result = await check(
      [
        { name: '@pierre/theme', version: '1.0.3' },
        { name: 'takeover-package', version: '1.1.0' },
        { name: 'never-attested', version: '3.1.0' },
        { name: 'attested-canary', version: '2.0.0' },
        { name: 'late-adopter', version: '4.0.0' },
      ],
      client,
    )

    expect(result.violations).toEqual([])
    expect(result.aged).toEqual([])
    expect(result.missing).toEqual([])
  })

  it('exempts a downgrade older than the window', async () => {
    const { client } = recordingClient()
    const result = await checkProvenanceDowngrades({
      locked: [{ name: 'takeover-package', version: '1.2.0' }],
      cache: { packages: {} },
      client,
      exceptions: [],
      now: new Date('2026-12-01T00:00:01.000Z'),
      windowDays: WINDOW_DAYS,
    })

    expect(result.violations).toEqual([])
    expect(result.aged).toEqual([
      { name: 'takeover-package', version: '1.2.0', lastAttestedVersion: '1.1.0' },
    ])
    expect(formatProvenanceFailures(result, WINDOW_DAYS)).toEqual([])
  })

  it('lets the reviewed @pierre/theme exception through and no other package', async () => {
    const { client } = recordingClient()
    const result = await check(
      [
        { name: '@pierre/theme', version: '2.0.0' },
        { name: 'takeover-package', version: '1.2.0' },
      ],
      client,
    )

    expect(result.excepted).toEqual([
      { name: '@pierre/theme', version: '2.0.0', lastAttestedVersion: '1.0.3' },
    ])
    expect(result.violations.map((entry) => entry.name)).toEqual(['takeover-package'])
    expect(result.staleExceptions).toEqual([])
  })

  it('fails closed when the registry does not list a locked version', async () => {
    const { client } = recordingClient()
    const result = await check(
      [
        { name: '@pierre/theme', version: '2.0.0' },
        { name: 'takeover-package', version: '9.9.9' },
      ],
      client,
    )
    expect(formatProvenanceFailures(result, WINDOW_DAYS)).toEqual([
      'takeover-package@9.9.9 is locked in bun.lock but the registry does not list it with a publish time.',
    ])

    await expect(check([{ name: 'unpublished', version: '1.0.0' }], client)).rejects.toThrow(
      'Could not read the registry metadata for unpublished: 404 Not Found',
    )
  })

  it('fetches each package once and answers a repeat run from the compacted cache', async () => {
    const locked = [
      { name: '@pierre/theme', version: '2.0.0' },
      { name: 'takeover-package', version: '1.1.0' },
      { name: 'never-attested', version: '3.1.0' },
    ]
    const first = recordingClient()
    const cache = { packages: {} }
    const firstResult = await check(locked, first.client, cache)

    expect(firstResult.fetched).toBe(4)
    expect(first.requests.sort()).toEqual([
      'abbreviated @pierre/theme',
      'abbreviated never-attested',
      'abbreviated takeover-package',
      'full @pierre/theme',
    ])

    const stored = parseProvenanceCache(JSON.stringify(compactProvenanceCache(cache, locked)))
    expect(stored.packages['@pierre/theme']).toEqual({
      versions: { '1.0.2': true, '1.0.3': true, '2.0.0': false },
      published: {
        '1.0.2': '2026-05-18T22:31:07.725Z',
        '1.0.3': '2026-05-18T22:44:21.199Z',
        '2.0.0': '2026-07-24T22:01:50.133Z',
      },
    })
    expect(stored.packages['never-attested']).toEqual({
      versions: { '3.1.0': false },
      published: {},
    })

    const second = recordingClient()
    const secondResult = await check(locked, second.client, stored)
    expect(second.requests).toEqual([])
    expect(secondResult.fetched).toBe(0)
    expect(secondResult.excepted).toEqual(firstResult.excepted)

    const third = recordingClient()
    await check([...locked, { name: 'takeover-package', version: '1.2.0' }], third.client, stored)
    expect(third.requests).toEqual(['abbreviated takeover-package', 'full takeover-package'])
  })

  it('ignores a cache it cannot read', () => {
    expect(parseProvenanceCache('{"packages": {"x": {"versions": [1]}}}')).toEqual({ packages: {} })
    expect(parseProvenanceCache('[]')).toEqual({ packages: {} })
  })

  it('reads the registry packages of a bun.lock once each', () => {
    const lockfile = JSON.stringify({
      lockfileVersion: 1,
      workspaces: { '': { name: 'root' } },
      packages: {
        semver: ['semver@7.7.2', '', {}, 'sha512-a'],
        'make-dir/semver': ['semver@6.3.1', '', {}, 'sha512-b'],
        'other/semver': ['semver@6.3.1', '', {}, 'sha512-b'],
        '@openwaggle/waggle-core': ['@openwaggle/waggle-core@workspace:packages/waggle-core'],
      },
    })

    expect(lockedRegistryVersions(lockfile)).toEqual([
      { name: 'semver', version: '6.3.1' },
      { name: 'semver', version: '7.7.2' },
    ])
  })

  it('compares a stable version only with stable versions published before it', () => {
    const metadata: PackageProvenance = {
      versions: { '1.0.0-rc.1': true, '1.0.0': false, '0.9.0': true, '2.0.0': true },
      published: {
        '1.0.0-rc.1': '2026-01-01T00:00:00.000Z',
        '0.9.0': '2026-01-02T00:00:00.000Z',
        '1.0.0': '2026-02-01T00:00:00.000Z',
        '2.0.0': '2026-03-01T00:00:00.000Z',
      },
    }
    expect(findProvenanceDowngrade(metadata, '1.0.0')).toBe('0.9.0')
    expect(
      findProvenanceDowngrade(
        { ...metadata, versions: { ...metadata.versions, '0.9.0': false } },
        '1.0.0',
      ),
    ).toBe(undefined)
  })

  it('retries a failing registry and requests abbreviated metadata by encoded name', async () => {
    const requests: { url: string; accept: string | null }[] = []
    let calls = 0
    const fetchImpl: typeof fetch = async (input, init) => {
      calls += 1
      requests.push({
        url: input instanceof Request ? input.url : String(input),
        accept: new Headers(init?.headers).get('accept'),
      })
      if (calls === 1) {
        return new Response('busy', { status: 503, statusText: 'Service Unavailable' })
      }
      return Response.json({ versions: {} })
    }

    await expect(
      createRegistryClient(fetchImpl).fetchPackument('@pierre/theme', true),
    ).resolves.toEqual({
      versions: {},
    })
    expect(requests).toEqual([
      { url: packumentUrl('@pierre/theme'), accept: 'application/vnd.npm.install-v1+json' },
      { url: packumentUrl('@pierre/theme'), accept: 'application/vnd.npm.install-v1+json' },
    ])
    expect(packumentUrl('@pierre/theme')).toBe('https://registry.npmjs.org/@pierre%2ftheme')

    const notFound: typeof fetch = async () =>
      new Response('', { status: 404, statusText: 'Not Found' })
    await expect(createRegistryClient(notFound).fetchPackument('missing', true)).rejects.toThrow(
      'Could not read the registry metadata for missing: 404 Not Found',
    )
  })
})
