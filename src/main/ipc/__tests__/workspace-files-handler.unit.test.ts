import { WORKSPACE_FILES } from '@shared/constants/resource-limits'
import { WORKSPACE_EDITOR_PERFORMANCE } from '@shared/constants/workspace-editor-performance'
import { describe, expect, it } from 'vitest'
import {
  canonicalProject,
  edits,
  harness,
  invoke,
  PROJECT_PATH,
} from './workspace-files-handler.test-harness'

describe('workspace file handlers', () => {
  it('lists supported editors without requiring a workspace path', async () => {
    await expect(invoke('workspace-files:list-external-editors')).resolves.toEqual([
      { id: 'vscode', label: 'Visual Studio Code' },
      { id: 'zed', label: 'Zed' },
    ])
  })

  it.each<[string, unknown[], string, object, unknown]>([
    ['search', ['src', 10], 'searchFiles', { query: 'src', limit: 10 }, [{ path: 'src/main.ts' }]],
    [
      'search',
      ['src', WORKSPACE_FILES.EXPLORER_RESULT_LIMIT + 1],
      'searchFiles',
      { query: 'src', limit: WORKSPACE_FILES.EXPLORER_RESULT_LIMIT + 1 },
      [{ path: 'src/main.ts' }],
    ],
    [
      'search-content',
      ['value', WORKSPACE_FILES.CONTENT_RESULT_LIMIT],
      'searchContent',
      { query: 'value', limit: WORKSPACE_FILES.CONTENT_RESULT_LIMIT },
      [{ path: 'src/main.ts', line: 1 }],
    ],
    ['cancel-content-search', [], 'cancelContentSearch', {}, undefined],
    ['read', ['src/a.ts'], 'readFile', { path: 'src/a.ts' }, { method: 'readFile' }],
    [
      'read-with-encoding',
      ['src/a.ts', 'utf-16le'],
      'readFileWithEncoding',
      { path: 'src/a.ts', encoding: 'utf-16le' },
      { method: 'readFileWithEncoding' },
    ],
    [
      'read-page',
      ['src/a.ts', 0, WORKSPACE_EDITOR_PERFORMANCE.SOURCE_PAGE_MAX_BYTES],
      'readPage',
      { path: 'src/a.ts', offset: 0, limit: WORKSPACE_EDITOR_PERFORMANCE.SOURCE_PAGE_MAX_BYTES },
      { method: 'readPage' },
    ],
    ['reveal-entry', ['src/a.ts'], 'revealEntry', { path: 'src/a.ts' }, undefined],
  ])(
    '%s answers from the workspace of the canonical project path',
    async (channel, args, method, input, result) => {
      await expect(invoke(`workspace-files:${channel}`, PROJECT_PATH, ...args)).resolves.toEqual(
        result,
      )

      expect(harness.calls).toEqual([[method, { projectPath: canonicalProject, ...input }]])
    },
  )

  it.each<[string, unknown[]]>([
    ['search', ['x'.repeat(1_025), 10]],
    ['search', ['src', 0]],
    ['search', ['src', WORKSPACE_FILES.EXPLORER_RESULT_LIMIT + 2]],
    ['search-content', ['value', 0]],
    ['search-content', ['value', WORKSPACE_FILES.CONTENT_RESULT_LIMIT + 1]],
    ['read', ['']],
    ['read-with-encoding', ['src/a.ts', 'latin1']],
    ['read-page', ['src/a.ts', -1, 10]],
    ['read-page', ['src/a.ts', 1.5, 10]],
    ['read-page', ['src/a.ts', 0, 0]],
    ['read-page', ['src/a.ts', 0, WORKSPACE_EDITOR_PERFORMANCE.SOURCE_PAGE_MAX_BYTES + 1]],
    ['reveal-entry', ['']],
  ])('refuses %s %j before reading the workspace', async (channel, args) => {
    await expect(invoke(`workspace-files:${channel}`, PROJECT_PATH, ...args)).rejects.toThrow()

    expect(harness.calls).toEqual([])
  })

  it.each<[string, unknown]>([
    ['write', { projectPath: PROJECT_PATH, path: 'a.ts', content: 'x', expectedRevision: '' }],
    [
      'write',
      {
        projectPath: PROJECT_PATH,
        path: 'src/example.ts',
        content: 'x'.repeat(WORKSPACE_EDITOR_PERFORMANCE.FOCUSED_EDIT_MAX_BYTES + 1),
        expectedRevision: 'revision-1',
      },
    ],
    ['apply-document-edits', edits(WORKSPACE_FILES.DOCUMENT_EDIT_BATCH_LIMIT + 1, 1)],
    ['apply-document-edits', edits(1, WORKSPACE_FILES.DOCUMENT_EDIT_CHANGES_PER_BATCH_LIMIT + 1)],
    ['apply-document-edits', edits(9, WORKSPACE_FILES.DOCUMENT_EDIT_CHANGES_PER_BATCH_LIMIT)],
    [
      'apply-document-edits',
      {
        ...edits(1, 2, 'x'.repeat(WORKSPACE_FILES.DOCUMENT_EDIT_INSERT_CODE_UNIT_LIMIT / 2)),
        batches: [
          ...edits(1, 2, 'x'.repeat(WORKSPACE_FILES.DOCUMENT_EDIT_INSERT_CODE_UNIT_LIMIT / 2))
            .batches,
          { version: 1, changes: [{ rangeOffset: 0, rangeLength: 0, text: 'x' }] },
        ],
      },
    ],
    ['open-external', { projectPath: PROJECT_PATH, path: 'a.ts', editor: 'vscode', line: 0 }],
    ['open-external', { projectPath: PROJECT_PATH, path: 'a.ts', editor: 'not-a-real-editor' }],
    ['open-absolute-external', { path: '/tmp/a.ts', editor: 'vscode', column: -1 }],
    ['create-entry', { projectPath: PROJECT_PATH, path: 'a', kind: 'link' }],
    ['move-entry', { projectPath: PROJECT_PATH, path: '' }],
    ['duplicate-entry', { projectPath: PROJECT_PATH, path: 'a.ts', targetPath: '' }],
    ['trash-entry', { projectPath: '', path: 'a.ts' }],
  ])('refuses a malformed %s request before touching the workspace', async (channel, input) => {
    await expect(invoke(`workspace-files:${channel}`, input)).rejects.toThrow()

    expect(harness.calls).toEqual([])
    expect(harness.invalidated).toEqual([])
  })

  it('accepts document edits at the change and inserted-text limits', async () => {
    const half = 'x'.repeat(WORKSPACE_FILES.DOCUMENT_EDIT_INSERT_CODE_UNIT_LIMIT / 2)
    await invoke('workspace-files:apply-document-edits', edits(8, 256))
    await invoke('workspace-files:apply-document-edits', edits(1, 2, half))

    expect(harness.calls.map(([method]) => method)).toEqual([
      'applyDocumentEdits',
      'applyDocumentEdits',
    ])
  })

  it.each([
    ['write', { projectPath: PROJECT_PATH, path: 'a.ts', content: 'x', expectedRevision: 'r1' }],
    ['apply-document-edits', edits(1, 1, 'x')],
  ])('invalidates Git state after %s saves, and only then', async (channel, input) => {
    await expect(invoke(`workspace-files:${channel}`, input)).resolves.toEqual({ status: 'saved' })
    expect(harness.invalidated).toEqual([canonicalProject])
    harness.saveStatus = 'conflict'
    await expect(invoke(`workspace-files:${channel}`, input)).resolves.toEqual({
      status: 'conflict',
    })

    expect(harness.invalidated).toEqual([canonicalProject])
    expect(harness.calls.at(-1)).toEqual([
      channel === 'write' ? 'writeFile' : 'applyDocumentEdits',
      { ...input, projectPath: canonicalProject },
    ])
  })
})
