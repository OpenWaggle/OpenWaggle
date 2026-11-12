import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  packageClosure,
  packagedRuntimePackages,
  resolvePackageDirectory,
  runtimeDependencyNames,
} from '../packaged-runtime-packages'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

function writePackage(directory: string, manifest: Record<string, unknown>) {
  fs.mkdirSync(directory, { recursive: true })
  fs.writeFileSync(path.join(directory, 'package.json'), JSON.stringify(manifest))
}

/**
 * A project installed with the isolated linker: each top-level package is a symlink into
 * `node_modules/.bun/<id>/node_modules/<name>`, beside its own dependencies.
 */
function isolatedProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-packages-'))
  roots.push(root)
  const store = path.join(root, 'node_modules', '.bun')
  const place = (id: string, name: string, manifest: Record<string, unknown>, deps: string[]) => {
    const directory = path.join(store, id, 'node_modules', name)
    writePackage(directory, { name, ...manifest })
    for (const dependency of deps) {
      const link = path.join(store, id, 'node_modules', dependency)
      fs.mkdirSync(path.dirname(link), { recursive: true })
      fs.symlinkSync(
        path.join(store, `${dependency.replace('/', '+')}@1`, 'node_modules', dependency),
        link,
      )
    }
    return directory
  }
  place('native@1', 'native', { dependencies: { helper: '1' } }, ['helper'])
  place(
    'helper@1',
    'helper',
    {
      peerDependencies: { peer: '1', optionalPeer: '1' },
      peerDependenciesMeta: { optionalPeer: { optional: true } },
    },
    ['peer'],
  )
  place('peer@1', 'peer', {}, [])
  place('sdk@1', 'sdk', { dependencies: { helper: '1', 'sdk-only': '1' } }, ['helper', 'sdk-only'])
  place('sdk-only@1', 'sdk-only', {}, [])
  place('mammoth@1', 'mammoth', {}, [])
  for (const name of ['native', 'sdk', 'mammoth']) {
    fs.symlinkSync(
      path.join(store, `${name}@1`, 'node_modules', name),
      path.join(root, 'node_modules', name),
    )
  }
  writePackage(root, { dependencies: { native: '1', sdk: '1', mammoth: '1', missing: '1' } })
  return root
}

describe('packaged runtime packages', () => {
  it('needs dependencies, optional dependencies and required peers', () => {
    expect(
      runtimeDependencyNames({
        dependencies: { a: '1' },
        optionalDependencies: { b: '1' },
        peerDependencies: { c: '1', d: '1' },
        peerDependenciesMeta: { d: { optional: true } },
      }),
    ).toEqual(['a', 'b', 'c'])
  })

  it('resolves a dependency the way Node does, from the store of its dependent', () => {
    const root = isolatedProject()
    const native = resolvePackageDirectory('native', root)
    expect(native).toBe(
      fs.realpathSync(path.join(root, 'node_modules/.bun/native@1/node_modules/native')),
    )
    expect(resolvePackageDirectory('helper', native ?? root)).toContain(
      `${path.sep}helper@1${path.sep}`,
    )
    expect(resolvePackageDirectory('helper', root)).toBeUndefined()
  })

  it('follows every runtime edge and skips what is not installed', () => {
    const root = isolatedProject()
    expect([...packageClosure(['native', 'missing'], root)].sort()).toEqual([
      'helper',
      'native',
      'peer',
    ])
  })

  it('ships the externals, the packages workers resolve by path and their dependencies only', () => {
    const root = isolatedProject()
    const packages = packagedRuntimePackages(root, ['native'])
    expect([...packages.runtime].sort()).toEqual(['helper', 'mammoth', 'native', 'peer'])
    expect(packages.unshipped).toEqual(['sdk', 'sdk-only'])
  })
})
