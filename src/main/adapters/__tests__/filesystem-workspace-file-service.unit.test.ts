import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  WorkspaceFileService,
  type WorkspaceFileServiceShape,
} from '../../ports/workspace-file-service'
import { FilesystemWorkspaceFileLive } from '../filesystem-workspace-file-service'

function runWithWorkspaceFiles<A>(
  useService: (service: WorkspaceFileServiceShape) => Effect.Effect<A, unknown>,
) {
  return Effect.runPromise(
    Effect.gen(function* () {
      const service = yield* WorkspaceFileService
      return yield* useService(service)
    }).pipe(Effect.provide(FilesystemWorkspaceFileLive)),
  )
}

describe('FilesystemWorkspaceFileLive', () => {
  let temporaryRoot = ''
  let projectPath = ''

  beforeEach(async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-workspace-files-'))
    projectPath = path.join(temporaryRoot, 'project')
    await fs.mkdir(path.join(projectPath, 'src'), { recursive: true })
    await fs.mkdir(path.join(projectPath, '.agents'), { recursive: true })
    await fs.mkdir(path.join(projectPath, 'node_modules', 'ignored'), { recursive: true })
    await Promise.all([
      fs.writeFile(path.join(projectPath, 'src', 'alpha.ts'), 'export const alpha = 1\n'),
      fs.writeFile(path.join(projectPath, 'src', 'beta.ts'), 'const needle = true\n'),
      fs.writeFile(path.join(projectPath, '.agents', 'guide.md'), '# Guide\n'),
      fs.writeFile(path.join(projectPath, 'node_modules', 'ignored', 'package.js'), 'ignored\n'),
    ])
  })

  afterEach(async () => {
    await fs.rm(temporaryRoot, { recursive: true, force: true })
  })

  it('fuzzy-searches source and dot files while excluding generated dependencies', async () => {
    const sourceResults = await runWithWorkspaceFiles((service) =>
      service.searchFiles({ projectPath, query: 'alp', limit: 20 }),
    )
    const allResults = await runWithWorkspaceFiles((service) =>
      service.searchFiles({ projectPath, query: '', limit: 100 }),
    )

    expect(sourceResults[0]?.path).toBe('src/alpha.ts')
    expect(allResults.map((entry) => entry.path)).toContain('.agents/guide.md')
    expect(allResults.map((entry) => entry.path)).not.toContain('node_modules/ignored/package.js')
  })

  it('applies nested generated-directory and gitignore rules with re-inclusions', async () => {
    await fs.mkdir(path.join(projectPath, 'packages', 'app', 'node_modules', 'dep'), {
      recursive: true,
    })
    await fs.mkdir(path.join(projectPath, 'packages', 'app', 'dist'), { recursive: true })
    await Promise.all([
      fs.writeFile(
        path.join(projectPath, 'packages', 'app', 'node_modules', 'dep', 'index.js'),
        'ignored\n',
      ),
      fs.writeFile(path.join(projectPath, 'packages', 'app', 'dist', 'bundle.js'), 'ignored\n'),
      fs.writeFile(path.join(projectPath, 'packages', 'app', '.gitignore'), '*.log\n!keep.log\n'),
      fs.writeFile(path.join(projectPath, 'packages', 'app', 'debug.log'), 'ignored\n'),
      fs.writeFile(path.join(projectPath, 'packages', 'app', 'keep.log'), 'included\n'),
    ])

    const results = await runWithWorkspaceFiles((service) =>
      service.searchFiles({ projectPath, query: '', limit: 100 }),
    )
    const paths = results.map((entry) => entry.path)

    expect(paths).not.toContain('packages/app/node_modules/dep/index.js')
    expect(paths).not.toContain('packages/app/dist/bundle.js')
    expect(paths).not.toContain('packages/app/debug.log')
    expect(paths).toContain('packages/app/keep.log')
  })

  it('does not let a child gitignore re-include files beneath a parent-ignored directory', async () => {
    await fs.mkdir(path.join(projectPath, 'ignored'), { recursive: true })
    await Promise.all([
      fs.writeFile(path.join(projectPath, '.gitignore'), 'ignored/\n'),
      fs.writeFile(path.join(projectPath, 'ignored', '.gitignore'), '!keep.ts\n'),
      fs.writeFile(path.join(projectPath, 'ignored', 'keep.ts'), 'export const keep = true\n'),
    ])

    const results = await runWithWorkspaceFiles((service) =>
      service.searchFiles({ projectPath, query: '', limit: 100 }),
    )

    expect(results.map((entry) => entry.path)).not.toContain('ignored/keep.ts')
  })

  it('keeps oversized text out of the controlled workspace editor', async () => {
    await fs.writeFile(path.join(projectPath, 'src', 'large.txt'), 'x'.repeat(2 * 1024 * 1024 + 1))

    const result = await runWithWorkspaceFiles((service) =>
      service.readFile({ projectPath, path: 'src/large.txt' }),
    )

    expect(result.previewKind).toBe('oversized')
  })

  it('returns line-targeted content matches', async () => {
    const matches = await runWithWorkspaceFiles((service) =>
      service.searchContent({ projectPath, query: 'needle', limit: 20 }),
    )

    expect(matches).toContainEqual({
      path: 'src/beta.ts',
      basename: 'beta.ts',
      lineNumber: 1,
      lineText: 'const needle = true',
      matchStart: 6,
      matchLength: 6,
    })
  })

  it('stops an in-progress content scan when the project search is cancelled', async () => {
    const search = runWithWorkspaceFiles((service) =>
      service.searchContent({ projectPath, query: 'needle', limit: 20 }),
    )

    await runWithWorkspaceFiles((service) => service.cancelContentSearch({ projectPath }))

    await expect(search).resolves.toEqual([])
  })

  it('writes only when the optimistic revision matches', async () => {
    const initial = await runWithWorkspaceFiles((service) =>
      service.readFile({ projectPath, path: 'src/alpha.ts' }),
    )
    const result = await runWithWorkspaceFiles((service) =>
      service.writeFile({
        projectPath,
        path: 'src/alpha.ts',
        content: 'export const alpha = 2\n',
        expectedRevision: initial.revision,
      }),
    )
    expect(result.status).toBe('saved')
    if (result.status !== 'saved') throw new Error('Expected the workspace file write to succeed.')

    const conflict = await runWithWorkspaceFiles((service) =>
      service.writeFile({
        projectPath,
        path: 'src/alpha.ts',
        content: 'stale write\n',
        expectedRevision: initial.revision,
      }),
    )
    expect(conflict).toEqual({
      status: 'conflict',
      message: 'The file changed on disk. Reload it before saving your edits.',
    })
    expect(result.revision).not.toBe(initial.revision)
    expect(await fs.readFile(path.join(projectPath, 'src', 'alpha.ts'), 'utf8')).toBe(
      'export const alpha = 2\n',
    )
  })

  it('rejects oversized UTF-8 writes before mutating the file', async () => {
    const initial = await runWithWorkspaceFiles((service) =>
      service.readFile({ projectPath, path: 'src/alpha.ts' }),
    )
    const originalContent = await fs.readFile(path.join(projectPath, 'src', 'alpha.ts'), 'utf8')
    const oversizedUtf8Content = 'é'.repeat(1024 * 1024 + 1)

    const result = await runWithWorkspaceFiles((service) =>
      service.writeFile({
        projectPath,
        path: 'src/alpha.ts',
        content: oversizedUtf8Content,
        expectedRevision: initial.revision,
      }),
    )

    expect(result).toEqual({
      status: 'too-large',
      message: 'This text file is too large to save in the workspace editor.',
    })
    expect(await fs.readFile(path.join(projectPath, 'src', 'alpha.ts'), 'utf8')).toBe(
      originalContent,
    )
  })

  it('rejects traversal and symlinks that resolve outside the project', async () => {
    const externalFile = path.join(temporaryRoot, 'external.txt')
    await fs.writeFile(externalFile, 'secret\n')
    await fs.symlink(externalFile, path.join(projectPath, 'external-link.txt'))

    await expect(
      runWithWorkspaceFiles((service) =>
        service.readFile({ projectPath, path: '../external.txt' }),
      ),
    ).rejects.toThrow('cannot leave the project root')
    await expect(
      runWithWorkspaceFiles((service) =>
        service.readFile({ projectPath, path: 'external-link.txt' }),
      ),
    ).rejects.toThrow('symlink resolves outside')
  })
})
