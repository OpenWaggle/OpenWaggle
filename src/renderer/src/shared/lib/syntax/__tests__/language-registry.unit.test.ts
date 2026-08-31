import type { SyntaxLanguageResource } from '@shared/types/syntax-resources'
import { describe, expect, it } from 'vitest'
import {
  activatableSyntaxLanguageResources,
  syntaxLanguageResourceActivations,
} from '../language-registry'

function languageResource({
  id,
  scope,
  languageId = id,
  aliases = [],
  fileExtensions = [],
  fileNames = [],
}: {
  readonly id: string
  readonly scope: SyntaxLanguageResource['scope']
  readonly languageId?: string
  readonly aliases?: readonly string[]
  readonly fileExtensions?: readonly string[]
  readonly fileNames?: readonly string[]
}): SyntaxLanguageResource {
  return {
    id,
    packageId: `package:${id}`,
    revision: 'revision-1',
    label: id,
    languageId,
    scope,
    format: 'openwaggle',
    sourcePath: `/.openwaggle/languages/${id}.json`,
    engine: 'javascript',
    registration: {
      name: languageId,
      displayName: id,
      scopeName: `source.${languageId}`,
      aliases,
      fileExtensions,
      fileNames,
      embeddedLanguages: {},
      injectTo: [],
      grammar: {},
    },
    original: {},
  }
}

describe('syntax language resource activation', () => {
  it('keeps project collisions visible with diagnostics while excluding them from activation', () => {
    const user = languageResource({
      id: 'User Acme',
      scope: 'user',
      aliases: ['acme-alias'],
      fileExtensions: ['.acme'],
      fileNames: ['Acmefile'],
    })
    const bundledIdentityCollision = languageResource({
      id: 'Bundled identity collision',
      scope: 'project',
      languageId: 'typescript',
    })
    const userAliasCollision = languageResource({
      id: 'User alias collision',
      scope: 'project',
      aliases: ['ACME-ALIAS'],
    })
    const userExtensionCollision = languageResource({
      id: 'User extension collision',
      scope: 'project',
      fileExtensions: ['.ACME'],
    })
    const userFileNameCollision = languageResource({
      id: 'User filename collision',
      scope: 'project',
      fileNames: ['acmefile'],
    })
    const projectLanguage = languageResource({ id: 'Project language', scope: 'project' })
    const resources = [
      bundledIdentityCollision,
      userAliasCollision,
      userExtensionCollision,
      userFileNameCollision,
      projectLanguage,
      user,
    ]

    const activations = syntaxLanguageResourceActivations(resources)

    expect(activations).toHaveLength(resources.length)
    expect(
      activations.find(({ resource }) => resource === bundledIdentityCollision)?.disabledReason,
    ).toContain('conflicts with bundled grammar "TypeScript"')
    expect(
      activations.find(({ resource }) => resource === userAliasCollision)?.disabledReason,
    ).toBe(
      'Disabled because language identity or alias "acme-alias" conflicts with user grammar "User Acme".',
    )
    expect(
      activations.find(({ resource }) => resource === userExtensionCollision)?.disabledReason,
    ).toBe('Disabled because file extension ".acme" conflicts with user grammar "User Acme".')
    expect(
      activations.find(({ resource }) => resource === userFileNameCollision)?.disabledReason,
    ).toBe('Disabled because filename "acmefile" conflicts with user grammar "User Acme".')
    expect(
      activations.find(({ resource }) => resource === projectLanguage)?.disabledReason,
    ).toBeNull()
    expect(activatableSyntaxLanguageResources(resources)).toEqual([user, projectLanguage])
  })
})
