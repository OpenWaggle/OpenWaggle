import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { discoverExtensionPackages } from '../discovery'

let tmpRoot = ''

async function writeJson(filePath: string, value: unknown) {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf-8')
}

async function writeText(filePath: string, value: string) {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, value, 'utf-8')
}

function manifestWithRuntimeRequirements(runtimeRequirements?: unknown) {
  return {
    manifestVersion: 1,
    id: 'sample-extension',
    name: 'Sample Extension',
    version: '1.0.0',
    sdk: { openwaggle: '>=0.1.0 <0.2.0' },
    sourceFiles: ['src/index.ts'],
    builtArtifacts: ['dist/index.js'],
    ...(runtimeRequirements !== undefined ? { runtimeRequirements } : {}),
  }
}

async function writeRuntimeRequirementPackage(runtimeRequirements?: unknown) {
  const projectPath = path.join(tmpRoot, 'project')
  const packagePath = path.join(
    projectPath,
    ...OPENWAGGLE_EXTENSION.PROJECT_ROOT_SEGMENTS,
    'sample-extension',
  )
  await writeJson(
    path.join(packagePath, OPENWAGGLE_EXTENSION.MANIFEST_FILE),
    manifestWithRuntimeRequirements(runtimeRequirements),
  )
  await writeText(path.join(packagePath, 'src', 'index.ts'), 'export const source = true\n')
  await writeText(path.join(packagePath, 'dist', 'index.js'), 'export const built = true\n')
  return { packagePath, projectPath }
}

async function discoverSingleProjectPackage(projectPath: string) {
  const packages = await discoverExtensionPackages({
    projectPath,
    hostSdkVersion: OPENWAGGLE_EXTENSION.SDK_VERSION,
  })

  expect(packages).toHaveLength(1)
  return packages[0]
}

describe('extension runtime requirement discovery diagnostics', () => {
  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-runtime-requirements-'))
  })

  afterEach(async () => {
    if (tmpRoot) {
      await fs.rm(tmpRoot, { recursive: true, force: true })
    }
  })

  it('keeps legacy manifests without runtime requirements valid', async () => {
    const { projectPath } = await writeRuntimeRequirementPackage()

    const extensionPackage = await discoverSingleProjectPackage(projectPath)

    expect(extensionPackage?.manifest?.runtimeRequirements).toBeUndefined()
    expect(extensionPackage?.diagnostics).toEqual([])
    expect(extensionPackage?.contentHash).toHaveLength(OPENWAGGLE_EXTENSION.HASH.HEX_LENGTH)
  })

  it('accepts package command runtime requirements and hashes the command file', async () => {
    const { packagePath, projectPath } = await writeRuntimeRequirementPackage([
      {
        kind: 'command',
        id: 'sample.provider',
        label: 'Sample provider module',
        command: 'extensions/provider.js',
      },
    ])
    await writeText(path.join(packagePath, 'extensions', 'provider.js'), 'export default {}\n')

    const extensionPackage = await discoverSingleProjectPackage(projectPath)

    expect(extensionPackage?.manifest?.runtimeRequirements?.[0]).toMatchObject({
      kind: 'command',
      id: 'sample.provider',
      command: 'extensions/provider.js',
    })
    expect(extensionPackage?.diagnostics).toEqual([])
    expect(extensionPackage?.contentHash).toHaveLength(OPENWAGGLE_EXTENSION.HASH.HEX_LENGTH)
  })

  it('diagnoses invalid runtime requirement declarations instead of silently loading them', async () => {
    const { projectPath } = await writeRuntimeRequirementPackage([
      {
        id: 'sample.empty',
        label: 'Empty requirement',
      },
    ])

    const extensionPackage = await discoverSingleProjectPackage(projectPath)

    expect(extensionPackage?.manifest).toBeNull()
    expect(extensionPackage?.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: OPENWAGGLE_EXTENSION.DIAGNOSTIC.SEVERITY.ERROR,
          code: OPENWAGGLE_EXTENSION.DIAGNOSTIC.CODE.MANIFEST_SCHEMA_INVALID,
          message: expect.stringContaining('exactly one runtime requirement target'),
        }),
      ]),
    )
  })

  it('diagnoses missing external runtime requirement binaries without installing them', async () => {
    const { projectPath } = await writeRuntimeRequirementPackage([
      {
        kind: 'binary',
        id: 'sample.missing-cli',
        label: 'Missing CLI',
        binary: 'openwaggle-missing-runtime-cli',
      },
    ])

    const packages = await discoverExtensionPackages({
      projectPath,
      hostSdkVersion: OPENWAGGLE_EXTENSION.SDK_VERSION,
    })

    expect(packages[0]?.contentHash).toHaveLength(OPENWAGGLE_EXTENSION.HASH.HEX_LENGTH)
    expect(packages[0]?.diagnostics).toEqual([
      expect.objectContaining({
        severity: OPENWAGGLE_EXTENSION.DIAGNOSTIC.SEVERITY.ERROR,
        code: OPENWAGGLE_EXTENSION.DIAGNOSTIC.CODE.RUNTIME_REQUIREMENT_MISSING,
        message: expect.stringContaining('does not install system binaries automatically'),
      }),
    ])
  })
})
