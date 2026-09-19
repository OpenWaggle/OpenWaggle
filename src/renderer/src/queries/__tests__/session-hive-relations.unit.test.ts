import { SessionId } from '@shared/types/brand'
import { expect, it, vi } from 'vitest'
import type { HiveSession } from '../session-hive-contract'
import { readSessionHivePage } from '../session-hive-relations'

const queen: HiveSession = {
  id: SessionId('queen'),
  title: 'Queen',
  lineage: { role: 'queen', directWorkerCount: 1, activeDirectWorkerCount: 1 },
}
const worker: HiveSession = {
  id: SessionId('worker'),
  title: 'Worker',
  lineage: {
    role: 'worker',
    parentSessionId: queen.id,
    directWorkerCount: 0,
    activeDirectWorkerCount: 0,
  },
}

it('accepts direct Workers with omitted parent metadata from the scoped Host catalog', async () => {
  const scopedWorker: HiveSession = {
    ...worker,
    lineage: { role: 'worker', directWorkerCount: 0, activeDirectWorkerCount: 0 },
  }
  await expect(
    readSessionHivePage(
      {
        listHiveSessionCatalogPage: async () => ({ context: [queen], workers: [scopedWorker] }),
      },
      queen.id,
    ),
  ).resolves.toEqual({ current: queen, parent: null, workers: [scopedWorker] })
})

it('prefers the Host catalog, resolves unordered context, and accepts absent optional lineage fields', async () => {
  const getSessionHiveRelations = vi.fn()
  const result = await readSessionHivePage(
    {
      listHiveSessionCatalogPage: async () => ({ context: [queen, worker], workers: [] }),
      getSessionHiveRelations,
    },
    worker.id,
  )
  expect(result).toEqual({ current: worker, parent: queen, workers: [] })
  expect(getSessionHiveRelations).not.toHaveBeenCalled()
})

it('does not fall back to a competing lineage projection when the Host fails', async () => {
  const getSessionHiveRelations = vi.fn()
  await expect(
    readSessionHivePage(
      {
        listHiveSessionCatalogPage: async () => {
          throw new Error('Host unavailable')
        },
        getSessionHiveRelations,
      },
      queen.id,
    ),
  ).rejects.toThrow('Host unavailable')
  expect(getSessionHiveRelations).not.toHaveBeenCalled()
})

it('resolves the immediate parent from unordered context when the focused Worker omits its parent ID', async () => {
  const focused: HiveSession = {
    ...worker,
    lineage: { role: 'worker', directWorkerCount: 0, activeDirectWorkerCount: 0 },
  }
  await expect(
    readSessionHivePage(
      {
        listHiveSessionCatalogPage: async () => ({ context: [focused, queen], workers: [] }),
      },
      focused.id,
    ),
  ).resolves.toEqual({ current: focused, parent: queen, workers: [] })
})

it('rejects another session context and unrelated workers', async () => {
  await expect(
    readSessionHivePage(
      {
        listHiveSessionCatalogPage: async () => ({ context: [queen], workers: [] }),
      },
      SessionId('unrelated'),
    ),
  ).rejects.toThrow('opened session')
  await expect(
    readSessionHivePage(
      {
        listHiveSessionCatalogPage: async () => ({ context: [worker], workers: [worker] }),
      },
      worker.id,
    ),
  ).rejects.toThrow('another session')
})

it('keeps the current projection working when the new capability is absent', async () => {
  const relations = { current: queen, parent: null, workers: [worker] }
  await expect(
    readSessionHivePage({ getSessionHiveRelations: async () => relations }, queen.id),
  ).resolves.toEqual(relations)
})

it.each([queen.id, null])(
  'rejects parent context contradicting explicit parent %s',
  async (parentSessionId) => {
    const focused: HiveSession = {
      ...worker,
      lineage: {
        role: 'worker',
        parentSessionId,
        directWorkerCount: 0,
        activeDirectWorkerCount: 0,
      },
    }
    const getSessionHiveRelations = vi.fn()
    await expect(
      readSessionHivePage(
        {
          listHiveSessionCatalogPage: async () => ({
            context: [focused, { id: SessionId('unrelated'), title: 'Unrelated' }],
            workers: [],
          }),
          getSessionHiveRelations,
        },
        focused.id,
      ),
    ).rejects.toThrow('mismatched parent context')
    expect(getSessionHiveRelations).not.toHaveBeenCalled()
  },
)

it('rejects ambiguous parent context instead of choosing an unrelated Session', async () => {
  await expect(
    readSessionHivePage(
      {
        listHiveSessionCatalogPage: async () => ({
          context: [queen, worker, { id: SessionId('unrelated'), title: 'Unrelated' }],
          workers: [],
        }),
      },
      queen.id,
    ),
  ).rejects.toThrow('parent context')
})

it('accepts scoped Workers without lineage while preserving explicit null parent semantics', async () => {
  const root: HiveSession = {
    ...queen,
    lineage: {
      role: 'queen',
      parentSessionId: null,
      directWorkerCount: 1,
      activeDirectWorkerCount: 0,
    },
  }
  const minimalWorker = { id: worker.id, title: worker.title }
  await expect(
    readSessionHivePage(
      {
        listHiveSessionCatalogPage: async () => ({ context: [root], workers: [minimalWorker] }),
      },
      root.id,
    ),
  ).resolves.toEqual({ current: root, parent: null, workers: [minimalWorker] })
  await expect(
    readSessionHivePage(
      {
        listHiveSessionCatalogPage: async () => ({ context: [worker], workers: [root] }),
      },
      worker.id,
    ),
  ).rejects.toThrow('another session')
})
