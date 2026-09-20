import { SessionId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import { describe, expect, it } from 'vitest'
import type { UpsertSessionResourceInput } from '../../ports/session-resource-repository'
import { captureSuccessfulRunResources } from '../session-resource-capture'
import {
  assistantToolResultMessage,
  sessionResourceTestLayer,
} from './session-resource-capture.fixtures'

describe('production Session Resource tool capture', () => {
  it('catalogs a completed Pi tool with persisted node and branch provenance', async () => {
    const upserts: UpsertSessionResourceInput[] = []

    await Effect.runPromise(
      captureSuccessfulRunResources({
        sessionId: SessionId('session-1'),
        runId: 'run-1',
        payload: { text: '', thinkingLevel: 'medium', attachments: [] },
        messages: [assistantToolResultMessage()],
        nodeIdByMessageId: { 'assistant-tool-message': 'persisted-tool-node' },
        branchIdByMessageId: { 'assistant-tool-message': 'branch-feature' },
      }).pipe(Effect.provide(sessionResourceTestLayer(upserts))),
    )

    expect(upserts).toContainEqual(
      expect.objectContaining({
        canonicalKey: 'tool:grep',
        kind: 'tool',
        title: 'grep',
        locator: null,
        occurrence: expect.objectContaining({
          id: 'session-1:persisted-tool-node:read:tool:tool-call-1',
          nodeId: 'persisted-tool-node',
          branchId: 'branch-feature',
          actor: 'tool',
          activity: 'read',
          label: 'grep',
          createdAt: 2_000,
        }),
      }),
    )
  })

  it('does not present a failed tool as a usable Session Source', async () => {
    const upserts: UpsertSessionResourceInput[] = []

    await Effect.runPromise(
      captureSuccessfulRunResources({
        sessionId: SessionId('session-1'),
        runId: 'run-failed-tool',
        payload: { text: '', thinkingLevel: 'medium', attachments: [] },
        messages: [assistantToolResultMessage(true)],
      }).pipe(Effect.provide(sessionResourceTestLayer(upserts))),
    )

    expect(upserts).toEqual([])
  })

  it('catalogs a successful built-in file read as a file Source', async () => {
    const upserts: UpsertSessionResourceInput[] = []

    await Effect.runPromise(
      captureSuccessfulRunResources({
        sessionId: SessionId('session-1'),
        runId: 'run-read',
        payload: { text: '', thinkingLevel: 'medium', attachments: [] },
        messages: [
          assistantToolResultMessage(false, {
            name: 'read',
            args: { path: '/repo/src/session-summary.ts' },
          }),
        ],
        nodeIdByMessageId: { 'assistant-tool-message': 'persisted-read-node' },
        branchIdByMessageId: { 'assistant-tool-message': 'branch-read' },
      }).pipe(Effect.provide(sessionResourceTestLayer(upserts, { sessionWorkingPath: '/repo' }))),
    )

    expect(upserts).toContainEqual(
      expect.objectContaining({
        canonicalKey: 'file:/repo/src/session-summary.ts',
        kind: 'file',
        title: 'src/session-summary.ts',
        locator: '/repo/src/session-summary.ts',
        occurrence: expect.objectContaining({
          id: 'session-1:persisted-read-node:read:file:tool-call-1',
          branchId: 'branch-read',
          actor: 'tool',
          activity: 'read',
          label: 'read',
          createdAt: 2_000,
        }),
      }),
    )
  })

  it('resolves a relative tool path against the opened Session working tree', async () => {
    const upserts: UpsertSessionResourceInput[] = []

    await Effect.runPromise(
      captureSuccessfulRunResources({
        sessionId: SessionId('session-1'),
        runId: 'run-relative-read',
        payload: { text: '', thinkingLevel: 'medium', attachments: [] },
        messages: [
          assistantToolResultMessage(false, {
            name: 'read',
            args: { path: 'src/session-summary.ts' },
          }),
        ],
      }).pipe(
        Effect.provide(sessionResourceTestLayer(upserts, { sessionWorkingPath: '/worktree' })),
      ),
    )

    expect(upserts).toContainEqual(
      expect.objectContaining({
        canonicalKey: 'file:/worktree/src/session-summary.ts',
        kind: 'file',
        title: 'src/session-summary.ts',
        locator: '/worktree/src/session-summary.ts',
      }),
    )
  })

  it('catalogs a successful built-in write as an explicit file Output', async () => {
    const upserts: UpsertSessionResourceInput[] = []

    await Effect.runPromise(
      captureSuccessfulRunResources({
        sessionId: SessionId('session-1'),
        runId: 'run-write',
        payload: { text: '', thinkingLevel: 'medium', attachments: [] },
        messages: [
          assistantToolResultMessage(false, {
            name: 'write',
            args: { path: 'dist/report.html' },
          }),
        ],
        nodeIdByMessageId: { 'assistant-tool-message': 'persisted-write-node' },
        branchIdByMessageId: { 'assistant-tool-message': 'branch-output' },
      }).pipe(
        Effect.provide(sessionResourceTestLayer(upserts, { sessionWorkingPath: '/worktree' })),
      ),
    )

    expect(upserts).toContainEqual(
      expect.objectContaining({
        canonicalKey: 'file:/worktree/dist/report.html',
        kind: 'file',
        title: 'dist/report.html',
        locator: '/worktree/dist/report.html',
        occurrence: expect.objectContaining({
          id: 'session-1:persisted-write-node:updated:file:tool-call-1',
          branchId: 'branch-output',
          actor: 'tool',
          activity: 'updated',
          label: 'write',
        }),
      }),
    )
  })

  it('uses only the basename when a tool reads outside the Session working tree', async () => {
    const upserts: UpsertSessionResourceInput[] = []

    await Effect.runPromise(
      captureSuccessfulRunResources({
        sessionId: SessionId('session-1'),
        runId: 'run-external-read',
        payload: { text: '', thinkingLevel: 'medium', attachments: [] },
        messages: [
          assistantToolResultMessage(false, {
            name: 'read',
            args: { path: '/Users/person/private/notes.txt' },
          }),
        ],
      }).pipe(
        Effect.provide(sessionResourceTestLayer(upserts, { sessionWorkingPath: '/worktree' })),
      ),
    )

    expect(upserts).toContainEqual(
      expect.objectContaining({
        canonicalKey: 'file:/Users/person/private/notes.txt',
        kind: 'file',
        title: 'notes.txt',
        locator: '/Users/person/private/notes.txt',
      }),
    )
  })
})
