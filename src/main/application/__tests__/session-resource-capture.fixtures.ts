import type { Message } from '@shared/types/agent'
import { MessageId, ToolCallId } from '@shared/types/brand'
import type { SessionResource } from '@shared/types/session-resource'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import type { UpsertSessionResourceInput } from '../../ports/session-resource-repository'
import { SessionResourceRepository } from '../../ports/session-resource-repository'
import { SessionResourceStore } from '../../ports/session-resource-store'

export const PNG_BASE64 = Buffer.from('small image').toString('base64')

export function sessionResourceTestLayer(
  upserts: UpsertSessionResourceInput[],
  options: {
    readonly duplicateLocator?: string
    readonly existingResource?: SessionResource
    readonly removedPaths?: string[]
    readonly storedByteFiles?: string[]
  } = {},
) {
  return Layer.mergeAll(
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
            occurrences: [input.occurrence],
            isSource:
              input.occurrence.activity === 'provided' || input.occurrence.activity === 'read',
            isOutput:
              input.occurrence.activity === 'created' || input.occurrence.activity === 'updated',
          })
        },
        list: () => Effect.succeed([]),
        findByCanonicalKey: () => Effect.succeed(options.existingResource ?? null),
        getContentLocation: () => Effect.succeed(null),
      }),
    ),
    Layer.succeed(
      SessionResourceStore,
      SessionResourceStore.of({
        storeFile: (input) =>
          Effect.succeed({
            path: `/managed/${input.resourceId}-${input.fileName}`,
            sha256: 'attachment-digest',
            sizeBytes: 42,
          }),
        storeBytes: (input) => {
          options.storedByteFiles?.push(input.fileName)
          return Effect.succeed({
            path: `/managed/${input.resourceId}-${input.fileName}`,
            sha256: 'generated-digest',
            sizeBytes: input.bytes.byteLength,
          })
        },
        read: () => Effect.succeed(new Uint8Array()),
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
