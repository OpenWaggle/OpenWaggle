import { MessageId, SessionId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import { describe, expect, it } from 'vitest'
import type { UpsertSessionResourceInput } from '../../ports/session-resource-repository'
import { captureSuccessfulRunResources } from '../session-resource-capture'
import {
  assistantToolResultMessage,
  sessionResourceTestLayer,
} from './session-resource-capture.fixtures'

describe('production Session Resource web and site capture', () => {
  it('catalogs every explicit query in a successful web search as a web-search Source', async () => {
    const upserts: UpsertSessionResourceInput[] = []

    await Effect.runPromise(
      captureSuccessfulRunResources({
        sessionId: SessionId('session-1'),
        runId: 'run-web-search',
        payload: { text: '', thinkingLevel: 'medium', attachments: [] },
        messages: [
          assistantToolResultMessage(false, {
            name: 'web',
            args: {
              search_query: [{ q: 'Codex Session Summary' }, { q: 'OpenWaggle resource browser' }],
            },
          }),
        ],
        nodeIdByMessageId: { 'assistant-tool-message': 'persisted-web-node' },
        branchIdByMessageId: { 'assistant-tool-message': 'branch-web' },
      }).pipe(Effect.provide(sessionResourceTestLayer(upserts))),
    )

    const searches = upserts.filter((resource) => resource.kind === 'web-search')
    expect(searches).toHaveLength(2)
    expect(searches).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          title: 'Codex Session Summary',
          locator: null,
          occurrence: expect.objectContaining({
            id: 'session-1:persisted-web-node:read:web-search:tool-call-1:0',
            nodeId: 'persisted-web-node',
            branchId: 'branch-web',
            actor: 'tool',
            activity: 'read',
            label: 'web',
            locator: null,
          }),
        }),
        expect.objectContaining({ title: 'OpenWaggle resource browser' }),
      ]),
    )
  })

  it('recognizes a Pi-native web_search invocation without treating generic search tools as web', async () => {
    const upserts: UpsertSessionResourceInput[] = []

    await Effect.runPromise(
      captureSuccessfulRunResources({
        sessionId: SessionId('session-1'),
        runId: 'run-native-web-search',
        payload: { text: '', thinkingLevel: 'medium', attachments: [] },
        messages: [
          assistantToolResultMessage(false, {
            name: 'web_search',
            args: { query: 'OpenWaggle release notes' },
          }),
          {
            ...assistantToolResultMessage(false, {
              name: 'search',
              args: { query: 'local MCP catalog' },
            }),
            id: MessageId('assistant-generic-search-message'),
          },
        ],
      }).pipe(Effect.provide(sessionResourceTestLayer(upserts))),
    )

    const searches = upserts.filter((resource) => resource.kind === 'web-search')
    expect(searches).toHaveLength(1)
    expect(searches[0]).toMatchObject({ title: 'OpenWaggle release notes' })
  })

  it('catalogs an explicitly typed site returned by a tool as an Output', async () => {
    const upserts: UpsertSessionResourceInput[] = []

    await Effect.runPromise(
      captureSuccessfulRunResources({
        sessionId: SessionId('session-1'),
        runId: 'run-site',
        payload: { text: '', thinkingLevel: 'medium', attachments: [] },
        messages: [
          assistantToolResultMessage(false, {
            name: 'publish_site',
            result: {
              content: [
                {
                  type: 'site',
                  url: 'https://preview.example/session-summary',
                  title: 'Session Summary preview',
                  activity: 'created',
                },
              ],
            },
          }),
        ],
        nodeIdByMessageId: { 'assistant-tool-message': 'persisted-site-node' },
        branchIdByMessageId: { 'assistant-tool-message': 'branch-site' },
      }).pipe(Effect.provide(sessionResourceTestLayer(upserts))),
    )

    expect(upserts).toContainEqual(
      expect.objectContaining({
        canonicalKey: 'url:https://preview.example/session-summary',
        kind: 'site',
        title: 'Session Summary preview',
        locator: 'https://preview.example/session-summary',
        occurrence: expect.objectContaining({
          id: 'session-1:persisted-site-node:created:site:tool-call-1:0',
          nodeId: 'persisted-site-node',
          branchId: 'branch-site',
          actor: 'tool',
          activity: 'created',
          label: 'publish_site',
          locator: 'https://preview.example/session-summary',
        }),
      }),
    )
  })

  it('uses MCP attribution instead of collapsing distinct provider tools into the gateway', async () => {
    const upserts: UpsertSessionResourceInput[] = []

    await Effect.runPromise(
      captureSuccessfulRunResources({
        sessionId: SessionId('session-1'),
        runId: 'run-mcp-tool',
        payload: { text: '', thinkingLevel: 'medium', attachments: [] },
        messages: [
          assistantToolResultMessage(false, {
            name: 'mcp',
            args: { operation: 'call', handle: 'opaque' },
            result: {
              content: [],
              details: {
                kind: 'gateway',
                result: {
                  operation: 'call',
                  text: 'Found the pull request.',
                  attribution: {
                    serverInstanceId: 'github-1',
                    serverLabel: 'GitHub',
                    toolName: 'get_pull_request',
                  },
                },
              },
            },
          }),
        ],
      }).pipe(Effect.provide(sessionResourceTestLayer(upserts))),
    )

    expect(upserts).toContainEqual(
      expect.objectContaining({
        canonicalKey: 'tool:github-1:get_pull_request',
        kind: 'tool',
        title: 'get_pull_request · GitHub',
        occurrence: expect.objectContaining({ label: 'get_pull_request · GitHub' }),
      }),
    )
    expect(upserts).not.toContainEqual(expect.objectContaining({ canonicalKey: 'tool:mcp' }))
  })

  it('attributes an explicit resource link in a tool result to that tool', async () => {
    const upserts: UpsertSessionResourceInput[] = []

    await Effect.runPromise(
      captureSuccessfulRunResources({
        sessionId: SessionId('session-1'),
        runId: 'run-tool-resource-link',
        payload: { text: '', thinkingLevel: 'medium', attachments: [] },
        messages: [
          assistantToolResultMessage(false, {
            name: 'lookup_documentation',
            result: {
              content: [
                {
                  type: 'resource_link',
                  uri: 'https://docs.example/session-summary',
                  title: 'Session Summary docs',
                  mimeType: 'text/html',
                },
              ],
            },
          }),
        ],
        nodeIdByMessageId: { 'assistant-tool-message': 'persisted-resource-node' },
        branchIdByMessageId: { 'assistant-tool-message': 'branch-resource' },
      }).pipe(Effect.provide(sessionResourceTestLayer(upserts))),
    )

    const links = upserts.filter(
      (resource) => resource.canonicalKey === 'url:https://docs.example/session-summary',
    )
    expect(links).toHaveLength(1)
    expect(links[0]).toMatchObject({
      kind: 'link',
      occurrence: {
        nodeId: 'persisted-resource-node',
        branchId: 'branch-resource',
        actor: 'tool',
        activity: 'read',
        label: 'lookup_documentation',
        locator: 'https://docs.example/session-summary',
      },
    })
  })

  it('keeps completed MCP orchestration children when a sibling makes the outer tool fail', async () => {
    const upserts: UpsertSessionResourceInput[] = []

    await Effect.runPromise(
      captureSuccessfulRunResources({
        sessionId: SessionId('session-1'),
        runId: 'run-partial-orchestration',
        payload: { text: '', thinkingLevel: 'medium', attachments: [] },
        messages: [
          assistantToolResultMessage(true, {
            name: 'mcp_run',
            details: {
              kind: 'orchestration',
              result: [
                {
                  id: 'docs',
                  handle: 'opaque-docs',
                  status: 'completed',
                  provenance: {
                    handle: 'opaque-docs',
                    serverInstanceId: 'docs-1',
                    serverLabel: 'Documentation',
                    toolName: 'lookup_docs',
                  },
                  result: {
                    operation: 'call',
                    text: 'Found documentation.',
                    result: [
                      {
                        type: 'resource_link',
                        uri: 'https://docs.example/orchestrated',
                        title: 'Orchestrated docs',
                      },
                    ],
                  },
                },
                {
                  id: 'failed',
                  handle: 'opaque-failed',
                  status: 'failed',
                  provenance: {
                    handle: 'opaque-failed',
                    serverInstanceId: 'failed-1',
                    serverLabel: 'Failed server',
                    toolName: 'failed_tool',
                  },
                  error: 'failed',
                },
              ],
            },
          }),
        ],
      }).pipe(Effect.provide(sessionResourceTestLayer(upserts))),
    )

    expect(upserts).toContainEqual(
      expect.objectContaining({
        canonicalKey: 'tool:docs-1:lookup_docs',
        kind: 'tool',
        title: 'lookup_docs · Documentation',
      }),
    )
    expect(upserts).toContainEqual(
      expect.objectContaining({
        canonicalKey: 'url:https://docs.example/orchestrated',
        occurrence: expect.objectContaining({
          actor: 'tool',
          activity: 'read',
          label: 'lookup_docs · Documentation',
          locator: 'https://docs.example/orchestrated',
        }),
      }),
    )
    expect(upserts).not.toContainEqual(
      expect.objectContaining({ canonicalKey: 'tool:failed-1:failed_tool' }),
    )
  })
})
