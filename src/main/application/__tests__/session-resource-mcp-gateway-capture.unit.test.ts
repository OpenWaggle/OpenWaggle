import { SessionId } from '@shared/types/brand'
import type { JsonObject } from '@shared/types/json'
import * as Effect from 'effect/Effect'
import { describe, expect, it } from 'vitest'
import type { UpsertSessionResourceInput } from '../../ports/session-resource-repository'
import { captureSuccessfulRunResources } from '../session-resource-capture'
import {
  assistantToolResultMessage,
  PNG_BASE64,
  sessionResourceTestLayer,
} from './session-resource-capture.fixtures'

// A fresh object per copy, as in persisted JSON; shared references would be skipped as revisits.
function screenshot(): JsonObject {
  return { type: 'image', data: PNG_BASE64, mimeType: 'image/png' }
}
const ATTRIBUTION = {
  serverInstanceId: 'server-1',
  serverLabel: 'chrome-devtools',
  toolName: 'take_screenshot',
}

function gatewayDetails(extra: JsonObject = {}): JsonObject {
  return {
    kind: 'gateway',
    result: {
      operation: 'call',
      text: 'MCP tool completed.',
      result: [{ type: 'text', text: 'Took a screenshot.' }, screenshot()],
      attribution: ATTRIBUTION,
      ...extra,
    },
  }
}

async function capturedImages(details: JsonObject) {
  const upserts: UpsertSessionResourceInput[] = []
  await Effect.runPromise(
    captureSuccessfulRunResources({
      sessionId: SessionId('session-1'),
      runId: 'run-mcp-screenshot',
      payload: { text: '', attachments: [] },
      messages: [
        assistantToolResultMessage(false, {
          name: 'mcp_chrome-devtools_take_screenshot_bd31d9df',
          args: { format: 'png' },
          // The model-facing content carries its own copy of the screenshot.
          result: {
            content: [{ type: 'text', text: '{"result":"[image #1: image/png]"}' }, screenshot()],
            details,
          },
          details,
        }),
      ],
    }).pipe(Effect.provide(sessionResourceTestLayer(upserts))),
  )
  return upserts.filter((resource) => resource.kind === 'image')
}

describe('MCP gateway Session Resource capture', () => {
  it('catalogs a screenshot once even though the model-facing content also carries it', async () => {
    const images = await capturedImages(gatewayDetails())

    expect(images).toHaveLength(1)
  })

  it('does not catalog the mirrored MCP App copy as a second screenshot', async () => {
    const images = await capturedImages(
      gatewayDetails({
        app: {
          descriptor: { resourceUri: 'ui://screenshot' },
          toolResult: { content: [screenshot()], isError: false },
        },
      }),
    )

    expect(images).toHaveLength(1)
  })

  it('keeps the MCP App copy when the gateway result exposes structured content', async () => {
    const images = await capturedImages(
      gatewayDetails({
        result: { pageId: 'page-1' },
        app: {
          descriptor: { resourceUri: 'ui://screenshot' },
          toolResult: {
            content: [screenshot()],
            structuredContent: { pageId: 'page-1' },
            isError: false,
          },
        },
      }),
    )

    expect(images).toHaveLength(1)
  })

  it('does not catalog the MCP App mirror of an mcp_run child twice', async () => {
    const upserts: UpsertSessionResourceInput[] = []
    await Effect.runPromise(
      captureSuccessfulRunResources({
        sessionId: SessionId('session-1'),
        runId: 'run-mcp-orchestration',
        payload: { text: '', attachments: [] },
        messages: [
          assistantToolResultMessage(false, {
            name: 'mcp_run',
            details: {
              kind: 'orchestration',
              result: [
                {
                  id: 'shot',
                  handle: 'opaque-shot',
                  status: 'completed',
                  provenance: { handle: 'opaque-shot', ...ATTRIBUTION },
                  result: {
                    operation: 'call',
                    text: 'MCP tool completed.',
                    result: [screenshot()],
                    attribution: ATTRIBUTION,
                    app: {
                      descriptor: { resourceUri: 'ui://screenshot' },
                      toolResult: { content: [screenshot()], isError: false },
                    },
                  },
                },
              ],
            },
          }),
        ],
      }).pipe(Effect.provide(sessionResourceTestLayer(upserts))),
    )

    expect(upserts.filter((resource) => resource.kind === 'image')).toHaveLength(1)
  })
})
