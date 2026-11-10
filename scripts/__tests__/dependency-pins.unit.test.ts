import { describe, expect, it } from 'vitest'
import { cachedLatest, latestDistTag } from '../check-dependency-pins'
import type { RegistryClient } from '../check-provenance-downgrade'
import {
  changedPins,
  type DependencyRow,
  formatPinFinding,
  type ManifestPin,
  manifestPins,
  parseDependencyRows,
  pinViolations,
} from '../dependency-pins/pins'

const HEADER = '| Package | Pin | Reason | Last known good |\n| --- | --- | --- | --- |'

function table(...rows: string[]) {
  return ['# Dependencies', '', 'Intro.', '', HEADER, ...rows, '', 'After.'].join('\n')
}

function pin(name: string, spec: string, overrides: Partial<ManifestPin> = {}): ManifestPin {
  return { package: name, spec, manifest: 'package.json', section: 'dependencies', ...overrides }
}

function row(name: string, version: string, line = 1): DependencyRow {
  return { package: name, pin: version, reason: 'Held', lastKnownGood: version, line }
}

function latestOf(versions: Record<string, string>) {
  const asked: string[] = []
  const latest = async (name: string) => {
    asked.push(name)
    return versions[name]
  }
  return { asked, latest }
}

describe('parseDependencyRows', () => {
  it('reads backticked cells and their lines', () => {
    const result = parseDependencyRows(
      table('| `node-pty` | `1.1.0` | Patched | `1.1.0` |', '| zod | 4.6.5 | Behind | 4.6.5 |'),
    )
    expect(result.problems).toEqual([])
    expect(result.rows).toEqual([
      { package: 'node-pty', pin: '1.1.0', reason: 'Patched', lastKnownGood: '1.1.0', line: 7 },
      { package: 'zod', pin: '4.6.5', reason: 'Behind', lastKnownGood: '4.6.5', line: 8 },
    ])
  })

  it('reports duplicate rows, short rows and a missing table', () => {
    const result = parseDependencyRows(
      table(
        '| `zod` | `4.6.5` | Behind | `4.6.5` |',
        '| `zod` | `4.6.5` | Again | `4.6.5` |',
        '| `ws` | `8.21.3` | |',
      ),
    )
    expect(result.rows.map((entry) => entry.package)).toEqual(['zod'])
    expect(result.problems).toEqual([
      'DEPENDENCIES.md:8:1 duplicate-row [DEP-03] `zod` `4.6.5` already has a row on line 7',
      'DEPENDENCIES.md:9:1 bad-row [DEP-03] a row needs four non-empty cells: Package, Pin, Reason, Last known good',
    ])
    expect(parseDependencyRows('# Dependencies\n').problems).toEqual([
      'DEPENDENCIES.md:1:1 no-table [DEP-03] no "| Package | Pin | Reason | Last known good |" table',
    ])
  })

  it('keeps two pins of one package as two rows', () => {
    const result = parseDependencyRows(
      table('| `react` | `19.3.0` | A | `19.3.0` |', '| `react` | `19.2.0` | B | `19.2.0` |'),
    )
    expect(result.rows).toHaveLength(2)
    expect(result.problems).toEqual([])
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
  it('passes a changed pin at latest or with a matching row', async () => {
    const { asked, latest } = latestOf({ zod: '4.6.7' })
    const changed = [pin('zod', '4.6.7'), pin('node-pty', '1.1.0')]
    const violations = await pinViolations({
      changed,
      all: changed,
      rows: [row('node-pty', '1.1.0')],
      latest,
    })
    expect(violations).toEqual([])
    expect(asked).toEqual(['zod'])
  })

  it('needs a row whose Pin is the new spec for a pin behind latest', async () => {
    const { latest } = latestOf({ electron: '45.2.3' })
    const changed = [pin('electron', '43.3.0', { section: 'devDependencies' })]
    const violations = await pinViolations({
      changed,
      all: changed,
      rows: [row('electron', '43.2.0', 12)],
      latest,
    })
    expect(violations).toEqual([
      {
        package: 'electron',
        manifest: 'DEPENDENCIES.md',
        line: 12,
        kind: 'stale-row',
        message:
          'the row pins `electron` `43.2.0` but the manifests pin `43.3.0`; update or remove the row [DEP-03]',
      },
      {
        package: 'electron',
        manifest: 'package.json',
        line: 1,
        kind: 'missing-row',
        message:
          '`electron` `43.3.0` in devDependencies is not the latest release (`45.2.3`); add a DEPENDENCIES.md row with Pin `43.3.0` [DEP-03]',
      },
    ])
  })

  it('reports unknown rows, ranges and an unreachable registry', async () => {
    const { asked, latest } = latestOf({})
    const changed = [pin('ws', '^8.21.3'), pin('ms', '2.1.3')]
    const violations = await pinViolations({
      changed,
      all: [...changed, pin('typebox', 'catalog:pi-extension-host')],
      rows: [row('typebox', '1.3.27', 4), row('left-pad', '1.3.0', 5)],
      latest,
    })
    expect(violations.map((entry) => [entry.kind, entry.package, entry.line])).toEqual([
      ['unknown-row', 'typebox', 4],
      ['unknown-row', 'left-pad', 5],
      ['not-exact', 'ws', 1],
      ['latest-unknown', 'ms', 1],
    ])
    expect(violations.every((entry) => /\[DEP-0[13]\]$/.test(entry.message))).toBe(true)
    expect(violations[2]?.message).toMatch(/\[DEP-01\]$/)
    expect(asked).toEqual(['ms'])
  })

  it('checks rows offline when nothing changed', async () => {
    const violations = await pinViolations({
      changed: [],
      all: [pin('zod', '4.6.5')],
      rows: [row('zod', '4.6.5')],
      latest: () => Promise.reject(new Error('no network')),
    })
    expect(violations).toEqual([])
  })
})

describe('formatPinFinding', () => {
  it('moves the rule ID to the front', () => {
    expect(
      formatPinFinding({ file: 'package.json', line: 1, kind: 'not-exact', message: 'x [DEP-01]' }),
    ).toBe('package.json:1:1 not-exact [DEP-01] x')
  })
})

describe('cachedLatest', () => {
  const NOW = 1_800_000_000_000

  function client(documents: Record<string, unknown>) {
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
