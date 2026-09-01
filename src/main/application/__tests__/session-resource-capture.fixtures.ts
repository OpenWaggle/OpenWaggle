import type { Message } from '@shared/types/agent'
import { MessageId, SessionId, ToolCallId } from '@shared/types/brand'
import type { SessionResource } from '@shared/types/session-resource'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { validatedImageBuffer } from '../../domain/session-resource-image'
import { SessionResourceStoreError } from '../../errors'
import { SessionResourceImageFetcher } from '../../ports/session-resource-image-fetcher'
import { SessionResourceImageValidator } from '../../ports/session-resource-image-validator'
import type { UpsertSessionResourceInput } from '../../ports/session-resource-repository'
import { SessionResourceRepository } from '../../ports/session-resource-repository'
import { SessionResourceStore } from '../../ports/session-resource-store'

export const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVQImWP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg=='

export function sessionResourceTestLayer(
  upserts: UpsertSessionResourceInput[],
  options: {
    readonly duplicateLocator?: string
    readonly existingResource?: SessionResource
    readonly removedPaths?: string[]
    readonly storedByteFiles?: string[]
    readonly storedAttachmentFiles?: string[]
    readonly storedAttachmentSha256?: Array<string | undefined>
    readonly storedAttachmentBytes?: Uint8Array
    readonly fetchedUrls?: string[]
    readonly existingManagedPath?: string
    readonly managedReadFails?: boolean
    readonly inspectedManagedPaths?: string[]
    readonly readManagedPaths?: string[]
    readonly storeFileFails?: boolean
    readonly listedResources?: readonly SessionResource[]
    readonly hasOccurrence?: boolean
    readonly rekeyedCanonicalKeys?: string[]
  } = {},
) {
  return Layer.mergeAll(
    Layer.succeed(
      SessionResourceImageValidator,
      SessionResourceImageValidator.of({
        validate: (bytes, mimeType) => Effect.succeed(validatedImageBuffer(bytes, mimeType)),
      }),
    ),
    Layer.succeed(
      SessionResourceImageFetcher,
      SessionResourceImageFetcher.of({
        fetch: (url) =>
          Effect.sync(() => {
            options.fetchedUrls?.push(url)
            return {
              bytes: Buffer.from(PNG_BASE64, 'base64'),
              mimeType: 'image/png',
              fileName: 'remote.png',
            }
          }),
      }),
    ),
    Layer.succeed(
      SessionResourceRepository,
      SessionResourceRepository.of({
        upsert: (input) => {
          upserts.push(input)
          return Effect.succeed({
            ...input,
            ...(options.duplicateLocator
              ? { id: 'existing-resource', locator: options.duplicateLocator }
              : {}),
            managed: input.managedPath !== null,
            occurrences: [input.occurrence],
            isSource:
              input.occurrence.activity === 'provided' || input.occurrence.activity === 'read',
            isOutput:
              input.occurrence.activity === 'created' || input.occurrence.activity === 'updated',
          })
        },
        list: () => Effect.succeed(options.listedResources ?? []),
        findByCanonicalKey: () => Effect.succeed(options.existingResource ?? null),
        rekey: (input) =>
          Effect.sync(() => {
            options.rekeyedCanonicalKeys?.push(input.canonicalKey)
            const existing = [options.existingResource, ...(options.listedResources ?? [])]
              .filter((resource) => resource !== undefined)
              .find((resource) => resource.id === input.resourceId)
            if (!existing) throw new Error('Expected an existing resource to re-key.')
            return { ...existing, canonicalKey: input.canonicalKey, updatedAt: input.updatedAt }
          }),
        hasOccurrence: (_sessionId, occurrenceId) =>
          Effect.succeed(
            options.hasOccurrence ??
              (options.listedResources ?? []).some((resource) =>
                resource.occurrences.some((occurrence) => occurrence.id === occurrenceId),
              ),
          ),
        getContentLocation: (_sessionId, resourceId) =>
          [options.existingResource, ...(options.listedResources ?? [])]
            .filter((resource) => resource !== undefined)
            .find((resource) => resource.id === resourceId && resource.available)
            ? Effect.succeed({
                resourceId,
                sessionId: SessionId('session-1'),
                fileName: 'resource.png',
                mimeType: 'image/png',
                managedPath: options.existingManagedPath ?? '/managed/existing-resource.png',
              })
            : Effect.succeed(null),
        getBackfillCursor: () => Effect.succeed(-1),
        advanceBackfillCursor: () => Effect.void,
      }),
    ),
    Layer.succeed(
      SessionResourceStore,
      SessionResourceStore.of({
        storeFile: (input) =>
          options.storeFileFails
            ? Effect.fail(
                new SessionResourceStoreError({
                  operation: 'storeFile',
                  cause: new Error('Attachment source disappeared'),
                }),
              )
            : Effect.sync(() => {
                options.storedAttachmentFiles?.push(input.fileName)
                options.storedAttachmentSha256?.push(input.expectedSha256)
                return {
                  path: `/managed/${input.resourceId}-${input.fileName}`,
                  sha256: 'attachment-digest',
                  sizeBytes: 42,
                }
              }),
        storeBytes: (input) => {
          options.storedByteFiles?.push(input.fileName)
          return Effect.succeed({
            path: `/managed/${input.resourceId}-${input.fileName}`,
            sha256: 'generated-digest',
            sizeBytes: input.bytes.byteLength,
          })
        },
        inspect: (managedPath) =>
          Effect.sync(() => options.inspectedManagedPaths?.push(managedPath)).pipe(
            Effect.flatMap(() =>
              options.managedReadFails
                ? Effect.fail(
                    new SessionResourceStoreError({
                      operation: 'inspect',
                      cause: new Error('Managed resource is missing'),
                    }),
                  )
                : Effect.void,
            ),
          ),
        read: (managedPath) =>
          Effect.sync(() => options.readManagedPaths?.push(managedPath)).pipe(
            Effect.flatMap(() =>
              options.managedReadFails
                ? Effect.fail(
                    new SessionResourceStoreError({
                      operation: 'read',
                      cause: new Error('Managed resource is missing'),
                    }),
                  )
                : Effect.succeed(
                    options.storedAttachmentBytes ?? Buffer.from(PNG_BASE64, 'base64'),
                  ),
            ),
          ),
        remove: (managedPath) =>
          Effect.sync(() => {
            options.removedPaths?.push(managedPath)
          }),
        removeSession: () => Effect.void,
      }),
    ),
  )
}

export function resourceMessages(): Message[] {
  return [
    {
      id: MessageId('user-message'),
      role: 'user',
      parts: [{ type: 'text', text: 'Review [reference](https://user.example/reference)' }],
      createdAt: 1000,
    },
    {
      id: MessageId('assistant-message'),
      role: 'assistant',
      parts: [
        { type: 'text', text: 'Source: [documentation](https://agent.example/source)' },
        {
          type: 'tool-result',
          toolResult: {
            id: ToolCallId('image-tool'),
            name: 'imagegen',
            args: {},
            result: { content: [{ type: 'image', data: PNG_BASE64, mimeType: 'image/png' }] },
            isError: false,
            duration: 10,
          },
        },
      ],
      createdAt: 2000,
    },
  ]
}
