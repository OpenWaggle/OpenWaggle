import { describe, expect, it } from 'vitest'
import { PROJECT_PATH, resolveOffline as resolve } from './source-control-test-deps'

describe('project-declared source-control hosts', () => {
  it('asks to approve a project declaration that would change the outcome', async () => {
    const result = await resolve({
      readPrimaryRemote: async () => ({ name: 'origin', url: 'git@code.acme.io:acme/app.git' }),
      readProjectDeclarations: async () => ({ 'code.acme.io': 'gitlab' }),
    })

    expect(result).toEqual({
      kind: 'undecided',
      remote: { name: 'origin', url: 'git@code.acme.io:acme/app.git' },
      hostState: { host: 'code.acme.io', provider: null, source: null },
      attention: {
        kind: 'approve-declaration',
        projectPath: PROJECT_PATH,
        hosts: { 'code.acme.io': 'gitlab' },
      },
    })
  })

  it('does not ask about a declaration that agrees with detection', async () => {
    const result = await resolve({
      readProjectDeclarations: async () => ({ 'github.com': 'github' }),
    })

    expect(result).toMatchObject({ kind: 'resolved', attention: null })
  })

  it('uses an approved declaration and ignores a declined one', async () => {
    const remote = { name: 'origin', url: 'git@code.acme.io:acme/app.git' }
    const declared = { 'code.acme.io': 'gitlab' } as const

    const approved = await resolve({
      readPrimaryRemote: async () => remote,
      readProjectDeclarations: async () => declared,
      readPreferences: async () => ({
        userChoices: {},
        detectedHosts: {},
        projectDeclarations: { [PROJECT_PATH]: { approved: declared, declined: {} } },
      }),
    })
    expect(approved).toMatchObject({
      kind: 'resolved',
      hostState: { provider: 'gitlab', source: 'project-declaration' },
      attention: null,
    })

    const declined = await resolve({
      readPrimaryRemote: async () => remote,
      readProjectDeclarations: async () => declared,
      readPreferences: async () => ({
        userChoices: {},
        detectedHosts: {},
        projectDeclarations: { [PROJECT_PATH]: { approved: {}, declined: declared } },
      }),
    })
    expect(declined).toMatchObject({ kind: 'undecided', attention: null })
  })

  it('asks again when the declaration changed after the decision', async () => {
    const result = await resolve({
      readPrimaryRemote: async () => ({ name: 'origin', url: 'git@code.acme.io:acme/app.git' }),
      readProjectDeclarations: async () => ({ 'code.acme.io': 'github' }),
      readPreferences: async () => ({
        userChoices: {},
        detectedHosts: {},
        projectDeclarations: {
          [PROJECT_PATH]: { approved: { 'code.acme.io': 'gitlab' }, declined: {} },
        },
      }),
    })

    expect(result).toMatchObject({ attention: { kind: 'approve-declaration' } })
  })

  it('keeps an approved host when the project declares another one', async () => {
    const result = await resolve({
      readPrimaryRemote: async () => ({ name: 'origin', url: 'git@code.acme.io:acme/app.git' }),
      readProjectDeclarations: async () => ({
        'code.acme.io': 'gitlab',
        'other.acme.io': 'github',
      }),
      readPreferences: async () => ({
        userChoices: {},
        detectedHosts: {},
        projectDeclarations: {
          [PROJECT_PATH]: { approved: { 'code.acme.io': 'gitlab' }, declined: {} },
        },
      }),
    })

    expect(result).toMatchObject({
      kind: 'resolved',
      hostState: { provider: 'gitlab', source: 'project-declaration' },
    })
  })

  it('lets the user choice beat an approved declaration', async () => {
    const declared = { 'code.acme.io': 'gitlab' } as const
    const result = await resolve({
      readPrimaryRemote: async () => ({ name: 'origin', url: 'git@code.acme.io:acme/app.git' }),
      readProjectDeclarations: async () => declared,
      readPreferences: async () => ({
        userChoices: { 'code.acme.io': 'github' },
        detectedHosts: {},
        projectDeclarations: { [PROJECT_PATH]: { approved: declared, declined: {} } },
      }),
    })

    expect(result).toMatchObject({
      kind: 'resolved',
      hostState: { provider: 'github', source: 'user-choice' },
      attention: null,
    })
  })

  it('applies an approved declaration before it reaches the project root file', async () => {
    const result = await resolve({
      readPrimaryRemote: async () => ({ name: 'origin', url: 'git@code.acme.io:acme/app.git' }),
      readProjectDeclarations: async () => ({}),
      readPreferences: async () => ({
        userChoices: {},
        detectedHosts: {},
        projectDeclarations: {
          [PROJECT_PATH]: { approved: { 'code.acme.io': 'gitlab' }, declined: {} },
        },
      }),
    })

    expect(result).toMatchObject({
      kind: 'resolved',
      hostState: { provider: 'gitlab', source: 'project-declaration' },
    })
  })

  it('asks only about the host nobody decided on', async () => {
    const result = await resolve({
      readPrimaryRemote: async () => ({ name: 'origin', url: 'git@code.acme.io:acme/app.git' }),
      readProjectDeclarations: async () => ({
        'code.acme.io': 'gitlab',
        'old.acme.io': 'github',
        'new.acme.io': 'gitlab',
      }),
      readPreferences: async () => ({
        userChoices: {},
        detectedHosts: {},
        projectDeclarations: {
          [PROJECT_PATH]: { approved: {}, declined: { 'old.acme.io': 'github' } },
        },
      }),
    })

    expect(result).toMatchObject({
      attention: {
        kind: 'approve-declaration',
        hosts: { 'code.acme.io': 'gitlab', 'new.acme.io': 'gitlab' },
      },
    })
  })
})
