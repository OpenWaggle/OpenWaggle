import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  removeFilesystemExtensionPackage,
  writeFilesystemExtensionPackage,
} from '../package-install'

let tmpRoot = ''

function projectScope() {
  return {
    kind: OPENWAGGLE_EXTENSION.SCOPE.PROJECT_KIND,
    projectPath: path.join(tmpRoot, 'project'),
  } as const
}

function filesFor(input: { readonly extensionId: string; readonly builtContent?: string }) {
  return [
    {
      relativePath: OPENWAGGLE_EXTENSION.MANIFEST_FILE,
      content: `${JSON.stringify({
        manifestVersion: 1,
        id: input.extensionId,
        name: 'Filesystem Extension',
        version: '1.0.0',
        sdk: { openwaggle: '>=0.1.0 <0.2.0' },
        sourceFiles: ['src/index.ts'],
        builtArtifacts: ['dist/index.js'],
      })}\n`,
    },
    {
      relativePath: 'src/index.ts',
      content: 'export const source = true\n',
    },
    {
      relativePath: 'dist/index.js',
      content: input.builtContent ?? 'export const built = true\n',
    },
  ]
}

async function exists(filePath: string) {
  try {
    await fs.stat(filePath)
    return true
  } catch {
    return false
  }
}

describe('filesystem extension package install repository helpers', () => {
  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-extension-install-'))
  })

  afterEach(async () => {
    if (tmpRoot) {
      await fs.rm(tmpRoot, { recursive: true, force: true })
    }
  })

  it('creates and replaces a project-local package as a full package directory', async () => {
    const extensionId = 'filesystem-workflow'
    const scope = projectScope()
    const packagePath = path.join(scope.projectPath, '.openwaggle', 'extensions', extensionId)

    await writeFilesystemExtensionPackage({
      extensionId,
      scope,
      mode: 'create',
      globalRootPath: path.join(tmpRoot, 'user-data', 'extensions'),
      files: [
        ...filesFor({ extensionId }),
        {
          relativePath: 'dist/stale.js',
          content: 'export const stale = true\n',
        },
      ],
    })
    await writeFilesystemExtensionPackage({
      extensionId,
      scope,
      mode: 'update',
      globalRootPath: path.join(tmpRoot, 'user-data', 'extensions'),
      files: filesFor({ extensionId, builtContent: 'export const built = false\n' }),
    })

    await expect(fs.readFile(path.join(packagePath, 'dist', 'index.js'), 'utf-8')).resolves.toBe(
      'export const built = false\n',
    )
    expect(await exists(path.join(packagePath, 'dist', 'stale.js'))).toBe(false)
    expect(await exists(path.join(packagePath, OPENWAGGLE_EXTENSION.MANIFEST_FILE))).toBe(true)
  })

  it('writes global packages under the global extension root', async () => {
    const extensionId = 'global-filesystem-workflow'
    const globalRootPath = path.join(tmpRoot, 'user-data', 'extensions')

    const result = await writeFilesystemExtensionPackage({
      extensionId,
      scope: { kind: OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_KIND },
      mode: 'create',
      globalRootPath,
      files: filesFor({ extensionId }),
    })

    expect(result.packagePath).toBe(path.join(globalRootPath, extensionId))
    expect(await exists(path.join(globalRootPath, extensionId, 'dist', 'index.js'))).toBe(true)
  })

  it('rejects package writes that escape the package root', async () => {
    await expect(
      writeFilesystemExtensionPackage({
        extensionId: 'escape-workflow',
        scope: projectScope(),
        mode: 'create',
        globalRootPath: path.join(tmpRoot, 'user-data', 'extensions'),
        files: [
          ...filesFor({ extensionId: 'escape-workflow' }),
          {
            relativePath: '../outside.js',
            content: 'export const outside = true\n',
          },
        ],
      }),
    ).rejects.toThrow('Invalid extension package file path')
  })

  it('removes only the requested package directory', async () => {
    const extensionId = 'remove-filesystem-workflow'
    const siblingId = 'remove-filesystem-sibling'
    const globalRootPath = path.join(tmpRoot, 'user-data', 'extensions')
    const scope = projectScope()

    await writeFilesystemExtensionPackage({
      extensionId,
      scope,
      mode: 'create',
      globalRootPath,
      files: filesFor({ extensionId }),
    })
    await writeFilesystemExtensionPackage({
      extensionId: siblingId,
      scope,
      mode: 'create',
      globalRootPath,
      files: filesFor({ extensionId: siblingId }),
    })

    const result = await removeFilesystemExtensionPackage({
      extensionId,
      scope,
      globalRootPath,
    })

    expect(result.removed).toBe(true)
    expect(
      await exists(path.join(scope.projectPath, '.openwaggle', 'extensions', extensionId)),
    ).toBe(false)
    expect(await exists(path.join(scope.projectPath, '.openwaggle', 'extensions', siblingId))).toBe(
      true,
    )
  })
})
