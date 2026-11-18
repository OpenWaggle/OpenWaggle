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

describe('workspace document fidelity', () => {
  let temporaryRoot = ''
  let projectPath = ''

  beforeEach(async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-document-fidelity-'))
    projectPath = path.join(temporaryRoot, 'project')
    await fs.mkdir(path.join(projectPath, 'src'), { recursive: true })
    await fs.writeFile(path.join(projectPath, 'src', 'alpha.ts'), 'export const alpha = 1\n')
  })

  afterEach(async () => {
    await fs.rm(temporaryRoot, { recursive: true, force: true })
  })

  it('refuses a focused edit that grows beyond 1 MiB', async () => {
    const initial = await runWithWorkspaceFiles((service) =>
      service.readFile({ projectPath, path: 'src/alpha.ts' }),
    )
    const expandedUtf8Content = 'x'.repeat(1024 * 1024 + 1)
    const result = await runWithWorkspaceFiles((service) =>
      service.writeFile({
        projectPath,
        path: 'src/alpha.ts',
        content: expandedUtf8Content,
        expectedRevision: initial.revision,
      }),
    )
    expect(result).toEqual({
      status: 'too-large',
      message: 'Focused file editing is limited to 1 MiB.',
    })
    expect(await fs.readFile(path.join(projectPath, 'src', 'alpha.ts'), 'utf8')).toBe(
      'export const alpha = 1\n',
    )
  })

  it('reopens undecodable bytes only with an explicit supported encoding', async () => {
    const filePath = path.join(projectPath, 'src', 'no-bom.txt')
    const utf16WithoutBom = encodeWorkspaceText('hello βeta\n', 'utf-16be').subarray(2)
    await fs.writeFile(filePath, utf16WithoutBom)
    const automatic = await runWithWorkspaceFiles((service) =>
      service.readFile({ projectPath, path: 'src/no-bom.txt' }),
    )
    expect(automatic.previewKind).toBe('binary')
    const explicit = await runWithWorkspaceFiles((service) =>
      service.readFileWithEncoding({
        projectPath,
        path: 'src/no-bom.txt',
        encoding: 'utf-16be',
      }),
    )
    expect(explicit).toMatchObject({
      previewKind: 'text',
      content: 'hello βeta\n',
      fidelity: { encoding: 'utf-16be' },
    })
  })

  it('saves an open document with an explicitly selected encoding and BOM', async () => {
    const initial = await runWithWorkspaceFiles((service) =>
      service.readFile({ projectPath, path: 'src/alpha.ts' }),
    )
    if (!('documentVersion' in initial)) throw new Error('Expected a text document.')
    const result = await runWithWorkspaceFiles((service) =>
      service.applyDocumentEdits({
        projectPath,
        path: 'src/alpha.ts',
        expectedRevision: initial.revision,
        baseVersion: initial.documentVersion,
        batches: [],
        targetEncoding: 'utf-16le',
      }),
    )
    expect(result).toMatchObject({ status: 'saved', encoding: 'utf-16le' })
    const bytes = await fs.readFile(path.join(projectPath, 'src', 'alpha.ts'))
    expect([...bytes.subarray(0, 2)]).toEqual([0xff, 0xfe])
    expect(bytes.subarray(2).toString('utf16le')).toBe('export const alpha = 1\n')
  })

  it('keeps the document version after the file watcher re-reads a successful save', async () => {
    const initial = await runWithWorkspaceFiles((service) =>
      service.readFile({ projectPath, path: 'src/alpha.ts' }),
    )
    if (!('documentVersion' in initial)) throw new Error('Expected a text document.')

    const firstSave = await runWithWorkspaceFiles((service) =>
      service.applyDocumentEdits({
        projectPath,
        path: 'src/alpha.ts',
        expectedRevision: initial.revision,
        baseVersion: initial.documentVersion,
        batches: [
          {
            version: initial.documentVersion + 1,
            changes: [{ rangeOffset: 21, rangeLength: 1, text: '2' }],
          },
        ],
      }),
    )
    if (firstSave.status !== 'saved') throw new Error('Expected the first edit to save.')

    const watcherRefresh = await runWithWorkspaceFiles((service) =>
      service.readFile({ projectPath, path: 'src/alpha.ts' }),
    )
    if (!('documentVersion' in watcherRefresh)) throw new Error('Expected a text document.')
    expect(watcherRefresh.documentVersion).toBe(firstSave.version)

    const secondSave = await runWithWorkspaceFiles((service) =>
      service.applyDocumentEdits({
        projectPath,
        path: 'src/alpha.ts',
        expectedRevision: watcherRefresh.revision,
        baseVersion: watcherRefresh.documentVersion,
        batches: [
          {
            version: watcherRefresh.documentVersion + 1,
            changes: [{ rangeOffset: 21, rangeLength: 1, text: '3' }],
          },
        ],
      }),
    )

    expect(secondSave.status).toBe('saved')
    expect(await fs.readFile(path.join(projectPath, 'src', 'alpha.ts'), 'utf8')).toBe(
      'export const alpha = 3\n',
    )
  })

  it('edits a renderer-cached file after its document session is evicted', async () => {
    const initial = await runWithWorkspaceFiles((service) =>
      service.readFile({ projectPath, path: 'src/alpha.ts' }),
    )
    if (!('documentVersion' in initial)) throw new Error('Expected a text document.')

    const firstSave = await runWithWorkspaceFiles((service) =>
      service.applyDocumentEdits({
        projectPath,
        path: 'src/alpha.ts',
        expectedRevision: initial.revision,
        baseVersion: initial.documentVersion,
        batches: [
          {
            version: initial.documentVersion + 1,
            changes: [{ rangeOffset: 21, rangeLength: 1, text: '2' }],
          },
        ],
      }),
    )
    if (firstSave.status !== 'saved') throw new Error('Expected the first edit to save.')

    for (let index = 0; index < 16; index += 1) {
      const relativePath = `src/eviction-${index}.ts`
      await fs.writeFile(path.join(projectPath, relativePath), `export const value = ${index}\n`)
      await runWithWorkspaceFiles((service) =>
        service.readFile({ projectPath, path: relativePath }),
      )
    }

    const saved = await runWithWorkspaceFiles((service) =>
      service.applyDocumentEdits({
        projectPath,
        path: 'src/alpha.ts',
        expectedRevision: firstSave.revision,
        baseVersion: firstSave.version,
        batches: [
          {
            version: firstSave.version + 1,
            changes: [{ rangeOffset: 21, rangeLength: 1, text: '3' }],
          },
        ],
      }),
    )

    expect(saved.status).toBe('saved')
    expect(await fs.readFile(path.join(projectPath, 'src', 'alpha.ts'), 'utf8')).toBe(
      'export const alpha = 3\n',
    )
  })

  it('resolves EditorConfig inside the worktree and applies safe encoding and EOL policy', async () => {
    await fs.writeFile(
      path.join(projectPath, '.editorconfig'),
      `root = true

[*.ts]
charset = utf-16le
end_of_line = crlf
indent_style = tab
tab_width = 4
insert_final_newline = true
trim_trailing_whitespace = true
`,
    )
    const initial = await runWithWorkspaceFiles((service) =>
      service.readFile({ projectPath, path: 'src/alpha.ts' }),
    )
    if (!('documentVersion' in initial)) throw new Error('Expected a text document.')
    expect(initial.fidelity).toMatchObject({
      encoding: 'utf-8',
      lineEnding: 'lf',
      indentStyle: 'tab',
      indentSize: 4,
      editorConfigApplied: true,
      editorConfigPolicy: {
        encoding: 'utf-16le',
        lineEnding: 'crlf',
        finalNewline: true,
        trimTrailingWhitespace: true,
      },
    })
    const saved = await runWithWorkspaceFiles((service) =>
      service.applyDocumentEdits({
        projectPath,
        path: 'src/alpha.ts',
        expectedRevision: initial.revision,
        baseVersion: initial.documentVersion,
        batches: [],
      }),
    )
    expect(saved).toMatchObject({ status: 'saved', encoding: 'utf-16le', lineEnding: 'crlf' })
    const bytes = await fs.readFile(path.join(projectPath, 'src', 'alpha.ts'))
    expect(bytes.subarray(2).toString('utf16le')).toBe('export const alpha = 1\r\n')
  })
})
