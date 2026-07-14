import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  calculateBuildPlanHash,
  calculateContentHash,
  validateDeclaredFiles,
} from '../package-files'

let tmpRoot = ''

async function writeText(filePath: string, value: string) {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, value, 'utf-8')
}

async function symlinkOutsidePackage(input: {
  readonly packagePath: string
  readonly relativePath: string
  readonly outsideFilePath: string
}) {
  const linkPath = path.join(input.packagePath, input.relativePath)
  await fs.mkdir(path.dirname(linkPath), { recursive: true })
  await fs.symlink(input.outsideFilePath, linkPath)
}

function invalidPaths(diagnostics: readonly { readonly code: string; readonly path?: string }[]) {
  return diagnostics
    .filter((diagnostic) => diagnostic.code === 'package-path-invalid')
    .map((diagnostic) => diagnostic.path)
}

describe('extension package file validation', () => {
  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-package-files-'))
  })

  afterEach(async () => {
    if (tmpRoot) {
      await fs.rm(tmpRoot, { recursive: true, force: true })
    }
  })

  it('rejects declared files when symlink targets escape the package root', async () => {
    const packagePath = path.join(tmpRoot, 'package')
    const outsideFilePath = path.join(tmpRoot, 'outside.js')
    await writeText(outsideFilePath, 'export const outside = true\n')
    await symlinkOutsidePackage({ packagePath, outsideFilePath, relativePath: 'src/index.ts' })
    await symlinkOutsidePackage({ packagePath, outsideFilePath, relativePath: 'dist/index.js' })
    await symlinkOutsidePackage({
      packagePath,
      outsideFilePath,
      relativePath: 'dist/trusted-main.js',
    })

    const declaredDiagnostics = await validateDeclaredFiles({
      packagePath,
      relativePaths: ['src/index.ts'],
      label: 'source file',
      missingCode: 'source-file-missing',
    })
    const contentHash = await calculateContentHash(packagePath, '{}\n', {
      builtArtifacts: ['dist/index.js'],
      runtimeFiles: ['dist/trusted-main.js'],
    })
    const buildPlanHash = await calculateBuildPlanHash(packagePath, '{}\n', {
      sourceFiles: ['src/index.ts'],
      buildCommand: 'pnpm build',
    })

    expect(invalidPaths(declaredDiagnostics)).toEqual(['src/index.ts'])
    expect(contentHash.contentHash).toBeNull()
    expect(invalidPaths(contentHash.diagnostics)).toEqual(['dist/index.js', 'dist/trusted-main.js'])
    expect(buildPlanHash.contentHash).toBeNull()
    expect(invalidPaths(buildPlanHash.diagnostics)).toEqual(['src/index.ts'])
  })
})
