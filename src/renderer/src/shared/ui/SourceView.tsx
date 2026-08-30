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
  const resolvedLanguage = language
    ? resolveSyntaxLanguage(language)
    : path
      ? languageFromPath(path)
      : 'text'
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
  const highlighted = useSourceViewHighlighting({
    source,
    sourceFingerprint: sourceAnalysis.sourceFingerprint,
    language: resolvedLanguage,
    theme: shikiTheme,
    admitted: sourceAnalysis.admission.admitted,
    lineRange,
  })

  return (
    <section
      aria-label={ariaLabel}
      className={cn('group/source-view relative min-h-0 overflow-hidden', className)}
      style={style}
      data-syntax-language={resolvedLanguage}
      data-syntax-status={highlighted?.status ?? 'plain'}
      data-syntax-line-offset={highlighted?.lineOffset ?? 0}
    >
      <Button
        type="button"
        variant="ghost"
        size="xs"
        className="absolute right-2 top-2 z-20 bg-bg/90 opacity-0 shadow-sm transition-opacity focus:opacity-100 group-hover/source-view:opacity-100"
        aria-label="Copy complete source"
        title="Copy complete source"
        onClick={() => void navigator.clipboard.writeText(source)}
      >
        Copy
      </Button>
      <span className="sr-only">
        This source is virtualized for performance. Use Copy complete source to copy every line.
      </span>
      <div
        ref={containerRef}
        data-source-scroller
        className="syntax-typography h-full overflow-auto bg-bg text-text-secondary"
        style={{
          ...(highlighted?.background ? { backgroundColor: highlighted.background } : {}),
          ...(highlighted?.foreground ? { color: highlighted.foreground } : {}),
        }}
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
            targetLine={targetLine}
            lineHeight={codeLineHeight}
            showLineNumbers={showLineNumbers}
            backgroundColor={highlighted?.background}
          />
        </ol>
      </div>
    </section>
  )
}
