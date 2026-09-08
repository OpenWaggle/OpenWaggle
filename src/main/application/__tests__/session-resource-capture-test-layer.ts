import { SessionId } from '@shared/types/brand'
import type { SessionResource, SessionResourceKind } from '@shared/types/session-resource'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { validatedImageBuffer } from '../../domain/session-resource-image'
import { SessionResourceRepositoryError, SessionResourceStoreError } from '../../errors'
import { SessionResourceImageFetcher } from '../../ports/session-resource-image-fetcher'
import { SessionResourceImageValidator } from '../../ports/session-resource-image-validator'
import type { UpsertSessionResourceInput } from '../../ports/session-resource-repository'
import { SessionResourceRepository } from '../../ports/session-resource-repository'
import { SessionResourceStore } from '../../ports/session-resource-store'
import { sessionResourceTestSessionLayer } from './session-resource-capture-test-session-layer'

export const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVQImWP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg=='

interface SessionResourceTestLayerOptions {
  readonly duplicateLocator?: string
  readonly existingResource?: SessionResource
  readonly existingResources?: readonly SessionResource[]
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
  readonly sessionWorkingPath?: string
  readonly storeFileFailsFor?: readonly string[]
  readonly upsertFails?: boolean
  readonly upsertFailsForKinds?: readonly SessionResourceKind[]
}

export function sessionResourceTestLayer(
  upserts: UpsertSessionResourceInput[],
  options: SessionResourceTestLayerOptions = {},
) {
  return Layer.mergeAll(
    sessionResourceTestSessionLayer(options.sessionWorkingPath),
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
          if (options.upsertFails || options.upsertFailsForKinds?.includes(input.kind)) {
            return Effect.fail(
              new SessionResourceRepositoryError({
                operation: 'upsert',
                cause: new Error('Resource database unavailable'),
              }),
            )
          }
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
        listPage: (_sessionId, input) => {
          const matching = (options.listedResources ?? []).filter(
            (resource) =>
              input.view === 'all' ||
              (input.view === 'images' && resource.kind === 'image') ||
              (input.view === 'sources' && resource.isSource) ||
              (input.view === 'outputs' && resource.isOutput),
          )
          return Effect.succeed({
            resources: matching.slice(0, input.limit),
            total: matching.length,
            nextCursor: null,
            orderRevision: 'none',
          })
        },
        findById: (_sessionId, resourceId) =>
          Effect.succeed(
            [
              options.existingResource,
              ...(options.existingResources ?? []),
              ...(options.listedResources ?? []),
            ]
              .filter((resource) => resource !== undefined)
              .find((resource) => resource.id === resourceId) ?? null,
          ),
        findByOccurrence: (_sessionId, occurrenceId) =>
          Effect.succeed(
            [
              options.existingResource,
              ...(options.existingResources ?? []),
              ...(options.listedResources ?? []),
            ]
              .filter((resource) => resource !== undefined)
              .find((resource) =>
                resource.occurrences.some((occurrence) => occurrence.id === occurrenceId),
              ) ?? null,
          ),
        findByLocator: (_sessionId, kind, locator) =>
          Effect.succeed(
            [
              options.existingResource,
              ...(options.existingResources ?? []),
              ...(options.listedResources ?? []),
            ]
              .filter((resource) => resource !== undefined)
              .find((resource) => resource.kind === kind && resource.locator === locator) ?? null,
          ),
        locateImage: () => Effect.succeed(null),
        findByCanonicalKey: (_sessionId, canonicalKey) =>
          Effect.succeed(
            options.existingResources
              ? (options.existingResources.find(
                  (resource) => resource.canonicalKey === canonicalKey,
                ) ?? null)
              : (options.existingResource ?? null),
          ),
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
        hasOccurrences: (_sessionId, occurrenceIds) =>
          Effect.succeed(
            new Set(
              occurrenceIds.filter((occurrenceId) =>
                (options.listedResources ?? []).some((resource) =>
                  resource.occurrences.some((occurrence) => occurrence.id === occurrenceId),
                ),
              ),
            ),
          ),
        listByNodeIds: (_sessionId, nodeIds, kind, limit) =>
          Effect.succeed(
            (options.listedResources ?? [])
              .filter(
                (resource) =>
                  (kind === null || resource.kind === kind) &&
                  resource.occurrences.some(
                    (occurrence) =>
                      occurrence.nodeId !== null && nodeIds.includes(occurrence.nodeId),
                  ),
              )
              .slice(0, limit),
          ),
        listByNodeIdsPage: () =>
          Effect.succeed({ resources: [], total: 0, nextCursor: null, orderRevision: 'none' }),
        listManagedNodeIds: (_sessionId, limit) =>
          Effect.succeed(
            [
              ...new Set(
                (options.listedResources ?? [])
                  .filter((resource) => resource.managed)
                  .flatMap((resource) => resource.occurrences.map(({ nodeId }) => nodeId))
                  .filter((nodeId): nodeId is string => nodeId !== null),
              ),
            ].slice(0, limit),
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
          options.storeFileFails || options.storeFileFailsFor?.includes(input.sourcePath)
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
        openReadStream: () => Effect.succeed(new Blob([]).stream()),
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
