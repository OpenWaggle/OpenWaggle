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
import { encodeWorkspaceText } from '../workspace-file-content'

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

  it('routes text beyond 1 MiB to the paged read-only source view', async () => {
    await fs.writeFile(path.join(projectPath, 'src', 'large.txt'), 'x'.repeat(1024 * 1024 + 1))

    const result = await runWithWorkspaceFiles((service) =>
      service.readFile({ projectPath, path: 'src/large.txt' }),
    )

    expect(result).toMatchObject({
      previewKind: 'oversized',
      reason: 'This text file is larger than 1 MiB. Browse it in paged source view.',
    })
  })

  it('keeps image previews available beyond the focused text-edit limit', async () => {
    const image = Buffer.alloc(1024 * 1024 + 1, 1)
    await fs.writeFile(path.join(projectPath, 'src', 'large.png'), image)

    const result = await runWithWorkspaceFiles((service) =>
      service.readFile({ projectPath, path: 'src/large.png' }),
    )

    expect(result).toMatchObject({
      previewKind: 'image',
      mimeType: 'image/png',
      size: image.byteLength,
    })
    if (result.previewKind !== 'image') throw new Error('Expected an image preview.')
    expect(result.data).toHaveLength(image.byteLength)
  })

  it('honours worktree-local VS Code file associations', async () => {
    await fs.mkdir(path.join(projectPath, '.vscode'), { recursive: true })
    await fs.writeFile(
      path.join(projectPath, '.vscode', 'settings.json'),
      `{
        // Keep the standard users already configured in VS Code.
        "files.associations": {
          "*.theme": "typescript",
          "config/*.conf": "toml",
          "*.{spec,test}": "javascript"
        }
      }`,
    )
    await fs.mkdir(path.join(projectPath, 'config'), { recursive: true })
    await fs.writeFile(path.join(projectPath, 'src', 'ocean.theme'), 'export const blue = true\n')
    await fs.writeFile(path.join(projectPath, 'src', 'math.spec'), 'export const sum = 2\n')
    await fs.writeFile(path.join(projectPath, 'config', 'app.conf'), 'enabled = true\n')

    const theme = await runWithWorkspaceFiles((service) =>
      service.readFile({ projectPath, path: 'src/ocean.theme' }),
    )
    const config = await runWithWorkspaceFiles((service) =>
      service.readFile({ projectPath, path: 'config/app.conf' }),
    )
    const testFile = await runWithWorkspaceFiles((service) =>
      service.readFile({ projectPath, path: 'src/math.spec' }),
    )

    expect(theme).toMatchObject({ previewKind: 'text', language: 'typescript' })
    expect(config).toMatchObject({ previewKind: 'text', language: 'toml' })
    expect(testFile).toMatchObject({ previewKind: 'text', language: 'javascript' })
  })

  it('infers extensionless scripts from their shebang', async () => {
    await fs.writeFile(
      path.join(projectPath, 'src', 'release'),
      '#!/usr/bin/env python3\nprint(1)\n',
    )

    const result = await runWithWorkspaceFiles((service) =>
      service.readFile({ projectPath, path: 'src/release' }),
    )

    expect(result).toMatchObject({ previewKind: 'text', language: 'python' })
  })

  it.each(['utf-8', 'utf-8-bom', 'utf-16le', 'utf-16be'] as const)(
    'pages %s text only on complete encoded-character boundaries',
    async (encoding) => {
      const content = 'alpha 😀 café\nβeta 🌍 done\n'
      await fs.writeFile(
        path.join(projectPath, 'src', 'encoded.txt'),
        encodeWorkspaceText(content, encoding),
      )

      let nextOffset: number | null = 0
      let assembled = ''
      let previousEnd = 0
      while (nextOffset !== null) {
        const page = await runWithWorkspaceFiles((service) =>
          service.readPage({
            projectPath,
            path: 'src/encoded.txt',
            offset: nextOffset ?? 0,
            limit: 7,
          }),
        )
        expect(page.offset).toBe(previousEnd)
        expect(page.endOffset).toBeGreaterThan(page.offset)
        expect(page.encoding).toBe(encoding)
        assembled += page.content
        previousEnd = page.endOffset
        nextOffset = page.nextOffset
      }

      expect(assembled).toBe(content)
      expect(previousEnd).toBe((await fs.stat(path.join(projectPath, 'src', 'encoded.txt'))).size)
    },
  )

  it('rejects binary files from the paged source view', async () => {
    await fs.writeFile(path.join(projectPath, 'src', 'binary.bin'), Buffer.from([0, 1, 2, 3]))

    await expect(
      runWithWorkspaceFiles((service) =>
        service.readPage({ projectPath, path: 'src/binary.bin', offset: 0, limit: 16 }),
      ),
    ).rejects.toThrow('Binary files cannot be opened')
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

  it('rejects a same-size external edit whose modification time is preserved', async () => {
    const filePath = path.join(projectPath, 'src', 'alpha.ts')
    const fixedMtimeSeconds = 1_700_000_000
    await fs.utimes(filePath, fixedMtimeSeconds, fixedMtimeSeconds)
    const initial = await runWithWorkspaceFiles((service) =>
      service.readFile({ projectPath, path: 'src/alpha.ts' }),
    )
    const initialStats = await fs.stat(filePath)
    const externalContent = 'export const omega = 9\n'
    expect(Buffer.byteLength(externalContent)).toBe(initial.size)

    await fs.writeFile(filePath, externalContent)
    await fs.utimes(filePath, initialStats.atime, initialStats.mtime)

    const result = await runWithWorkspaceFiles((service) =>
      service.writeFile({
        projectPath,
        path: 'src/alpha.ts',
        content: 'export const alpha = 2\n',
        expectedRevision: initial.revision,
      }),
    )

    expect(result.status).toBe('conflict')
    expect(await fs.readFile(filePath, 'utf8')).toBe(externalContent)
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
