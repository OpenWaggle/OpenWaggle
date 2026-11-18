/**
 * What the main thread knows about a language Shiki bundles. Grammars themselves load only in the
 * syntax worker (ADR 0027), so the renderer keeps this copy of Shiki's `bundledLanguagesInfo`
 * without its import thunks (bundled-language-metadata.generated.ts).
 */
export interface BundledSyntaxLanguageMetadata {
  readonly id: string
  readonly name: string
  readonly aliases?: readonly string[]
}
