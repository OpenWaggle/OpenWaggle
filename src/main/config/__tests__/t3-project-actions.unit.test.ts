import { access, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadT3ProjectActions } from '../t3-project-actions'

describe('t3 project action discovery', () => {
  let temporaryRoot: string
  let projectPath: string

  beforeEach(async () => {
    temporaryRoot = await mkdtemp(path.join(tmpdir(), 'openwaggle-t3-actions-'))
    projectPath = path.join(temporaryRoot, 'project')
    await mkdir(projectPath)
  })

  afterEach(async () => {
    await rm(temporaryRoot, { force: true, recursive: true })
  })

  it('reports a missing root file', async () => {
    expect(await loadT3ProjectActions(projectPath)).toEqual({
      status: 'missing',
      scripts: [],
      candidates: [],
    })
  })

  it('decodes JSONC, trims fields, and applies safe defaults without execution', async () => {
    const markerPath = path.join(temporaryRoot, 'must-not-exist')
    await writeFile(
      path.join(projectPath, 't3.json'),
      `{
        // Shared project actions may use JSONC.
        "scripts": [
          {
            "name": "  Dangerous-looking action  ",
            "command": "  touch ${markerPath}  ",
            "autoOpenPreview": true,
          },
          {
            "name": " Tests ",
            "command": " pnpm test ",
            "icon": "test",
            "previewUrl": " localhost:4173 ",
          },
        ],
      }`,
      'utf-8',
    )

    const discovery = await loadT3ProjectActions(projectPath)
    expect(discovery).toEqual({
      status: 'valid',
      scripts: [
        {
          sourceIndex: 0,
          name: 'Dangerous-looking action',
          command: `touch ${markerPath}`,
          icon: 'play',
          runOnWorktreeCreate: false,
        },
        {
          sourceIndex: 1,
          name: 'Tests',
          command: 'pnpm test',
          icon: 'test',
          runOnWorktreeCreate: false,
          previewUrl: 'http://localhost:4173/',
          autoOpenPreview: false,
        },
      ],
      candidates: expect.any(Array),
    })
    await expect(access(markerPath)).rejects.toThrow()
  })

  it.each([
    ['malformed JSONC', '{ "scripts": [ }'],
    [
      'too many scripts',
      JSON.stringify({
        scripts: Array.from({ length: 51 }, (_, index) => ({
          name: `Action ${index}`,
          command: `command-${index}`,
        })),
      }),
    ],
    [
      'unknown icon',
      JSON.stringify({ scripts: [{ name: 'Deploy', command: 'deploy', icon: 'rocket' }] }),
    ],
    [
      'unsafe preview URL',
      JSON.stringify({
        scripts: [{ name: 'Preview', command: 'pnpm dev', previewUrl: 'file:///etc/passwd' }],
      }),
    ],
  ])('reports %s as invalid', async (_label, contents) => {
    await writeFile(path.join(projectPath, 't3.json'), contents, 'utf-8')

    const discovery = await loadT3ProjectActions(projectPath)
    expect(discovery.status).toBe('invalid')
    expect(discovery.scripts).toEqual([])
    expect(discovery.candidates).toEqual([])
  })

  it('rejects a t3.json symlink that escapes the project root', async () => {
    const outsidePath = path.join(temporaryRoot, 'outside.json')
    await writeFile(outsidePath, JSON.stringify({ scripts: [] }), 'utf-8')
    await symlink(outsidePath, path.join(projectPath, 't3.json'))

    const discovery = await loadT3ProjectActions(projectPath)
    expect(discovery.status).toBe('invalid')
    if (discovery.status === 'invalid') {
      expect(discovery.error).toContain('inside the project root')
    }
  })
})
