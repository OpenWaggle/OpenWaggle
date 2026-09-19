import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { listAgentDefinitions, resolveAgentDefinition } from '../agent-definition-catalog'
import { parseAgentDefinition } from '../agent-definition-parser'

const validDefinition = `---
schemaVersion: 1
name: security-reviewer
description: Reviews authorization boundaries
model: openai/gpt-5.6
reasoning: high
tools: [read_file, search]
sessionCapabilities: [sessions:discover, sessions:read]
workspace: new-worktree
---

Review the requested change and report concrete authorization findings.
`

describe('Agent definition documents', () => {
  let root = ''
  let home = ''
  let project = ''

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-agent-definitions-'))
    home = path.join(root, 'home')
    project = path.join(root, 'project')
  })

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true })
  })

  it('strictly parses schema-versioned Markdown with JSON-compatible YAML', () => {
    expect(parseAgentDefinition(validDefinition)).toMatchObject({
      schemaVersion: 1,
      name: 'security-reviewer',
      reasoning: 'high',
      tools: ['read_file', 'search'],
      sessionCapabilities: ['sessions:discover', 'sessions:read'],
      instructions: 'Review the requested change and report concrete authorization findings.',
    })
    expect(() =>
      parseAgentDefinition(validDefinition.replace('reasoning: high', 'unknownField: true')),
    ).toThrow()
    expect(() =>
      parseAgentDefinition(
        validDefinition.replace('tools: [read_file, search]', 'tools: &t [read]\nskills: *t'),
      ),
    ).toThrow('aliases')
    expect(
      parseAgentDefinition(validDefinition.replace('reasoning: high', 'reasoning: max')),
    ).toMatchObject({ reasoning: 'max' })
  })

  it('uses project, portable-project, then user precedence without falling through errors', async () => {
    const projectDirectory = path.join(project, '.openwaggle', 'agents')
    const portableDirectory = path.join(project, '.agents', 'agents')
    const userDirectory = path.join(home, '.openwaggle', 'agents')
    await Promise.all([
      fs.mkdir(projectDirectory, { recursive: true }),
      fs.mkdir(portableDirectory, { recursive: true }),
      fs.mkdir(userDirectory, { recursive: true }),
    ])
    await Promise.all([
      fs.writeFile(
        path.join(projectDirectory, 'broken-file-name.md'),
        validDefinition.replace('reasoning: high', 'unknownField: true'),
        'utf8',
      ),
      fs.writeFile(path.join(portableDirectory, 'security-reviewer.md'), validDefinition, 'utf8'),
      fs.writeFile(
        path.join(userDirectory, 'writer.md'),
        validDefinition.replaceAll('security-reviewer', 'writer'),
        'utf8',
      ),
    ])

    const catalog = await listAgentDefinitions({ projectPath: project, userHome: home })
    expect(catalog).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'security-reviewer',
          scope: 'project',
          loadError: expect.any(String),
        }),
        expect.objectContaining({ name: 'writer', scope: 'user' }),
      ]),
    )
    await expect(
      resolveAgentDefinition({ projectPath: project, userHome: home, name: 'security-reviewer' }),
    ).rejects.toThrow('invalid')
  })

  it('returns an immutable resolved snapshot with a content digest', async () => {
    const directory = path.join(project, '.openwaggle', 'agents')
    await fs.mkdir(directory, { recursive: true })
    await fs.writeFile(path.join(directory, 'reviewer.md'), validDefinition, 'utf8')

    await expect(
      resolveAgentDefinition({ projectPath: project, userHome: home, name: 'security-reviewer' }),
    ).resolves.toMatchObject({
      name: 'security-reviewer',
      scope: 'project',
      contentDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
    })
  })

  it('rejects a project catalog directory that is a symlink outside the project', async () => {
    const projectDirectory = path.join(project, '.openwaggle')
    const outside = path.join(root, 'outside-definitions')
    await Promise.all([fs.mkdir(projectDirectory, { recursive: true }), fs.mkdir(outside)])
    await fs.writeFile(path.join(outside, 'reviewer.md'), validDefinition, 'utf8')
    await fs.symlink(outside, path.join(projectDirectory, 'agents'))

    await expect(listAgentDefinitions({ projectPath: project, userHome: home })).rejects.toThrow(
      'must not be symbolic links',
    )
  })
})
