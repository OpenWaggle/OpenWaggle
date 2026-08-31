import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type {
  ExtensionAPI,
  ExtensionContext,
  ToolDefinition,
} from '@earendil-works/pi-coding-agent'
import { fromPartial } from '@total-typescript/shoehorn'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { installSessionToolGateway } from '../../../session-host/session-tool-gateway'
import { OPENWAGGLE_AUTHORIZE_KEY } from '../agent-kernel/openwaggle-authorize-channel'
import { createSessionsToolExtension } from '../sessions-tool-extension'

describe('Pi-native Sessions export scope', () => {
  let releaseGateway: (() => void) | undefined
  let temporaryRoot = ''

  afterEach(async () => {
    releaseGateway?.()
    if (temporaryRoot) await fs.rm(temporaryRoot, { recursive: true, force: true })
  })

  it('dispatches the canonical export destination and durable workspace root', async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-pi-export-scope-'))
    const workspace = path.join(temporaryRoot, 'workspace')
    await fs.mkdir(workspace)
    const gateway = vi.fn(async () => ({
      contract: 'session-control-v2' as const,
      response: {
        contractVersion: 2 as const,
        requestId: 'export',
        idempotencyKey: 'export',
        replayed: false,
        outcome: {
          operation: 'export-create' as const,
          effect: 'export-accepted' as const,
          sessionId: 'session-worker',
          exportOperationId: 'export-1',
          status: 'queued' as const,
        },
      },
    }))
    const authorize = vi.fn(async () => true)
    const context = fromPartial<ExtensionContext>({ hasUI: true, ui: fromPartial({}) })
    Reflect.set(context.ui, OPENWAGGLE_AUTHORIZE_KEY, authorize)
    releaseGateway = installSessionToolGateway(gateway)
    let tool: ToolDefinition | undefined
    createSessionsToolExtension({
      sessionId: 'session-queen',
      runId: 'run-current',
      workingDirectory: workspace,
    })(
      fromPartial<ExtensionAPI>({
        registerTool: (registered: ToolDefinition) => {
          tool = registered
        },
      }),
    )

    await tool?.execute(
      'tool-call',
      {
        action: 'export_create',
        sessionId: 'session-worker',
        destinationPath: 'exports/worker.jsonl',
      },
      new AbortController().signal,
      () => undefined,
      context,
    )

    const canonicalRoot = await fs.realpath(workspace)
    expect(authorize).toHaveBeenCalledWith(
      expect.objectContaining({
        scopeKey: expect.objectContaining({ capability: 'sessions.export-write' }),
      }),
    )
    expect(gateway).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          request: expect.objectContaining({
            command: expect.objectContaining({
              destinationPath: path.join(canonicalRoot, 'exports', 'worker.jsonl'),
              destinationRoot: canonicalRoot,
            }),
          }),
        }),
      }),
    )
  })

  it('does not bundle workspace resources on destination-write approval alone', async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-pi-export-read-'))
    const workspace = path.join(temporaryRoot, 'workspace')
    await fs.mkdir(workspace)
    await fs.writeFile(path.join(workspace, '.env'), 'SECRET=value', 'utf8')
    const gateway = vi.fn()
    releaseGateway = installSessionToolGateway(gateway)
    let tool: ToolDefinition | undefined
    createSessionsToolExtension({
      sessionId: 'session-queen',
      runId: 'run-current',
      workingDirectory: workspace,
    })(
      fromPartial<ExtensionAPI>({
        registerTool: (registered: ToolDefinition) => {
          tool = registered
        },
      }),
    )
    const authorize = vi.fn(
      async (request: { scopeKey: { capability: string } }) =>
        request.scopeKey.capability === 'sessions.export-write',
    )
    const context = fromPartial<ExtensionContext>({ hasUI: true, ui: fromPartial({}) })
    Reflect.set(context.ui, OPENWAGGLE_AUTHORIZE_KEY, authorize)

    const result = await tool?.execute(
      'tool-call',
      {
        action: 'export_create',
        sessionId: 'session-worker',
        destinationPath: 'exports/worker.zip',
        format: 'bundle',
        resources: ['.env'],
      },
      new AbortController().signal,
      () => undefined,
      context,
    )

    expect(result).toMatchObject({ isError: true })
    expect(authorize).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining('.env'),
        scopeKey: expect.objectContaining({ capability: 'sessions.resource-read' }),
      }),
    )
    expect(gateway).not.toHaveBeenCalled()
  })
})
