import type { CSSProperties, Ref, TextareaHTMLAttributes, UIEvent } from 'react'
import { useEffect, useRef, useState } from 'react'
import type { Highlighter, ThemedToken } from 'shiki'
import { cn } from '@/shared/lib/cn'
import { createRendererLogger } from '@/shared/lib/logger'
import { DEFAULT_THEME, getHighlighter, resolveLanguage } from '@/shared/lib/shiki/highlighter'

type TextareaVariant = 'default' | 'mono'
type TextareaResize = 'none' | 'vertical' | 'both'

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  readonly ref?: Ref<HTMLTextAreaElement>
  readonly variant?: TextareaVariant
  readonly resize?: TextareaResize
  readonly highlightLanguage?: string
}

interface HighlightedLine {
  readonly id: string
  readonly tokens: readonly ThemedToken[]
}

const TEXTAREA_BASE_CLASS =
  'w-full rounded-lg border border-input-card-border bg-bg px-3 py-2 text-text-secondary outline-none transition-colors placeholder:text-text-muted focus:border-border-light'

const TEXTAREA_VARIANT_CLASS: Record<TextareaVariant, string> = {
  default: 'text-[13px]',
  mono: 'font-mono text-[12px] leading-5',
}

const TEXTAREA_LINE_CLASS: Record<TextareaVariant, string> = {
  default: 'min-h-[1.45em]',
  mono: 'min-h-5',
}

const TEXTAREA_RESIZE_CLASS: Record<TextareaResize, string> = {
  none: 'resize-none',
  vertical: 'resize-y',
  both: 'resize',
}

const logger = createRendererLogger('textarea')

function assignRef<T>(ref: Ref<T> | undefined, value: T | null) {
  if (!ref) return
  if (typeof ref === 'function') {
    ref(value)
    return
  }
  ref.current = value
}

function getTextareaValue(value: TextareaHTMLAttributes<HTMLTextAreaElement>['value']) {
  if (Array.isArray(value)) {
    return value.join('\n')
  }
  if (value === undefined || value === null) {
    return ''
  }
  return String(value)
}

function getTokenStyle(token: ThemedToken): CSSProperties | undefined {
  if (!token.color && !token.bgColor) {
    return undefined
  }
  return {
    ...(token.color ? { color: token.color } : {}),
    ...(token.bgColor ? { backgroundColor: token.bgColor } : {}),
  }
}

function syncOverlayScroll(textarea: HTMLTextAreaElement | null, overlay: HTMLPreElement | null) {
  if (!textarea || !overlay) return
  overlay.scrollTop = textarea.scrollTop
  overlay.scrollLeft = textarea.scrollLeft
}

function getHighlightedLines(tokensByLine: readonly (readonly ThemedToken[])[]) {
  let nextFallbackOffset = 0
  return tokensByLine.map((tokens) => {
    const firstToken = tokens[0]
    const lastToken = tokens.at(-1)
    const idOffset = firstToken?.offset ?? nextFallbackOffset

    if (lastToken) {
      nextFallbackOffset = lastToken.offset + lastToken.content.length + 1
    } else {
      nextFallbackOffset += 1
    }

    return {
      id: `line-${idOffset}`,
      tokens,
    }
  })
}

export function Textarea({
  ref,
  variant = 'default',
  resize = 'vertical',
  highlightLanguage,
  className,
  value,
  onScroll,
  ...props
}: TextareaProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const overlayRef = useRef<HTMLPreElement | null>(null)
  const [highlighter, setHighlighter] = useState<Highlighter | null>(null)
  const textValue = getTextareaValue(value)
  const resolvedLanguage = highlightLanguage ? resolveLanguage(highlightLanguage) : undefined

  useEffect(() => {
    if (!highlightLanguage) return
    let active = true
    getHighlighter()
      .then((loadedHighlighter) => {
        if (active) {
          setHighlighter(loadedHighlighter)
        }
      })
      .catch((loadError) => {
        if (!active) {
          return
        }
        logger.warn('Failed to load syntax highlighter', {
          language: highlightLanguage,
          error: loadError instanceof Error ? loadError.message : String(loadError),
        })
      })
    return () => {
      active = false
    }
  }, [highlightLanguage])

  let highlightedLines: readonly HighlightedLine[] | null = null
  if (highlighter && resolvedLanguage && textValue.length > 0) {
    try {
      highlightedLines = getHighlightedLines(
        highlighter.codeToTokensBase(textValue, {
          lang: resolvedLanguage,
          theme: DEFAULT_THEME,
        }),
      )
    } catch (highlightError) {
      logger.warn('Failed to render syntax highlight overlay', {
        language: resolvedLanguage,
        error: highlightError instanceof Error ? highlightError.message : String(highlightError),
      })
    }
  }

  useEffect(() => {
    syncOverlayScroll(textareaRef.current, overlayRef.current)
  })

  function handleRef(node: HTMLTextAreaElement | null) {
    textareaRef.current = node
    assignRef(ref, node)
  }

  function handleScroll(event: UIEvent<HTMLTextAreaElement>) {
    syncOverlayScroll(event.currentTarget, overlayRef.current)
    onScroll?.(event)
  }

  const textarea = (
    <textarea
      ref={handleRef}
      value={value}
      onScroll={handleScroll}
      className={cn(
        TEXTAREA_BASE_CLASS,
        TEXTAREA_VARIANT_CLASS[variant],
        TEXTAREA_RESIZE_CLASS[resize],
        highlightedLines && 'relative z-10 !bg-transparent !text-transparent caret-text-primary',
        className,
      )}
      {...props}
    />
  )

  if (!highlightLanguage) {
    return textarea
  }

  return (
    <div className="relative">
      {highlightedLines && (
        <pre
          ref={overlayRef}
          aria-hidden="true"
          className={cn(
            'pointer-events-none absolute inset-0 z-0 m-0 overflow-hidden rounded-lg border border-transparent px-3 py-2 text-text-secondary',
            TEXTAREA_VARIANT_CLASS[variant],
          )}
        >
          <code className={cn('block', TEXTAREA_VARIANT_CLASS[variant])}>
            {highlightedLines.map((line) => (
              <span
                key={line.id}
                className={cn('block whitespace-pre', TEXTAREA_LINE_CLASS[variant])}
              >
                {line.tokens.map((token) => (
                  <span key={token.offset} style={getTokenStyle(token)}>
                    {token.content}
                  </span>
                ))}
              </span>
            ))}
          </code>
        </pre>
      )}
      {textarea}
    </div>
  )
}
