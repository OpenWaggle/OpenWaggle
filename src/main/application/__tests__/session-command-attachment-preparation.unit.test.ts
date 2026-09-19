import { spawnSync } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { LocalSessionCommandPayload } from '@shared/types/local-session-protocol'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SessionAuthorizationTargetRepository } from '../../ports/session-authorization-target-repository'
import { SessionControlAttachmentService } from '../../ports/session-control-attachment-service'
import { prepareAttachmentFiles } from '../../utils/attachment-preparation'
import { prepareSessionCommandAttachments } from '../session-command-attachment-preparation'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true })),
  )
})

function payload(path: string): LocalSessionCommandPayload {
  return {
    contract: 'session-control-v2',
    request: {
      contractVersion: 2,
      requestId: 'request-1',
      idempotencyKey: 'idempotency-1',
      command: {
        operation: 'message',
        sessionId: 'session-1',
        input: { text: 'Inspect this.', attachmentIds: [], thinkingLevel: 'high' },
      },
    },
    transport: { attachmentPaths: [path] },
  }
}

describe('Session command attachment preparation', () => {
  it('prepares named-profile paths only under an explicit attachment root', async () => {
    const prepare = vi.fn(() =>
      Effect.succeed([
        {
          id: 'attachment-1',
          kind: 'text' as const,
          origin: 'user-file' as const,
          name: 'evidence.txt',
          path: '/workspace/evidence.txt',
          mimeType: 'text/plain',
          sizeBytes: 8,
          extractedText: 'evidence',
        },
      ]),
    )
    const layer = Layer.merge(
      Layer.succeed(SessionControlAttachmentService, {
        prepare,
        bind: () => Effect.die('unused'),
        cleanupUnreferenced: () => Effect.die('unused'),
        resolve: () => Effect.die('unused'),
        release: () => Effect.die('unused'),
      }),
      Layer.succeed(SessionAuthorizationTargetRepository, {
        resolve: () =>
          Effect.succeed({
            sessionId: 'session-1',
            projectPath: '/project',
            workingPath: '/workspace',
            hiveRootSessionId: 'session-1',
            authorizationCeiling: 'ask-for-approval' as const,
          }),
        resolveDelegation: () => Effect.die('unused'),
        listLiveDerivedAuthorities: () => Effect.succeed([]),
      }),
    )

    const result = await Effect.runPromise(
      prepareSessionCommandAttachments({
        caller: {
          callerId: 'profile:automation',
          workingDirectory: '/workspace',
          profileAuthority: {
            profileId: 'automation',
            profileName: 'automation',
            capabilities: ['sessions:message'],
            scope: { sessionIds: ['session-1'], attachmentRoots: ['/workspace'] },
            authorizationCeiling: 'ask-for-approval',
          },
        },
        payload: payload('evidence.txt'),
        workingDirectory: '/workspace',
      }).pipe(Effect.provide(layer)),
    )

    expect(prepare).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerCallerId: 'profile:automation',
        allowedRoots: ['/workspace'],
      }),
    )
    expect(result).toMatchObject({
      request: { command: { input: { attachmentIds: ['attachment-1'] } } },
    })
  })

  it('rejects attachment paths for a session-only profile', async () => {
    const prepare = vi.fn(() => Effect.succeed([]))
    const layer = Layer.succeed(SessionControlAttachmentService, {
      prepare,
      bind: () => Effect.die('unused'),
      cleanupUnreferenced: () => Effect.die('unused'),
      resolve: () => Effect.die('unused'),
      release: () => Effect.die('unused'),
    })

    await expect(
      Effect.runPromise(
        prepareSessionCommandAttachments({
          caller: {
            callerId: 'profile:session-only',
            workingDirectory: '/workspace',
            profileAuthority: {
              profileId: 'session-only',
              profileName: 'session-only',
              capabilities: ['sessions:message'],
              scope: { sessionIds: ['session-1'] },
              authorizationCeiling: 'ask-for-approval',
            },
          },
          payload: payload('private.txt'),
          workingDirectory: '/workspace',
        }).pipe(Effect.provide(layer)),
      ),
    ).rejects.toThrow('attachment-root grant')
    expect(prepare).not.toHaveBeenCalled()
  })

  it('rejects an out-of-scope FIFO before the scoped request can block', async () => {
    if (process.platform === 'win32') return
    const directory = await fs.realpath(
      await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-scoped-attachment-fifo-')),
    )
    temporaryDirectories.push(directory)
    const workspace = path.join(directory, 'workspace')
    const fifoPath = path.join(directory, 'outside.pipe')
    await fs.mkdir(workspace)
    expect(spawnSync('mkfifo', [fifoPath]).status).toBe(0)

    const prepare = vi.fn((input: Parameters<typeof prepareAttachmentFiles>[0]) =>
      Effect.tryPromise({
        try: () => prepareAttachmentFiles(input),
        catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
      }),
    )
    const layer = Layer.succeed(SessionControlAttachmentService, {
      prepare,
      bind: () => Effect.die('unused'),
      cleanupUnreferenced: () => Effect.die('unused'),
      resolve: () => Effect.die('unused'),
      release: () => Effect.die('unused'),
    })
    const running = Effect.runPromise(
      prepareSessionCommandAttachments({
        caller: {
          callerId: 'profile:automation',
          workingDirectory: workspace,
          profileAuthority: {
            profileId: 'automation',
            profileName: 'automation',
            capabilities: ['sessions:message'],
            scope: { sessionIds: ['session-1'], attachmentRoots: [workspace] },
            authorizationCeiling: 'ask-for-approval',
          },
        },
        payload: payload(fifoPath),
        workingDirectory: workspace,
      }).pipe(Effect.provide(layer)),
    )
    let timeout: ReturnType<typeof setTimeout> | undefined
    const blocked = new Promise((_, reject) => {
      timeout = setTimeout(
        () => reject(new Error('Scoped FIFO attachment request blocked.')),
        1_000,
      )
    })

    try {
      await expect(Promise.race([running, blocked])).rejects.toThrow(
        'outside the caller-authorized workspace',
      )
    } finally {
      clearTimeout(timeout)
    }
    expect(prepare).toHaveBeenCalledOnce()
  })
})
