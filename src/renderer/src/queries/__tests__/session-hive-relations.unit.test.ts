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
