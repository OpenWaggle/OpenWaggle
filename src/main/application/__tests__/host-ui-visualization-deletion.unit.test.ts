import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { SessionId } from '@shared/types/brand'
import { fromPartial } from '@total-typescript/shoehorn'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { afterEach, expect, it, vi } from 'vitest'
import { makeFilesystemInlineVisualizationService } from '../../adapters/filesystem-inline-visualization-service'
import { SessionProjectionRepositoryError } from '../../errors'
import { InlineVisualizationService } from '../../ports/inline-visualization-service'
import {
  SessionProjectionRepository,
  type SessionProjectionRepositoryShape,
} from '../../ports/session-projection-repository'
import { SessionRepository, type SessionRepositoryShape } from '../../ports/session-repository'
import { installSessionHostEventPublisher } from '../../session-host/session-host-events'
import { hasAnyActiveRun, reserveActiveSessionRun } from '../active-session-runs'
import { dispatchHostBackedSessionGuiOperation } from '../host-ui-session-operation-dispatcher'
import { prepareInlineVisualizationSourceOwner } from '../inline-visualization-source-owner'
import { settingsLayer } from './local-session-command-dispatcher.test-support'

let temporaryRoot = ''
afterEach(async () => {
  if (temporaryRoot) await fs.rm(temporaryRoot, { recursive: true, force: true })
})

async function prepareDeletion(
  deleteProjection: ReturnType<SessionProjectionRepositoryShape['delete']> = Effect.void,
) {
  temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ow-host-viz-delete-'))
  const sessionId = SessionId('host-deleted-session')
  const visualizations = makeFilesystemInlineVisualizationService(temporaryRoot)
  const directory = await Effect.runPromise(visualizations.prepareSession(sessionId))
  const sourcePath = path.join(directory, 'private-map.html')
  await fs.writeFile(sourcePath, '<main>Session data</main>')
  let ownerExists = true
  const layer = Layer.mergeAll(
    settingsLayer,
    Layer.succeed(InlineVisualizationService, visualizations),
    Layer.succeed(
      SessionRepository,
      fromPartial<SessionRepositoryShape>({
        listByIds: () =>
          Effect.succeed(
            ownerExists
              ? [{ id: sessionId, projectPath: null, title: 'Session', createdAt: 1, updatedAt: 1 }]
              : [],
          ),
      }),
    ),
    Layer.succeed(
      SessionProjectionRepository,
      fromPartial<SessionProjectionRepositoryShape>({
        delete: () =>
          deleteProjection.pipe(
            Effect.tap(() =>
              Effect.sync(() => {
                ownerExists = false
              }),
            ),
          ),
      }),
    ),
  )

  return {
    sessionId,
    directory,
    sourcePath,
    visualizations,
    markOwnerDeleted: () => {
      ownerExists = false
    },
    deleteFromHost: dispatchHostBackedSessionGuiOperation('sessions:delete', [sessionId]).pipe(
      Effect.provide(layer),
    ),
    prepareOwner: prepareInlineVisualizationSourceOwner(sessionId).pipe(Effect.provide(layer)),
  }
}

it('removes visualization files through the actual Host Session deletion command', async () => {
  const { deleteFromHost, directory } = await prepareDeletion()

  await Effect.runPromise(deleteFromHost)

  await expect(fs.stat(directory)).rejects.toMatchObject({ code: 'ENOENT' })
  expect(await fs.readdir(path.dirname(directory))).toEqual([])
})

it('restores staged visualization files when Host persistence rejects deletion', async () => {
  const started = Promise.withResolvers<void>()
  const failDeletion = Promise.withResolvers<void>()
  const fixture = await prepareDeletion(
    Effect.tryPromise({
      try: async () => {
        started.resolve()
        await failDeletion.promise
        throw new Error('Deletion refused')
      },
      catch: (cause) => new SessionProjectionRepositoryError({ operation: 'delete', cause }),
    }),
  )
  const deleting = Effect.runPromiseExit(fixture.deleteFromHost)
  await started.promise
  await expect(fs.stat(fixture.directory)).rejects.toMatchObject({ code: 'ENOENT' })
  expect(hasAnyActiveRun(fixture.sessionId)).toBe(true)
  failDeletion.resolve()

  expect((await deleting)._tag).toBe('Failure')
  expect(await fs.readFile(fixture.sourcePath, 'utf8')).toBe('<main>Session data</main>')
  expect(await fs.readdir(path.dirname(fixture.directory))).toEqual([String(fixture.sessionId)])
  expect(hasAnyActiveRun(fixture.sessionId)).toBe(false)
})

it('does not stage files when an active Pi writer prevents deletion', async () => {
  const fixture = await prepareDeletion()
  const run = reserveActiveSessionRun(fixture.sessionId, 'active-run')
  try {
    await expect(Effect.runPromise(fixture.deleteFromHost)).rejects.toThrow('Stop the active Run')
    expect(await fs.readFile(fixture.sourcePath, 'utf8')).toBe('<main>Session data</main>')
    expect(await fs.readdir(path.dirname(fixture.directory))).toEqual([String(fixture.sessionId)])
  } finally {
    run.release()
  }
})

it('does not recreate storage when source preparation waits behind a successful deletion', async () => {
  const started = Promise.withResolvers<void>()
  const finishDeletion = Promise.withResolvers<void>()
  const fixture = await prepareDeletion(
    Effect.promise(async () => {
      started.resolve()
      await finishDeletion.promise
    }),
  )
  const deleting = Effect.runPromise(fixture.deleteFromHost)
  await started.promise
  const preparing = Effect.runPromise(fixture.prepareOwner)
  finishDeletion.resolve()

  await deleting
  expect(await preparing).toBeNull()
  await expect(fs.stat(fixture.directory)).rejects.toMatchObject({ code: 'ENOENT' })
  expect(await fs.readdir(path.dirname(fixture.directory))).toEqual([])
})

it('retains deletion ownership until persistence and cleanup finish after caller cancellation', async () => {
  const started = Promise.withResolvers<void>()
  const finishDeletion = Promise.withResolvers<void>()
  const fixture = await prepareDeletion(
    Effect.promise(async () => {
      started.resolve()
      await finishDeletion.promise
    }),
  )
  const controller = new AbortController()
  const publish = vi.fn()
  const releasePublisher = installSessionHostEventPublisher(publish)
  const deleting = Effect.runPromiseExit(fixture.deleteFromHost, { signal: controller.signal })
  await started.promise
  controller.abort()

  expect(() => reserveActiveSessionRun(fixture.sessionId, 'too-early')).toThrow()
  await expect(fs.stat(fixture.directory)).rejects.toMatchObject({ code: 'ENOENT' })
  finishDeletion.resolve()
  await deleting
  releasePublisher()

  expect(hasAnyActiveRun(fixture.sessionId)).toBe(false)
  expect(await fs.readdir(path.dirname(fixture.directory))).toEqual([])
  expect(publish).toHaveBeenCalledWith({
    kind: 'session-list-changed',
    sessionId: fixture.sessionId,
    change: 'deleted',
  })
})

it('keeps files deleted and invalidates other clients when cleanup fails after the owner commit', async () => {
  const committed = Promise.withResolvers<void>()
  const failCleanup = Promise.withResolvers<void>()
  const failure = new SessionProjectionRepositoryError({
    operation: 'delete',
    cause: new Error('Git cleanup failed'),
  })
  const fixture = await prepareDeletion(
    Effect.promise(async () => {
      committed.resolve()
      await failCleanup.promise
    }).pipe(Effect.andThen(Effect.fail(failure))),
  )
  const publish = vi.fn()
  const releasePublisher = installSessionHostEventPublisher(publish)
  const deleting = Effect.runPromise(fixture.deleteFromHost.pipe(Effect.flip))
  await committed.promise
  fixture.markOwnerDeleted()
  failCleanup.resolve()
  try {
    expect(await deleting).toBe(failure)
    await expect(fs.stat(fixture.directory)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await fs.readdir(path.dirname(fixture.directory))).toEqual([])
    expect(publish).toHaveBeenCalledExactlyOnceWith({
      kind: 'session-list-changed',
      sessionId: fixture.sessionId,
      change: 'deleted',
    })
  } finally {
    releasePublisher()
  }
})
