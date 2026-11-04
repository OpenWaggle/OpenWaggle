import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { ExtensionAPI, ToolDefinition } from '@earendil-works/pi-coding-agent'
import { fromPartial } from '@total-typescript/shoehorn'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { installSessionToolGateway } from '../../../session-host/session-tool-gateway'
import { createSessionsToolExtension } from '../sessions-tool-extension'

const SPAWNED = {
  contract: 'session-lifecycle-v2' as const,
  response: {
    contractVersion: 2 as const,
    requestId: 'spawn-request',
    idempotencyKey: 'spawn-key',
    replayed: false,
    outcome: {
      operation: 'spawn' as const,
      effect: 'spawned-worker' as const,
      sessionId: 'session-worker',
      runId: 'run-worker',
      workspaceId: 'workspace-worker',
      parentSessionId: 'session-queen',
      parentRunId: 'run-queen',
      hiveRootSessionId: 'session-queen',
      depth: 1,
      delegationId: 'delegation-worker',
      derivedGrantId: 'grant-worker',
    },
  },
}

const REVIEW_OBJECTIVE =
  'You are an independent code reviewer with a fresh context; you did not write this change. Review the diff of the branch against main, the project guidelines and its ticket, and report findings by severity.'

describe('hive spawn suggests a matching Agent definition', () => {
  let releaseGateway: (() => void) | undefined
  const temporaryRoots: string[] = []

  afterEach(async () => {
    releaseGateway?.()
    releaseGateway = undefined
    await Promise.all(
      temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })),
    )
  })

  async function spawn(
    params: Record<string, unknown>,
    options: { readonly toggles?: Readonly<Record<string, boolean>> } = {},
  ) {
    const projectPath = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-spawn-hint-'))
    temporaryRoots.push(projectPath)
    await fs.mkdir(path.join(projectPath, '.openwaggle', 'agents'), { recursive: true })
    await fs.writeFile(
      path.join(projectPath, '.openwaggle', 'agents', 'reviewer.md'),
      `---
schemaVersion: 1
name: reviewer
description: Review a diff, a branch or a merge request against the project guidelines and its ticket with a fresh context. Use when the agent that wrote the code needs an independent review.
---

Review it.
`,
      'utf8',
    )
    const gateway = vi.fn(async () => SPAWNED)
    releaseGateway = installSessionToolGateway(gateway)
    let tool: ToolDefinition | undefined
    createSessionsToolExtension({
      sessionId: 'session-queen',
      runId: 'run-queen',
      workingDirectory: projectPath,
      projectPath,
      ...(options.toggles ? { agentDefinitionToggles: options.toggles } : {}),
    })(
      fromPartial<ExtensionAPI>({
        registerTool: (registered: ToolDefinition) => {
          tool = registered
        },
      }),
    )
    const result = await tool?.execute(
      'spawn-call',
      { action: 'spawn', ...params },
      new AbortController().signal,
      () => undefined,
      fromPartial({}),
    )
    return { result, gateway }
  }

  it('names the definition after a spawn whose objective restates its role', async () => {
    const { result, gateway } = await spawn({
      title: 'Independent code review: MR !302',
      objective: REVIEW_OBJECTIVE,
    })

    expect(gateway).toHaveBeenCalledTimes(1)
    expect(result?.isError).toBeFalsy()
    expect(result?.details).toEqual(SPAWNED)
    expect(result?.content).toHaveLength(2)
    expect(result?.content[1]).toEqual({
      type: 'text',
      text: expect.stringMatching(
        /^suggestedAgent: "reviewer"\. .*spawn the next such Worker with agent: "reviewer" and an objective that carries only its task\.$/,
      ),
    })
  })

  it('adds nothing when the spawn already names an agent', async () => {
    const { result } = await spawn({ objective: REVIEW_OBJECTIVE, agent: 'reviewer' })

    expect(result?.content).toHaveLength(1)
  })

  it('adds nothing for an objective of another role', async () => {
    const { result } = await spawn({
      objective: 'Implement the upload size cap on a fresh branch and open a merge request.',
    })

    expect(result?.content).toHaveLength(1)
  })

  it('never suggests a definition turned off for the project', async () => {
    const { result } = await spawn(
      { title: 'Independent code review', objective: REVIEW_OBJECTIVE },
      { toggles: { reviewer: false } },
    )

    expect(result?.content).toHaveLength(1)
  })
})
