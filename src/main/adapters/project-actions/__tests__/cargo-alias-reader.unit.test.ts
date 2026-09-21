import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { discoverProjectTasks, resolveActionInvocation } from '../task-discovery'

let root: string
beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'openwaggle-cargo-tasks-')))
  await mkdir(join(root, '.cargo'))
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

it('discovers legacy Cargo aliases and re-resolves their original source at launch', async () => {
  const source = join(root, '.cargo/config')
  await writeFile(source, '[alias]\nfast = ["test", "--release"]\n')
  const discovery = await discoverProjectTasks(root)
  expect(discovery.diagnostics).toEqual([])
  expect(discovery.tasks).toEqual([
    {
      reference: { provider: 'cargo-alias', source: '.cargo/config', directory: '.', task: 'fast' },
      group: 'Cargo aliases',
      description: 'test --release',
      runner: 'cargo',
    },
  ])
  const task = discovery.tasks[0]
  if (!task) throw new Error('Missing fixture task')
  const invocation = { type: 'task' as const, task: task.reference }
  expect(await resolveActionInvocation(root, invocation)).toEqual({
    type: 'executable',
    executable: 'cargo',
    args: ['fast'],
    cwd: root,
  })
  await writeFile(source, '[alias]\nfast = "check"\n')
  expect((await discoverProjectTasks(root)).tasks[0]?.description).toBe('check')
  expect(await resolveActionInvocation(root, invocation)).toMatchObject({ args: ['fast'] })
  await rm(source)
  await expect(resolveActionInvocation(root, invocation)).rejects.toThrow('Task unavailable')
})

it('attributes invalid legacy configuration and aliases to the legacy source', async () => {
  const source = join(root, '.cargo/config')
  await writeFile(source, '[broken')
  let discovery = await discoverProjectTasks(root)
  expect(discovery.tasks).toEqual([])
  expect(discovery.diagnostics).toEqual([expect.objectContaining({ source: '.cargo/config' })])
  await writeFile(source, '[alias]\nbuild = "test"\n')
  discovery = await discoverProjectTasks(root)
  expect(discovery.tasks).toEqual([])
  expect(discovery.diagnostics).toEqual([
    { source: '.cargo/config', message: 'Cargo cannot invoke this alias name: build' },
  ])
})
