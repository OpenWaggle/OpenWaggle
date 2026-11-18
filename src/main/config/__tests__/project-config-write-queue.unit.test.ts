import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  enqueueProjectConfigWrite,
  projectConfigWriteQueueCountForTests,
  resetProjectConfigWriteQueuesForTests,
} from '../project-config-write-queue'

describe('project config write queue retention', () => {
  afterEach(() => {
    resetProjectConfigWriteQueuesForTests()
  })

  it('releases distinct per-path tails after they settle', async () => {
    await Promise.all([
      enqueueProjectConfigWrite('/projects/a/settings.json', async () => 'a'),
      enqueueProjectConfigWrite('/projects/b/settings.json', async () => 'b'),
      enqueueProjectConfigWrite('/projects/c/settings.json', async () => 'c'),
    ])
    await vi.waitFor(() => expect(projectConfigWriteQueueCountForTests()).toBe(0))
  })

  it('keeps a replacement tail while an earlier rejected operation settles', async () => {
    const first = Promise.withResolvers<void>()
    const second = Promise.withResolvers<void>()
    const order: string[] = []
    const firstWrite = enqueueProjectConfigWrite('/projects/a/settings.json', async () => {
      order.push('first:start')
      await first.promise
      order.push('first:reject')
      throw new Error('first failed')
    })
    const secondWrite = enqueueProjectConfigWrite('/projects/a/settings.json', async () => {
      order.push('second:start')
      await second.promise
      order.push('second:finish')
    })

    await vi.waitFor(() => expect(order).toEqual(['first:start']))
    first.resolve()
    await expect(firstWrite).rejects.toThrow('first failed')
    await vi.waitFor(() => expect(order).toEqual(['first:start', 'first:reject', 'second:start']))
    expect(projectConfigWriteQueueCountForTests()).toBe(1)

    second.resolve()
    await secondWrite
    await vi.waitFor(() => expect(projectConfigWriteQueueCountForTests()).toBe(0))
  })
})
