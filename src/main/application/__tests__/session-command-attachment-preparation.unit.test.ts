import type { LocalSessionCommandPayload } from '@shared/types/local-session-protocol'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { describe, expect, it, vi } from 'vitest'
import { SessionAuthorizationTargetRepository } from '../../ports/session-authorization-target-repository'
import { SessionControlAttachmentService } from '../../ports/session-control-attachment-service'
import { prepareSessionCommandAttachments } from '../session-command-attachment-preparation'

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
})
