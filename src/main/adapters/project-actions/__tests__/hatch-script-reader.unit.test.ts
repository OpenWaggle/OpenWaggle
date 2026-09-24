import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ActionInvocation } from '@shared/types/action-definitions'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { discoverProjectTasks, resolveActionInvocation } from '../task-discovery'

let root: string
beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'openwaggle-hatch-tasks-')))
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

function invocation(environment: string, task: string): ActionInvocation {
  return {
    type: 'task',
    task: { provider: 'hatch-script', source: 'hatch.toml', directory: '.', task, environment },
  }
}

it('keeps plain environments invocable when their template defines a matrix', async () => {
  await writeFile(
    join(root, 'hatch.toml'),
    `[envs.default.scripts]
test = "echo test"
[[envs.default.matrix]]
python = ["3.12", "3.13"]
[envs.docs.scripts]
build = "echo docs"
`,
  )
  const discovery = await discoverProjectTasks(root)
  expect(discovery.tasks.map(({ reference }) => [reference.environment, reference.task])).toEqual([
    ['docs', 'test'],
    ['docs', 'build'],
  ])
  expect(discovery.diagnostics).toEqual([
    {
      source: 'hatch.toml · default',
      message: 'Hatch matrix environment default needs a custom command with an explicit selector.',
    },
  ])
  await expect(resolveActionInvocation(root, invocation('docs', 'test'))).resolves.toEqual({
    type: 'executable',
    executable: 'hatch',
    args: ['run', 'docs:test'],
    cwd: root,
  })
  await expect(resolveActionInvocation(root, invocation('docs', 'build'))).resolves.toMatchObject({
    executable: 'hatch',
    args: ['run', 'docs:build'],
  })
  await expect(resolveActionInvocation(root, invocation('default', 'test'))).rejects.toThrow(
    'Hatch matrix environment default needs a custom command',
  )
})

it('replaces inherited extra-scripts while preserving inherited scripts and their precedence', async () => {
  const source = join(root, 'hatch.toml')
  const original = `[envs.default.scripts]
shared = "echo parent script"
[envs.default.extra-scripts]
old = "echo removed extra"
same = "echo parent extra"
[envs.docs.scripts]
own = "echo docs"
[envs.ci]
template = "docs"
`
  await writeFile(source, original)
  await expect(resolveActionInvocation(root, invocation('docs', 'old'))).resolves.toMatchObject({
    executable: 'hatch',
    args: ['run', 'docs:old'],
  })

  await writeFile(
    source,
    `${original}[envs.docs.extra-scripts]
same = "echo child extra"
build = "echo build"
shared = "must not override inherited scripts"
`,
  )
  const discovery = await discoverProjectTasks(root)
  expect(discovery.diagnostics).toEqual([])
  for (const environment of ['docs', 'ci']) {
    expect(
      Object.fromEntries(
        discovery.tasks
          .filter(({ reference }) => reference.environment === environment)
          .map(({ reference, description }) => [reference.task, description]),
      ),
    ).toEqual({
      shared: 'echo parent script',
      own: 'echo docs',
      same: 'echo child extra',
      build: 'echo build',
    })
    await expect(resolveActionInvocation(root, invocation(environment, 'old'))).rejects.toThrow(
      'Task unavailable',
    )
    await expect(resolveActionInvocation(root, invocation(environment, 'build'))).resolves.toEqual({
      type: 'executable',
      executable: 'hatch',
      args: ['run', `${environment}:build`],
      cwd: root,
    })
  }
})
