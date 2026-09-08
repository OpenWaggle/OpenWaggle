import fs from 'node:fs/promises'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { encodeWorkspaceText } from '../workspace-file-content'
import {
  createWorkspaceFileFixture,
  removeWorkspaceFileFixture,
  runWithWorkspaceFiles,
} from './filesystem-workspace-file-service-test-harness'

describe('FilesystemWorkspaceFileLive content safety', () => {
  let temporaryRoot = ''
  let projectPath = ''

  beforeEach(async () => {
    ;({ temporaryRoot, projectPath } = await createWorkspaceFileFixture())
  })

  afterEach(async () => {
    await removeWorkspaceFileFixture(temporaryRoot)
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
