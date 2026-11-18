import { WORKSPACE_EDITOR_PERFORMANCE } from '@shared/constants/workspace-editor-performance'
import type { SyntaxHighlightRequest } from './protocol'
import { syntaxHighlightAdmission } from './syntax-admission'
import { syntaxSourceCacheKey } from './syntax-cache'

const UTF16_CODE_UNIT_BYTES = 2

export class SyntaxSourceState {
  private readonly admissions = new Map<string, ReturnType<typeof syntaxHighlightAdmission>>()
  private readonly identities = new Map<
    string,
    { readonly baseKey: string; readonly source: string; readonly codeUnits: number }
  >()
  private identityCodeUnits = 0
  private nextIdentityId = 1

  resolve(input: SyntaxHighlightRequest, languageRevision: string) {
    const sourceKey = this.sourceIdentity(input, languageRevision)
    let admission = this.admissions.get(sourceKey)
    if (admission) {
      this.admissions.delete(sourceKey)
      this.admissions.set(sourceKey, admission)
    } else {
      admission = syntaxHighlightAdmission(input.source)
      this.admissions.set(sourceKey, admission)
      while (this.admissions.size > WORKSPACE_EDITOR_PERFORMANCE.SYNTAX_CACHE_MAX_ENTRIES) {
        const oldest = this.admissions.keys().next()
        if (oldest.done) break
        this.admissions.delete(oldest.value)
      }
    }
    return { sourceKey, admission }
  }

  clear() {
    this.admissions.clear()
    this.identities.clear()
    this.identityCodeUnits = 0
  }

  private sourceIdentity(input: SyntaxHighlightRequest, languageRevision: string) {
    const baseKey = syntaxSourceCacheKey(input, languageRevision)
    for (const [sourceKey, identity] of this.identities) {
      if (identity.baseKey !== baseKey || identity.source !== input.source) continue
      this.identities.delete(sourceKey)
      this.identities.set(sourceKey, identity)
      return sourceKey
    }
    // The fingerprint groups lookups, but exact source equality is required
    // before a worker identity can be reused.
    const sourceKey = `${baseKey}\u0000identity:${String(this.nextIdentityId++)}`
    const identity = { baseKey, source: input.source, codeUnits: input.source.length }
    this.identities.set(sourceKey, identity)
    this.identityCodeUnits += identity.codeUnits
    const maxCodeUnits =
      WORKSPACE_EDITOR_PERFORMANCE.SYNTAX_CACHE_MAX_SOURCE_BYTES / UTF16_CODE_UNIT_BYTES
    while (
      this.identities.size > WORKSPACE_EDITOR_PERFORMANCE.SYNTAX_CACHE_MAX_ENTRIES ||
      this.identityCodeUnits > maxCodeUnits
    ) {
      const oldest = this.identities.entries().next()
      if (oldest.done) break
      this.identities.delete(oldest.value[0])
      this.identityCodeUnits -= oldest.value[1].codeUnits
    }
    return sourceKey
  }
}
