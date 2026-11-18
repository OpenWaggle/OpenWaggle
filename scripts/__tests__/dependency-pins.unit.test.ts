import { describe, expect, it } from 'vitest'
import { cachedLatest, latestDistTag } from '../check-dependency-pins'
import type { RegistryClient } from '../check-provenance-downgrade'
import {
  changedPins,
  type ManifestPin,
  manifestPins,
  parseDependencyLines,
  pinViolations,
} from '../dependency-pins/pins'

function dependencies(...lines: string[]) {
  return ['# Dependencies', '', 'Intro.', '', '## Held', '', ...lines, '', 'After.'].join('\n')
}

function pin(name: string, spec: string, overrides: Partial<ManifestPin> = {}) {
  return {
    package: name,
    spec,
    manifest: 'package.json',
    section: 'dependencies',
    ...overrides,
  } satisfies ManifestPin
}

function line(name: string, version: string, at = 1) {
  return { package: name, pin: version, held: 'Held', unblockedBy: 'Later', line: at }
}

function latestOf(versions: Record<string, string>) {
  const asked: string[] = []
  const latest = async (name: string) => {
    asked.push(name)
    return versions[name]
  }
  return { asked, latest }
}

describe('parseDependencyLines', () => {
  it('reads scoped and prerelease pins with their reasons and lines', () => {
    const result = parseDependencyLines(
      dependencies(
        '- `node-pty@1.1.0`. Held: patched. See `x`. Unblocked by: re-porting the patch.',
        '- `@xterm/xterm@6.1.0-beta.303`. Held: stable lacks a protocol. Unblocked by: a release',
      ),
    )
    expect(result.findings).toEqual([])
    expect(result.lines).toEqual([
      {
        package: 'node-pty',
        pin: '1.1.0',
        held: 'patched. See `x`',
        unblockedBy: 're-porting the patch',
        line: 7,
      },
      {
        package: '@xterm/xterm',
        pin: '6.1.0-beta.303',
        held: 'stable lacks a protocol',
        unblockedBy: 'a release',
        line: 8,
      },
    ])
  })

  it('reports duplicate and malformed pin lines, and keeps two versions of one package', () => {
    const result = parseDependencyLines(
      dependencies(
        '- `zod@4.6.5`. Held: nothing. Unblocked by: the batch.',
        '- `zod@4.6.5`. Held: again. Unblocked by: the batch.',
        '- `zod@4.6.4`. Held: an older copy. Unblocked by: the batch.',
        '- `ws@8.21.3`. Held: nothing.',
        '- `@scope`. Held: x. Unblocked by: y.',
        '- plain bullet without a pin',
      ),
    )
    expect(result.lines.map((entry) => `${entry.package}@${entry.pin}`)).toEqual([
      'zod@4.6.5',
      'zod@4.6.4',
    ])
    expect(result.findings).toEqual([
      { line: 8, kind: 'duplicate-line', message: '`zod@4.6.5` already has a line on line 7' },
      {
        line: 10,
        kind: 'bad-line',
        message: 'a pin line reads `- `name@version`. Held: <why>. Unblocked by: <what>.`',
      },
      {
        line: 11,
        kind: 'bad-line',
        message: 'a pin line reads `- `name@version`. Held: <why>. Unblocked by: <what>.`',
      },
    ])
  })
})

describe('manifestPins', () => {
  it('reads pinned sections and catalogs, not peers', () => {
    const manifest = JSON.stringify({
      dependencies: { zod: '4.6.5', '@openwaggle/waggle-core': 'workspace:*' },
      devDependencies: { vitest: '4.1.11' },
      optionalDependencies: { '@img/sharp-linux-x64': '0.35.4' },
      peerDependencies: { react: '^19.0.0' },
      workspaces: {
        packages: ['packages/*'],
        catalog: { tsx: '4.23.13' },
        catalogs: { 'pi-runtime': { '@earendil-works/pi-ai': '1.4.0' } },
      },
    })
    expect(manifestPins('package.json', manifest)).toEqual([
      pin('zod', '4.6.5'),
      pin('@openwaggle/waggle-core', 'workspace:*'),
      pin('vitest', '4.1.11', { section: 'devDependencies' }),
      pin('@img/sharp-linux-x64', '0.35.4', { section: 'optionalDependencies' }),
      pin('tsx', '4.23.13', { section: 'catalog:default' }),
      pin('@earendil-works/pi-ai', '1.4.0', { section: 'catalog:pi-runtime' }),
    ])
  })
})

describe('changedPins', () => {
  it('returns added and changed specs, skipping references', () => {
    const before = [pin('zod', '4.6.5'), pin('ws', '8.21.3')]
    const after = [
      pin('zod', '4.6.7'),
      pin('ws', '8.21.3'),
      pin('ms', '2.1.3'),
      pin('ws', '8.21.3', { manifest: 'website/package.json' }),
      pin('@openwaggle/extension-sdk', 'workspace:^'),
      pin('typebox', 'catalog:pi-extension-host'),
    ]
    expect(changedPins(before, after)).toEqual([
      pin('zod', '4.6.7'),
      pin('ms', '2.1.3'),
      pin('ws', '8.21.3', { manifest: 'website/package.json' }),
    ])
  })
})

describe('pinViolations', () => {
  it('passes a changed pin at latest or with a matching line', async () => {
    const { asked, latest } = latestOf({ zod: '4.6.7' })
    const changed = [pin('zod', '4.6.7'), pin('node-pty', '1.1.0')]
    const violations = await pinViolations({
      changed,
      all: changed,
      lines: [line('node-pty', '1.1.0')],
      latest,
    })
    expect(violations).toEqual([])
    expect(asked).toEqual(['zod'])
  })

  it('needs a line for the new version of a pin behind latest', async () => {
    const { latest } = latestOf({ electron: '45.2.3' })
    const changed = [pin('electron', '43.3.0', { section: 'devDependencies' })]
    const violations = await pinViolations({
      changed,
      all: changed,
      lines: [line('electron', '43.2.0', 12)],
      latest,
    })
    expect(violations).toEqual([
      {
        package: 'electron',
        manifest: 'DEPENDENCIES.md',
        line: 12,
        kind: 'stale-line',
        message:
          'the line pins `electron@43.2.0` but the manifests pin `43.3.0`; update or remove the line',
      },
      {
        package: 'electron',
        manifest: 'package.json',
        line: 1,
        kind: 'missing-line',
        message:
          '`electron` `43.3.0` in devDependencies is not the latest release (`45.2.3`); add a DEPENDENCIES.md line for `electron@43.3.0`',
      },
    ])
  })

  it('reports unknown lines, ranges and an unreachable registry', async () => {
    const { asked, latest } = latestOf({})
    const changed = [pin('ws', '^8.21.3'), pin('ms', '2.1.3')]
    const violations = await pinViolations({
      changed,
      all: [...changed, pin('typebox', 'catalog:pi-extension-host')],
      lines: [line('typebox', '1.3.27', 4), line('left-pad', '1.3.0', 5)],
      latest,
    })
    expect(violations.map((entry) => [entry.kind, entry.package, entry.line])).toEqual([
      ['unknown-line', 'typebox', 4],
      ['unknown-line', 'left-pad', 5],
      ['not-exact', 'ws', 1],
      ['latest-unknown', 'ms', 1],
    ])
    expect(asked).toEqual(['ms'])
  })

  it('checks lines offline when nothing changed', async () => {
    const violations = await pinViolations({
      changed: [],
      all: [pin('zod', '4.6.5')],
      lines: [line('zod', '4.6.5')],
      latest: () => Promise.reject(new Error('no network')),
    })
    expect(violations).toEqual([])
  })
})

describe('cachedLatest', () => {
  const NOW = 1_800_000_000_000

  /** Packuments by package name. */
  function client(documents: Readonly<Record<string, object>>) {
    const fetched: string[] = []
    const registry: RegistryClient = {
      async fetchPackument(name) {
        fetched.push(name)
        if (!(name in documents)) throw new Error(`offline: ${name}`)
        return documents[name]
      },
    }
    return { fetched, registry }
  }

  it('reads dist-tags.latest once and caches it', async () => {
    const { fetched, registry } = client({ zod: { 'dist-tags': { latest: '4.6.7' } } })
    const cache = {}
    const latest = cachedLatest({ cache, client: registry, now: NOW })
    expect(await Promise.all([latest('zod'), latest('zod')])).toEqual(['4.6.7', '4.6.7'])
    expect(fetched).toEqual(['zod'])
    expect(cache).toEqual({ zod: { latest: '4.6.7', checkedAt: NOW } })
  })

  it('answers undefined offline and refetches an expired entry', async () => {
    const { fetched, registry } = client({ ws: { 'dist-tags': { latest: '8.22.2' } } })
    const cache = { ws: { latest: '8.21.0', checkedAt: 0 } }
    const latest = cachedLatest({ cache, client: registry, now: NOW })
    expect(await latest('ws')).toBe('8.22.2')
    expect(await latest('ms')).toBeUndefined()
    expect(fetched).toEqual(['ws', 'ms'])
    expect(latestDistTag({ 'dist-tags': {} })).toBeUndefined()
  })
})
