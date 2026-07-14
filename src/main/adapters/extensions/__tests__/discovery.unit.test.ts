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

function manifest(overrides: Record<string, unknown> = {}) {
  return {
    manifestVersion: 1,
    id: 'sample-extension',
    name: 'Sample Extension',
    version: '1.0.0',
    sdk: { openwaggle: '>=0.1.0 <0.2.0' },
    sourceFiles: ['src/index.ts'],
    builtArtifacts: ['dist/index.js'],
    ...overrides,
  }
}

async function writeExtensionPackage(rootPath: string, id: string, value = manifest({ id })) {
  const packagePath = path.join(rootPath, id)
  await writeJson(path.join(packagePath, OPENWAGGLE_EXTENSION.MANIFEST_FILE), value)
  await writeText(path.join(packagePath, 'src', 'index.ts'), 'export const source = true\n')
  await writeText(path.join(packagePath, 'dist', 'index.js'), 'export const built = true\n')
  return packagePath
}

async function discoverSingleProjectPackage(projectPath: string) {
  const packages = await discoverExtensionPackages({
    projectPath,
    hostSdkVersion: OPENWAGGLE_EXTENSION.SDK_VERSION,
  })

  expect(packages).toHaveLength(1)
  return packages[0]
}

describe('discoverExtensionPackages', () => {
  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-extensions-'))
  })

  afterEach(async () => {
    if (tmpRoot) {
      await fs.rm(tmpRoot, { recursive: true, force: true })
    }
  })

  it('discovers project-local and global extension packages with content hashes', async () => {
    const projectPath = path.join(tmpRoot, 'project')
    const globalRootPath = path.join(tmpRoot, 'user-data', 'extensions')
    await writeExtensionPackage(
      path.join(projectPath, '.openwaggle', 'extensions'),
      'project-extension',
      manifest({ id: 'project-extension' }),
    )
    await writeExtensionPackage(
      globalRootPath,
      'global-extension',
      manifest({ id: 'global-extension' }),
    )

    const packages = await discoverExtensionPackages({
      projectPath,
      globalRootPath,
      hostSdkVersion: OPENWAGGLE_EXTENSION.SDK_VERSION,
    })

    expect(packages.map((entry) => entry.id)).toEqual(['global-extension', 'project-extension'])
    expect(packages.every((entry) => entry.diagnostics.length === 0)).toBe(true)
    expect(
      packages.every((entry) => entry.contentHash?.length === OPENWAGGLE_EXTENSION.HASH.HEX_LENGTH),
    ).toBe(true)
    expect(packages.map((entry) => entry.scope.kind)).toEqual([
      OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_KIND,
      OPENWAGGLE_EXTENSION.SCOPE.PROJECT_KIND,
    ])
  })

  it('returns manifest diagnostics without throwing on malformed packages', async () => {
    const projectPath = path.join(tmpRoot, 'project')
    const packagePath = path.join(projectPath, '.openwaggle', 'extensions', 'broken-extension')
    await writeText(path.join(packagePath, OPENWAGGLE_EXTENSION.MANIFEST_FILE), '{ "id": ')

    const packages = await discoverExtensionPackages({
      projectPath,
      hostSdkVersion: OPENWAGGLE_EXTENSION.SDK_VERSION,
    })

    expect(packages).toHaveLength(1)
    expect(packages[0]?.manifest).toBeNull()
    expect(packages[0]?.diagnostics.map((entry) => entry.code)).toEqual(['manifest-json-invalid'])
  })

  it('diagnoses missing artifacts and incompatible SDK ranges', async () => {
    const projectPath = path.join(tmpRoot, 'project')
    const rootPath = path.join(projectPath, '.openwaggle', 'extensions')
    const packagePath = await writeExtensionPackage(
      rootPath,
      'sample-extension',
      manifest({
        sdk: { openwaggle: '>=0.2.0 <0.3.0' },
        builtArtifacts: ['dist/missing.js'],
      }),
    )
    await fs.rm(path.join(packagePath, 'dist', 'index.js'), { force: true })

    const packages = await discoverExtensionPackages({
      projectPath,
      hostSdkVersion: OPENWAGGLE_EXTENSION.SDK_VERSION,
    })

    expect(packages[0]?.contentHash).toBeNull()
    expect(packages[0]?.diagnostics.map((entry) => entry.code)).toEqual(
      expect.arrayContaining(['built-artifact-missing', 'sdk-incompatible']),
    )
  })

  it('hashes runtime files even when they are not declared as built artifacts', async () => {
    const projectPath = path.join(tmpRoot, 'project')
    const rootPath = path.join(projectPath, '.openwaggle', 'extensions')
    const runtimePaths = [
      'dist/route.js',
      'dist/settings.js',
      'dist/panel.js',
      'dist/dialog.js',
      'dist/transcript.js',
      'dist/status.js',
      'dist/trusted-main.js',
      'dist/trusted-renderer.js',
      'scripts/setup.js',
    ] as const
    const packagePath = await writeExtensionPackage(
      rootPath,
      'sample-extension',
      manifest({
        contributions: {
          routes: [
            {
              id: 'sample.route',
              title: 'Sample Route',
              runtime: 'federated-module',
              execution: 'host-renderer',
              entry: runtimePaths[0],
            },
          ],
          settingsSections: [
            {
              id: 'sample.settings',
              title: 'Sample Settings',
              runtime: 'federated-module',
              execution: 'host-renderer',
              entry: runtimePaths[1],
            },
          ],
          sidePanels: [
            {
              id: 'sample.panel',
              title: 'Sample Panel',
              runtime: 'federated-module',
              execution: 'host-renderer',
              entry: runtimePaths[2],
            },
          ],
          dialogs: [
            {
              id: 'sample.dialog',
              title: 'Sample Dialog',
              runtime: 'federated-module',
              execution: 'host-renderer',
              entry: runtimePaths[3],
            },
          ],
          transcriptRenderers: [
            {
              id: 'sample.transcript',
              title: 'Sample Transcript',
              runtime: 'federated-module',
              execution: 'host-renderer',
              entry: runtimePaths[4],
            },
          ],
          statusWidgets: [
            {
              id: 'sample.status',
              title: 'Sample Status',
              runtime: 'federated-module',
              execution: 'host-renderer',
              entry: runtimePaths[5],
            },
          ],
        },
        trusted: {
          main: runtimePaths[6],
          renderer: runtimePaths[7],
        },
        runtimeRequirements: [
          {
            id: 'sample.setup',
            label: 'Sample Setup',
            command: runtimePaths[8],
          },
        ],
      }),
    )

    for (const runtimePath of runtimePaths) {
      await writeText(path.join(packagePath, runtimePath), `baseline ${runtimePath}\n`)
    }

    for (const runtimePath of runtimePaths) {
      for (const resetPath of runtimePaths) {
        await writeText(path.join(packagePath, resetPath), `baseline ${resetPath}\n`)
      }

      const before = await discoverSingleProjectPackage(projectPath)
      await writeText(path.join(packagePath, runtimePath), `changed ${runtimePath}\n`)
      const after = await discoverSingleProjectPackage(projectPath)

      expect(before?.diagnostics).toEqual([])
      expect(after?.diagnostics).toEqual([])
      expect(after?.contentHash).not.toBe(before?.contentHash)
    }
  })

  it('resolves accepted Windows-style manifest separators to package files', async () => {
    const projectPath = path.join(tmpRoot, 'project')
    const rootPath = path.join(projectPath, '.openwaggle', 'extensions')
    await writeExtensionPackage(
      rootPath,
      'sample-extension',
      manifest({
        sourceFiles: ['src\\index.ts'],
        builtArtifacts: ['dist\\index.js'],
      }),
    )

    const discoveredPackage = await discoverSingleProjectPackage(projectPath)

    expect(discoveredPackage?.diagnostics).toEqual([])
    expect(discoveredPackage?.contentHash).toHaveLength(OPENWAGGLE_EXTENSION.HASH.HEX_LENGTH)
  })

  it('discovers local-build plans with source-sensitive approval hashes', async () => {
    const projectPath = path.join(tmpRoot, 'project')
    const rootPath = path.join(projectPath, '.openwaggle', 'extensions')
    const packagePath = await writeExtensionPackage(
      rootPath,
      'sample-extension',
      manifest({
        install: { source: OPENWAGGLE_EXTENSION.INSTALL_SOURCE.LOCAL_BUILD },
        build: {
          command: 'pnpm build',
          outputs: ['dist/index.js'],
        },
      }),
    )

    const before = await discoverSingleProjectPackage(projectPath)
    await writeText(path.join(packagePath, 'src', 'index.ts'), 'export const source = false\n')
    const after = await discoverSingleProjectPackage(projectPath)

    expect(before?.buildPlan).toMatchObject({
      installSource: OPENWAGGLE_EXTENSION.INSTALL_SOURCE.LOCAL_BUILD,
      command: 'pnpm build',
      outputPaths: ['dist/index.js'],
      approvalRequired: true,
    })
    expect(before?.buildPlan?.inputHash).toHaveLength(OPENWAGGLE_EXTENSION.HASH.HEX_LENGTH)
    expect(after?.buildPlan?.inputHash).not.toBe(before?.buildPlan?.inputHash)
  })

  it('diagnoses local-build packages without commands and outputs missing from built artifacts', async () => {
    const projectPath = path.join(tmpRoot, 'project')
    const rootPath = path.join(projectPath, '.openwaggle', 'extensions')
    await writeExtensionPackage(
      rootPath,
      'sample-extension',
      manifest({
        install: { source: OPENWAGGLE_EXTENSION.INSTALL_SOURCE.LOCAL_BUILD },
        build: {
          command: 'pnpm build',
          outputs: ['dist/extra.js'],
        },
      }),
    )
    await writeExtensionPackage(
      rootPath,
      'missing-command',
      manifest({
        id: 'missing-command',
        install: { source: OPENWAGGLE_EXTENSION.INSTALL_SOURCE.LOCAL_BUILD },
      }),
    )

    const packages = await discoverExtensionPackages({
      projectPath,
      hostSdkVersion: OPENWAGGLE_EXTENSION.SDK_VERSION,
    })

    expect(
      packages.flatMap((extensionPackage) => extensionPackage.diagnostics.map(({ code }) => code)),
    ).toEqual(expect.arrayContaining(['build-output-not-artifact', 'build-command-missing']))
  })
})
