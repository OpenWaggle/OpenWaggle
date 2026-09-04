import { analyzeSourceForView } from '@shared/syntax-highlighting-performance'
import { type CSSProperties, useMemo } from 'react'
import { useSyntaxTheme } from '@/shared/hooks/useSyntaxTheme'
import { useAppearancePreferencesRuntimeStore } from '@/shared/lib/appearance-preferences-runtime'
import { cn } from '@/shared/lib/cn'
import { languageFromPath, resolveSyntaxLanguage } from '@/shared/lib/syntax/language-registry'
import { Button } from './Button'
import { SourceViewRows } from './SourceViewRows'
import { useSourceViewHighlighting } from './source-view-highlighting'
import { useSourceViewViewport } from './useSourceViewViewport'

function resolvedSourceLanguage(language: string | undefined, path: string | undefined) {
  if (language) return resolveSyntaxLanguage(language)
  if (path) return languageFromPath(path)
  return 'text'
}

function sourceViewSyntaxStatus(
  loading: boolean,
  highlighted: ReturnType<typeof useSourceViewHighlighting>['result'],
) {
  if (loading) return 'loading'
  return highlighted?.status ?? 'plain'
}

function highlightedSourceStyle(
  highlighted: ReturnType<typeof useSourceViewHighlighting>['result'],
) {
  return {
    ...(highlighted?.background ? { backgroundColor: highlighted.background } : {}),
    ...(highlighted?.foreground ? { color: highlighted.foreground } : {}),
  }
}

function SourceViewChrome({
  source,
  loading,
}: {
  readonly source: string
  readonly loading: boolean
}) {
  return (
    <>
      <span className="sr-only" aria-live="polite">
        {loading ? 'Highlighting source…' : ''}
      </span>
      {loading ? (
        <span
          aria-hidden="true"
          className="absolute right-2 top-2 z-20 rounded-sm bg-bg/90 px-2 py-1 text-xs text-text-muted shadow-sm"
        >
          Highlighting source…
        </span>
      ) : null}
      <Button
        type="button"
        variant="ghost"
        size="xs"
        className={cn(
          'absolute right-2 top-2 z-20 bg-bg/90 opacity-0 shadow-sm transition-opacity focus:opacity-100 group-hover/source-view:opacity-100',
          loading && 'invisible pointer-events-none',
        )}
        aria-label="Copy complete source"
        title="Copy complete source"
        onClick={() => void navigator.clipboard.writeText(source)}
      >
        Copy
      </Button>
      <span className="sr-only">
        This source is virtualized for performance. Use Copy complete source to copy every line.
      </span>
    </>
  )
}

export function SourceView({
  source,
  language,
  path,
  className,
  ariaLabel,
  targetLine,
  theme,
  showLineNumbers = true,
  style,
}: {
  readonly source: string
  readonly language?: string
  readonly path?: string
  readonly className?: string
  readonly ariaLabel?: string
  readonly targetLine?: number | null
  readonly theme?: string
  readonly showLineNumbers?: boolean
  readonly style?: CSSProperties
}) {
  const { shikiTheme: activeTheme } = useSyntaxTheme()
  const shikiTheme = theme ?? activeTheme
  const codeLineHeight = useAppearancePreferencesRuntimeStore(
    (state) => state.preferences.typography.codeLineHeight,
  )
  const resolvedLanguage = resolvedSourceLanguage(language, path)
  const sourceAnalysis = useMemo(() => analyzeSourceForView(source), [source])
  const { containerRef, range, updateScroll } = useSourceViewViewport({
    lineCount: sourceAnalysis.lineStarts.length,
    lineHeight: codeLineHeight,
    targetLine,
  })
  const lineRange = useMemo(
    () => ({ start: range.start, end: range.end }),
    [range.end, range.start],
  )
  const highlighting = useSourceViewHighlighting({
    source,
    sourceFingerprint: sourceAnalysis.sourceFingerprint,
    language: resolvedLanguage,
    theme: shikiTheme,
    admitted: sourceAnalysis.admission.admitted,
    lineRange,
  })
  const highlighted = highlighting.result
  const showLoading = highlighting.loading

  return (
    <section
      aria-label={ariaLabel}
      className={cn('group/source-view relative min-h-0 overflow-hidden', className)}
      style={style}
      data-syntax-language={resolvedLanguage}
      data-syntax-theme={shikiTheme}
      data-syntax-status={sourceViewSyntaxStatus(showLoading, highlighted)}
      data-syntax-line-offset={highlighted?.lineOffset ?? 0}
    >
      <SourceViewChrome source={source} loading={showLoading} />
      <div
        ref={containerRef}
        data-source-scroller
        className="syntax-typography h-full overflow-auto bg-bg text-text-secondary"
        style={highlightedSourceStyle(highlighted)}
        onScroll={updateScroll}
      >
        <ol
          aria-label="Source lines"
          className="relative m-0 min-w-max list-none p-0"
          style={{ height: sourceAnalysis.lineStarts.length * codeLineHeight, minWidth: '100%' }}
        >
          <SourceViewRows
            source={source}
            lineStarts={sourceAnalysis.lineStarts}
            range={range}
            highlighted={highlighted}
            loading={showLoading}
            targetLine={targetLine}
            lineHeight={codeLineHeight}
            showLineNumbers={showLineNumbers}
          />
        </ol>
      </div>
    </section>
  )
}
