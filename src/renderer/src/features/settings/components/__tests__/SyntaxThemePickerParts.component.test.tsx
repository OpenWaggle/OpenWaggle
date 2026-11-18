import type { SyntaxLanguageResource } from '@shared/types/syntax-resources'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { InstalledSyntaxResources } from '../sections/SyntaxThemePickerParts'

const PROJECT_LANGUAGE: SyntaxLanguageResource = {
  id: 'project:typescript',
  packageId: 'project:package',
  revision: 'revision-1',
  label: 'Project TypeScript',
  languageId: 'typescript',
  scope: 'project',
  format: 'openwaggle',
  sourcePath: '/project/.openwaggle/languages/typescript.json',
  engine: 'javascript',
  registration: {
    name: 'typescript',
    displayName: 'Project TypeScript',
    scopeName: 'source.ts',
    aliases: [],
    fileExtensions: ['.ts'],
    fileNames: [],
    embeddedLanguages: {},
    injectTo: [],
    grammar: {},
  },
  original: {},
}

describe('InstalledSyntaxResources', () => {
  it('shows a disabled diagnostic for a colliding project grammar', () => {
    render(
      <InstalledSyntaxResources
        languages={[
          {
            resource: PROJECT_LANGUAGE,
            disabledReason:
              'Disabled because language identity or alias "typescript" conflicts with bundled grammar "TypeScript".',
          },
        ]}
        appearances={[]}
        onRemove={vi.fn()}
      />,
    )

    expect(screen.getByText('Project TypeScript').closest('[aria-disabled="true"]')).not.toBeNull()
    expect(screen.getByText(/conflicts with bundled grammar "TypeScript"/)).toBeVisible()
  })
})
