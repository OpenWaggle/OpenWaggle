import { bundledLanguagesInfo } from 'shiki'
import { describe, expect, it } from 'vitest'
import { BUNDLED_SYNTAX_LANGUAGES } from '../bundled-language-metadata.generated'
import { resolveSyntaxLanguage, syntaxLanguageCatalog } from '../language-registry'

describe('BUNDLED_SYNTAX_LANGUAGES', () => {
  it("matches the installed Shiki's bundled languages (run pnpm syntax-languages:generate)", () => {
    expect(BUNDLED_SYNTAX_LANGUAGES).toEqual(
      bundledLanguagesInfo.map(({ id, name, aliases }) =>
        aliases && aliases.length > 0 ? { id, name, aliases } : { id, name },
      ),
    )
  })

  it('keeps every bundled language and alias resolvable without loading a grammar', () => {
    const catalogIds = new Set(syntaxLanguageCatalog().map((language) => language.id))
    for (const language of bundledLanguagesInfo) {
      expect(catalogIds.has(language.id)).toBe(true)
      expect(resolveSyntaxLanguage(language.id)).toBe(language.id)
      for (const alias of language.aliases ?? []) {
        expect(resolveSyntaxLanguage(alias)).toBe(language.id)
      }
    }
  })
})
