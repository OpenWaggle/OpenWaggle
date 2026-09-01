/// <reference lib="webworker" />

import { WORKSPACE_EDITOR_PERFORMANCE } from '@shared/constants/workspace-editor-performance'
import type {
  SyntaxGrammarEngine,
  SyntaxLanguageResource,
  SyntaxThemeRegistration,
} from '@shared/types/syntax-resources'
import type { BundledLanguage, BundledTheme, HighlighterCore } from 'shiki'
import {
  bundledLanguages,
  bundledLanguagesInfo,
  bundledThemes,
  createHighlighterCore,
  createJavaScriptRegexEngine,
  createOnigurumaEngine,
} from 'shiki'
import type {
  SyntaxHighlightResult,
  SyntaxWorkerHighlightMessage,
  SyntaxWorkerResponse,
} from './protocol'
import { isSyntaxWorkerRequest } from './protocol'
import { importedLanguageRegistration, loadImportedTheme } from './syntax-worker-registrations'
import { syntaxTokens } from './syntax-worker-tokens'

let javascriptHighlighterPromise: Promise<HighlighterCore> | undefined
let onigurumaHighlighterPromise: Promise<HighlighterCore> | undefined
const importedThemes = new Map<string, SyntaxThemeRegistration>()
const importedLanguages = new Map<string, SyntaxLanguageResource>()
let resourceRegistrationPromise = Promise.resolve()

interface WorkerTokenCacheEntry {
  readonly sourceBytes: number
  readonly estimatedBytes: number
  readonly language: string
  readonly theme: string
  readonly foreground?: string
  readonly background?: string
  readonly tokens: ReturnType<HighlighterCore['codeToTokens']>['tokens']
  readonly elapsedMs: number
}

const tokenCache = new Map<string, WorkerTokenCacheEntry>()
let tokenCacheSourceBytes = 0
const ESTIMATED_TOKEN_LINE_BYTES = 24
const ESTIMATED_TOKEN_BASE_BYTES = 48
const UTF16_CODE_UNIT_BYTES = 2
const VALIDATION_SAMPLE_REPEAT_COUNT = 32

function estimatedTokenBytes(tokens: WorkerTokenCacheEntry['tokens']) {
  let bytes = 0
  for (const line of tokens) {
    bytes += ESTIMATED_TOKEN_LINE_BYTES
    for (const token of line) {
      bytes += ESTIMATED_TOKEN_BASE_BYTES + token.content.length * UTF16_CODE_UNIT_BYTES
    }
  }
  return bytes
}

function cachedTokens(sourceKey: string) {
  const cached = tokenCache.get(sourceKey)
  if (!cached) return null
  tokenCache.delete(sourceKey)
  tokenCache.set(sourceKey, cached)
  return cached
}

function cacheTokens(sourceKey: string, entry: WorkerTokenCacheEntry) {
  const existing = tokenCache.get(sourceKey)
  if (existing) {
    tokenCacheSourceBytes -= existing.estimatedBytes
    tokenCache.delete(sourceKey)
  }
  tokenCache.set(sourceKey, entry)
  tokenCacheSourceBytes += entry.estimatedBytes
  while (
    tokenCache.size > WORKSPACE_EDITOR_PERFORMANCE.SYNTAX_WORKER_TOKEN_CACHE_MAX_ENTRIES ||
    tokenCacheSourceBytes >
      WORKSPACE_EDITOR_PERFORMANCE.SYNTAX_WORKER_TOKEN_CACHE_MAX_ESTIMATED_BYTES
  ) {
    const oldest = tokenCache.entries().next()
    if (oldest.done) break
    tokenCache.delete(oldest.value[0])
    tokenCacheSourceBytes -= oldest.value[1].estimatedBytes
  }
}

function clearTokenCache() {
  tokenCache.clear()
  tokenCacheSourceBytes = 0
}

function highlighter(engine: SyntaxGrammarEngine) {
  if (engine === 'javascript') {
    javascriptHighlighterPromise ??= createHighlighterCore({
      langs: [],
      themes: [],
      engine: createJavaScriptRegexEngine(),
    })
    return javascriptHighlighterPromise
  }
  onigurumaHighlighterPromise ??= createOnigurumaEngine(import('shiki/wasm')).then((regexEngine) =>
    createHighlighterCore({ langs: [], themes: [], engine: regexEngine }),
  )
  return onigurumaHighlighterPromise
}

function isBundledLanguage(value: string): value is BundledLanguage {
  return Object.hasOwn(bundledLanguages, value)
}

function resolveBundledLanguage(value: string) {
  const normalized = value.toLowerCase()
  const resolved = bundledLanguagesInfo.find(
    (language) =>
      language.id === normalized || language.aliases?.some((alias) => alias === normalized),
  )?.id
  return resolved && isBundledLanguage(resolved) ? resolved : null
}

function isBundledTheme(value: string): value is BundledTheme {
  return Object.hasOwn(bundledThemes, value)
}

async function ensureBundledLanguage(instance: HighlighterCore, language: BundledLanguage) {
  if (instance.getLoadedLanguages().includes(language)) return
  await instance.loadLanguage(await bundledLanguages[language]())
}

async function ensureImportedLanguage(instance: HighlighterCore, resource: SyntaxLanguageResource) {
  if (instance.getLoadedLanguages().includes(resource.languageId)) return
  await instance.loadLanguage(importedLanguageRegistration(resource))
}

async function ensureBundledTheme(instance: HighlighterCore, theme: BundledTheme) {
  if (instance.getLoadedThemes().includes(theme)) return
  await instance.loadTheme(await bundledThemes[theme]())
}

async function ensureTheme(instance: HighlighterCore, theme: string) {
  await resourceRegistrationPromise
  if (isBundledTheme(theme)) {
    await ensureBundledTheme(instance, theme)
    return
  }
  const imported = importedThemes.get(theme)
  if (!imported) throw new Error(`Unknown syntax theme: ${theme}`)
  await loadImportedTheme(instance, imported)
}

async function resolveHighlighter(language: string, theme: string) {
  await resourceRegistrationPromise
  const imported = importedLanguages.get(language.toLowerCase())
  const bundled = imported ? null : resolveBundledLanguage(language)
  const resolvedLanguage = imported?.languageId ?? bundled
  if (!resolvedLanguage) throw new Error(`Unknown syntax language: ${language}`)
  const instance = await highlighter(imported?.engine ?? 'javascript')
  const languageLoad = imported
    ? ensureImportedLanguage(instance, imported)
    : bundled
      ? ensureBundledLanguage(instance, bundled)
      : Promise.reject(new Error(`Unknown syntax language: ${language}`))
  await Promise.all([languageLoad, ensureTheme(instance, theme)])
  return { instance, resolvedLanguage }
}

async function highlight(
  message: SyntaxWorkerHighlightMessage,
): Promise<SyntaxHighlightResult | null> {
  let highlighted = cachedTokens(message.sourceKey)
  if (!highlighted) {
    if (message.source === undefined) return null
    const startedAt = performance.now()
    const { instance, resolvedLanguage } = await resolveHighlighter(message.language, message.theme)
    const result = instance.codeToTokens(message.source, {
      lang: resolvedLanguage,
      theme: message.theme,
    })
    const sourceBytes = new TextEncoder().encode(message.source).byteLength
    highlighted = {
      sourceBytes,
      language: message.language,
      theme: message.theme,
      ...(result.fg ? { foreground: result.fg } : {}),
      ...(result.bg ? { background: result.bg } : {}),
      tokens: result.tokens,
      estimatedBytes: sourceBytes + estimatedTokenBytes(result.tokens),
      elapsedMs: performance.now() - startedAt,
    }
    cacheTokens(message.sourceKey, highlighted)
  }
  const start = Math.max(0, Math.min(message.lineRange?.start ?? 0, highlighted.tokens.length))
  const end = Math.max(
    start,
    Math.min(message.lineRange?.end ?? highlighted.tokens.length, highlighted.tokens.length),
  )

  return {
    status: 'highlighted',
    language: highlighted.language,
    theme: highlighted.theme,
    ...(highlighted.foreground ? { foreground: highlighted.foreground } : {}),
    ...(highlighted.background ? { background: highlighted.background } : {}),
    lines: syntaxTokens(highlighted.tokens.slice(start, end)),
    ...(start > 0 ? { lineOffset: start } : {}),
    elapsedMs: highlighted.elapsedMs,
  }
}

async function validateLanguage(resource: SyntaxLanguageResource) {
  const instance = await highlighter(resource.engine)
  await Promise.all([
    ensureImportedLanguage(instance, resource),
    ensureBundledTheme(instance, 'dark-plus'),
  ])
  instance.codeToTokens(
    'const value = "openwaggle"\n# comment\n'.repeat(VALIDATION_SAMPLE_REPEAT_COUNT),
    {
      lang: resource.languageId,
      theme: 'dark-plus',
    },
  )
  return resource.languageId
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

self.addEventListener('message', (event: MessageEvent<unknown>) => {
  if (!isSyntaxWorkerRequest(event.data)) return
  const request = event.data
  if (request.type === 'register-themes') {
    resourceRegistrationPromise = resourceRegistrationPromise.then(async () => {
      importedThemes.clear()
      clearTokenCache()
      for (const theme of request.themes) {
        importedThemes.set(theme.name, theme)
      }
      const javascript = javascriptHighlighterPromise
      const oniguruma = onigurumaHighlighterPromise
      javascriptHighlighterPromise = undefined
      onigurumaHighlighterPromise = undefined
      if (javascript) (await javascript).dispose()
      if (oniguruma) (await oniguruma).dispose()
    })
    return
  }
  if (request.type === 'register-languages') {
    resourceRegistrationPromise = resourceRegistrationPromise.then(async () => {
      importedLanguages.clear()
      clearTokenCache()
      for (const language of request.languages) {
        for (const identity of [language.languageId, ...language.registration.aliases]) {
          importedLanguages.set(identity.toLowerCase(), language)
        }
      }
      const javascript = javascriptHighlighterPromise
      const oniguruma = onigurumaHighlighterPromise
      javascriptHighlighterPromise = undefined
      onigurumaHighlighterPromise = undefined
      if (javascript) (await javascript).dispose()
      if (oniguruma) (await oniguruma).dispose()
    })
    return
  }
  if (request.type === 'validate-language') {
    void validateLanguage(request.language).then(
      (languageId) => {
        const response: SyntaxWorkerResponse = {
          type: 'language-validated',
          requestId: request.requestId,
          languageId,
        }
        self.postMessage(response)
      },
      (error: unknown) => {
        const response: SyntaxWorkerResponse = {
          type: 'failed',
          requestId: request.requestId,
          message: errorMessage(error),
        }
        self.postMessage(response)
      },
    )
    return
  }
  void highlight(request).then(
    (result) => {
      if (result === null) {
        const response: SyntaxWorkerResponse = {
          type: 'source-required',
          requestId: request.requestId,
        }
        self.postMessage(response)
        return
      }
      const response: SyntaxWorkerResponse = {
        type: 'highlighted',
        requestId: request.requestId,
        result,
        retainedSourceKeys: [...tokenCache.keys()],
      }
      self.postMessage(response)
    },
    (error: unknown) => {
      const response: SyntaxWorkerResponse = {
        type: 'failed',
        requestId: request.requestId,
        message: errorMessage(error),
      }
      self.postMessage(response)
    },
  )
})
