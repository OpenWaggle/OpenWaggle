import type { SyntaxLanguageResource } from '@shared/types/syntax-resources'
import { createRendererLogger } from '@/shared/lib/logger'

const IMPORTED_LANGUAGE_FAILURE_LIMIT = 3
const logger = createRendererLogger('syntax-service')

export class SyntaxLanguageQuarantine {
  private readonly resources = new Map<string, SyntaxLanguageResource>()
  private readonly failures = new Map<string, number>()
  private readonly quarantined = new Set<string>()

  register(languages: readonly SyntaxLanguageResource[]) {
    this.resources.clear()
    this.failures.clear()
    this.quarantined.clear()
    for (const language of languages) {
      for (const identity of [language.languageId, ...language.registration.aliases]) {
        this.resources.set(identity.toLowerCase(), language)
      }
    }
  }

  isQuarantined(language: string) {
    const key = this.failureKey(language)
    return key !== null && this.quarantined.has(key)
  }

  recordFailure(language: string) {
    const key = this.failureKey(language)
    if (!key) return
    const failures = (this.failures.get(key) ?? 0) + 1
    this.failures.set(key, failures)
    if (failures < IMPORTED_LANGUAGE_FAILURE_LIMIT) return
    this.quarantined.add(key)
    logger.warn('Imported syntax grammar quarantined', { language, failures })
  }

  recordSuccess(language: string) {
    const key = this.failureKey(language)
    if (!key || this.quarantined.has(key)) return
    this.failures.delete(key)
  }

  private failureKey(language: string) {
    const resource = this.resources.get(language.toLowerCase())
    return resource ? `${resource.id}\u0000${resource.revision}` : null
  }
}
