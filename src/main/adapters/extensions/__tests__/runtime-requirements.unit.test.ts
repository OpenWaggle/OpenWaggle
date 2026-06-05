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

async function writeRuntimeRequirementPackage() {
  const projectPath = path.join(tmpRoot, 'project')
  const packagePath = path.join(
    projectPath,
    ...OPENWAGGLE_EXTENSION.PROJECT_ROOT_SEGMENTS,
    'sample-extension',
  )
  await writeJson(path.join(packagePath, OPENWAGGLE_EXTENSION.MANIFEST_FILE), {
    manifestVersion: 1,
    id: 'sample-extension',
    name: 'Sample Extension',
    version: '1.0.0',
    sdk: { openwaggle: '>=0.1.0 <0.2.0' },
    sourceFiles: ['src/index.ts'],
    builtArtifacts: ['dist/index.js'],
    runtimeRequirements: [
      {
        id: 'sample.missing-cli',
        label: 'Missing CLI',
        binary: 'openwaggle-missing-runtime-cli',
      },
    ],
  })
  await writeText(path.join(packagePath, 'src', 'index.ts'), 'export const source = true\n')
  await writeText(path.join(packagePath, 'dist', 'index.js'), 'export const built = true\n')
  return projectPath
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

  it('diagnoses missing external runtime requirement binaries without installing them', async () => {
    const projectPath = await writeRuntimeRequirementPackage()

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
