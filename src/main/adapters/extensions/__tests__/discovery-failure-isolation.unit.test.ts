import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { discoverExtensionPackages } from '../discovery'

let tmpRoot = ''

async function writeText(filePath: string, value: string) {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, value, 'utf-8')
}

async function writeJson(filePath: string, value: unknown) {
  await writeText(filePath, `${JSON.stringify(value, null, 2)}\n`)
}

function manifest(id: string) {
  return {
    manifestVersion: 1,
    id,
    name: id,
    version: '1.0.0',
    sdk: { openwaggle: '>=0.1.0 <0.2.0' },
    sourceFiles: ['src/index.ts'],
    builtArtifacts: ['dist/index.js'],
  }
}

async function writeHealthyPackage(rootPath: string, id: string) {
  const packagePath = path.join(rootPath, id)
  await writeJson(path.join(packagePath, OPENWAGGLE_EXTENSION.MANIFEST_FILE), manifest(id))
  await writeText(path.join(packagePath, 'src', 'index.ts'), 'export const source = true\n')
  await writeText(path.join(packagePath, 'dist', 'index.js'), 'export const built = true\n')
}

describe('discoverExtensionPackages failure isolation', () => {
  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-extensions-'))
  })

  afterEach(async () => {
    if (tmpRoot) {
      await fs.rm(tmpRoot, { recursive: true, force: true })
      tmpRoot = ''
    }
  })

  it('keeps discovering healthy packages when a sibling manifest is malformed', async () => {
    const projectPath = path.join(tmpRoot, 'project')
    const rootPath = path.join(projectPath, '.openwaggle', 'extensions')
    const brokenPackagePath = path.join(rootPath, 'broken-extension')
    await writeText(path.join(brokenPackagePath, OPENWAGGLE_EXTENSION.MANIFEST_FILE), '{ "id": ')
    await writeHealthyPackage(rootPath, 'healthy-extension')

    const packages = await discoverExtensionPackages({
      projectPath,
      hostSdkVersion: OPENWAGGLE_EXTENSION.SDK_VERSION,
    })
    const brokenPackage = packages.find(
      (extensionPackage) => extensionPackage.id === 'broken-extension',
    )
    const healthyPackage = packages.find(
      (extensionPackage) => extensionPackage.id === 'healthy-extension',
    )

    expect(packages.map((extensionPackage) => extensionPackage.id)).toEqual([
      'broken-extension',
      'healthy-extension',
    ])
    expect(brokenPackage?.manifest).toBeNull()
    expect(brokenPackage?.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      'manifest-json-invalid',
    ])
    expect(healthyPackage?.manifest?.id).toBe('healthy-extension')
    expect(healthyPackage?.diagnostics).toEqual([])
    expect(healthyPackage?.contentHash).toHaveLength(OPENWAGGLE_EXTENSION.HASH.HEX_LENGTH)
  })
})
