import { shouldVirtualizeSyntaxSource } from '@shared/syntax-highlighting-performance'
import { useEffect, useMemo, useState } from 'react'
import { useSyntaxTheme } from '@/shared/hooks/useSyntaxTheme'
import { cn } from '@/shared/lib/cn'
import { languageFromPath, resolveSyntaxLanguage } from '@/shared/lib/syntax/language-registry'
import type { SyntaxHighlightResult, SyntaxPriority } from '@/shared/lib/syntax/protocol'
import { syntaxService } from '@/shared/lib/syntax/syntax-service'
import { syntaxTokenStyle } from '@/shared/lib/syntax/token-style'
import { SourceView } from './SourceView'

export interface SyntaxBlockProps {
  readonly source: string
  readonly language?: string
  readonly path?: string
  readonly className?: string
  readonly wrap?: boolean
  readonly showLineNumbers?: boolean
  readonly ariaLabel?: string
  readonly theme?: string
  readonly priority?: SyntaxPriority
}

function LineNumber({ value }: { readonly value: number }) {
  return (
    <span
      aria-hidden="true"
      className="mr-4 inline-block w-8 select-none text-right text-text-muted"
    >
      {value}
    </span>
  )
}

function PlainSyntaxContent({
  source,
  showLineNumbers,
}: Pick<SyntaxBlockProps, 'source' | 'showLineNumbers'>) {
  if (!showLineNumbers) return source
  const lines = source.split('\n')
  return lines.map((line, lineIndex) => (
    <span key={String(lineIndex)}>
      <LineNumber value={lineIndex + 1} />
      {line}
      {lineIndex < lines.length - 1 ? '\n' : null}
    </span>
  ))
}

function HighlightedSyntaxContent({
  result,
  showLineNumbers,
}: {
  readonly result: SyntaxHighlightResult
  readonly showLineNumbers: boolean
}) {
  return result.lines.map((line, lineIndex) => (
    <span key={String(lineIndex)}>
      {showLineNumbers ? <LineNumber value={lineIndex + 1} /> : null}
      {line.map((token, tokenIndex) => (
        <span key={String(tokenIndex)} style={syntaxTokenStyle(token)}>
          {token.content}
        </span>
      ))}
      {lineIndex < result.lines.length - 1 ? '\n' : null}
    </span>
  ))
}

function syntaxBlockLanguage(language?: string, path?: string) {
  if (language) return resolveSyntaxLanguage(language)
  if (path) return languageFromPath(path)
  return 'text'
}

function syntaxLanguageClassName(language: string | undefined, resolvedLanguage: string) {
  const declaredLanguage = language?.trim().toLowerCase()
  if (declaredLanguage && declaredLanguage !== resolvedLanguage) {
    return `language-${declaredLanguage} language-${resolvedLanguage}`
  }
  return `language-${resolvedLanguage}`
}

function useSyntaxHighlightResult({
  source,
  language,
  theme,
  priority,
}: {
  readonly source: string
  readonly language: string
  readonly theme: string
  readonly priority: SyntaxPriority
}) {
  const [result, setResult] = useState<{
    readonly source: string
    readonly language: string
    readonly result: SyntaxHighlightResult
  } | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    if (language === 'text') return () => controller.abort()
    void syntaxService
      .highlight({
        source,
        language,
        theme,
        priority,
        signal: controller.signal,
      })
      .then((next) => {
        if (!controller.signal.aborted) setResult({ source, language, result: next })
      })
    return () => controller.abort()
  }, [language, priority, source, theme])

  return result?.source === source && result.language === language ? result.result : null
}

function syntaxBlockPresentation(result: SyntaxHighlightResult | null, fallbackLanguage: string) {
  if (!result) {
    return {
      language: fallbackLanguage,
      status: 'plain-text',
      diagnostic: undefined,
      style: undefined,
    }
  }
  return {
    language: result.language,
    status: result.status,
    diagnostic: result.diagnostic,
    style: {
      ...(result.background ? { backgroundColor: result.background } : {}),
      ...(result.foreground ? { color: result.foreground } : {}),
    },
  }
}

function SyntaxContent({
  result,
  source,
  showLineNumbers,
}: {
  readonly result: SyntaxHighlightResult | null
  readonly source: string
  readonly showLineNumbers: boolean
}) {
  if (result?.status === 'highlighted') {
    return <HighlightedSyntaxContent result={result} showLineNumbers={showLineNumbers} />
  }
  return <PlainSyntaxContent source={source} showLineNumbers={showLineNumbers} />
}

export function SyntaxBlock({
  source,
  language,
  path,
  className,
  wrap = false,
  showLineNumbers = false,
  ariaLabel,
  theme,
  priority = 'visible',
}: SyntaxBlockProps) {
  const virtualized = useMemo(() => shouldVirtualizeSyntaxSource(source), [source])
  if (virtualized) {
    return (
      <SourceView
        source={source}
        language={language}
        path={path}
        className={cn('syntax-typography', className)}
        ariaLabel={ariaLabel}
        theme={theme}
        showLineNumbers={showLineNumbers}
        style={{ height: 'min(60vh, 32rem)' }}
      />
    )
  }
  const compactProps: SyntaxBlockProps = {
    source,
    ...(language ? { language } : {}),
    ...(path ? { path } : {}),
    ...(className ? { className } : {}),
    wrap,
    showLineNumbers,
    ...(ariaLabel ? { ariaLabel } : {}),
    ...(theme ? { theme } : {}),
    priority,
  }
  return <CompactSyntaxBlock {...compactProps} />
}

function CompactSyntaxBlock({
  source,
  language,
  path,
  className,
  wrap = false,
  showLineNumbers = false,
  ariaLabel,
  theme,
  priority = 'visible',
}: SyntaxBlockProps) {
  const { shikiTheme } = useSyntaxTheme()
  const resolvedTheme = theme ?? shikiTheme
  const resolvedLanguage = syntaxBlockLanguage(language, path)
  const languageClassName = syntaxLanguageClassName(language, resolvedLanguage)
  const result = useSyntaxHighlightResult({
    source,
    language: resolvedLanguage,
    theme: resolvedTheme,
    priority,
  })
  const presentation = syntaxBlockPresentation(result, resolvedLanguage)

  return (
    <section aria-label={ariaLabel}>
      <pre
        data-syntax-language={presentation.language}
        data-syntax-status={presentation.status}
        title={presentation.diagnostic}
        style={presentation.style}
        className={cn(
          'syntax-typography m-0 overflow-auto bg-bg-secondary/70 p-3 text-text-secondary',
          wrap ? 'whitespace-pre-wrap break-words' : 'whitespace-pre',
          className,
        )}
      >
        <code className={languageClassName}>
          <SyntaxContent result={result} source={source} showLineNumbers={showLineNumbers} />
        </code>
      </pre>
    </section>
  )
}
