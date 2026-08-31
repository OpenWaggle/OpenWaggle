import {
  createPlainExtensionSyntaxResult,
  OPENWAGGLE_EXTENSION_UI_ATTRIBUTES,
  OPENWAGGLE_EXTENSION_UI_CLASS_NAMES,
  type OpenWaggleExtensionSyntaxSdk,
  type OpenWaggleExtensionUiButtonVariant,
  type OpenWaggleExtensionUiTone,
  openWaggleExtensionClassName,
} from '@openwaggle/extension-sdk'
import type {
  ButtonHTMLAttributes,
  CSSProperties,
  HTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  Ref,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react'
import { useEffect, useMemo, useState } from 'react'

const SYNTAX_FONT_STYLE_ITALIC = 1
const SYNTAX_FONT_STYLE_BOLD = 2
const SYNTAX_FONT_STYLE_UNDERLINE = 4

function syntaxTokenStyle(token: {
  readonly content: string
  readonly color?: string
  readonly backgroundColor?: string
  readonly fontStyle?: number
}) {
  const fontStyle = token.fontStyle ?? 0
  return {
    ...(token.color ? { color: token.color } : {}),
    ...(token.backgroundColor ? { backgroundColor: token.backgroundColor } : {}),
    ...(fontStyle & SYNTAX_FONT_STYLE_ITALIC ? { fontStyle: 'italic' as const } : {}),
    ...(fontStyle & SYNTAX_FONT_STYLE_BOLD ? { fontWeight: 600 } : {}),
    ...(fontStyle & SYNTAX_FONT_STYLE_UNDERLINE ? { textDecoration: 'underline' } : {}),
  }
}

export interface SyntaxBlockProps {
  readonly syntax: OpenWaggleExtensionSyntaxSdk
  readonly source: string
  readonly language?: string
  readonly path?: string
  readonly className?: string
  readonly wrap?: boolean
  readonly showLineNumbers?: boolean
  readonly ariaLabel?: string
}

function useExtensionSyntaxResult({
  syntax,
  source,
  language,
  path,
  enabled = true,
}: Pick<SyntaxBlockProps, 'syntax' | 'source' | 'language' | 'path'> & {
  readonly enabled?: boolean
}) {
  const [result, setResult] = useState(() =>
    enabled ? createPlainExtensionSyntaxResult({ source, language }) : undefined,
  )

  useEffect(() => {
    let active = true
    if (!enabled) {
      return () => {
        active = false
      }
    }
    setResult(createPlainExtensionSyntaxResult({ source, language }))
    void syntax.highlight({ source, language, path, priority: 'visible' }).then(
      (next) => {
        if (active) setResult(next)
      },
      () => {
        if (active) setResult(createPlainExtensionSyntaxResult({ source, language }))
      },
    )
    return () => {
      active = false
    }
  }, [enabled, language, path, source, syntax])
  return enabled ? result : undefined
}

export function SyntaxBlock({
  syntax,
  source,
  language,
  path,
  className,
  wrap = false,
  showLineNumbers = false,
  ariaLabel,
}: SyntaxBlockProps) {
  const result =
    useExtensionSyntaxResult({ syntax, source, language, path }) ??
    createPlainExtensionSyntaxResult({ source, language })

  return (
    <section aria-label={ariaLabel}>
      <pre
        className={openWaggleExtensionClassName(
          OPENWAGGLE_EXTENSION_UI_CLASS_NAMES.syntaxBlock,
          className,
        )}
        data-ow-syntax-language={result.language}
        data-ow-syntax-status={result.status}
        data-ow-wrap={wrap ? 'true' : 'false'}
        title={result.diagnostic}
        style={{
          ...(result.background ? { backgroundColor: result.background } : {}),
          ...(result.foreground ? { color: result.foreground } : {}),
        }}
      >
        <code>
          {result.lines.map((line, lineIndex) => (
            <span key={`${String(lineIndex)}:${line.map((token) => token.content).join('')}`}>
              {showLineNumbers ? (
                <span
                  aria-hidden="true"
                  className={OPENWAGGLE_EXTENSION_UI_CLASS_NAMES.syntaxLineNumber}
                >
                  {lineIndex + 1}
                </span>
              ) : null}
              {line.map((token, tokenIndex) => (
                <span
                  key={`${String(tokenIndex)}:${token.content}`}
                  style={syntaxTokenStyle(token)}
                >
                  {token.content}
                </span>
              ))}
              {lineIndex < result.lines.length - 1 ? '\n' : null}
            </span>
          ))}
        </code>
      </pre>
    </section>
  )
}

export type SourceViewProps = SyntaxBlockProps

const SOURCE_VIEW_LINE_HEIGHT_PX = 20
const SOURCE_VIEW_HEIGHT_PX = 320
const SOURCE_VIEW_OVERSCAN_LINES = 20
const SOURCE_VIEW_HIGHLIGHT_MAX_CODE_UNITS = 64 * 1024
const SOURCE_VIEW_HIGHLIGHT_MAX_LINES = 2_000

function indexSourceLines(source: string) {
  const lineStarts = [0]
  let newlineIndex = source.indexOf('\n')
  while (newlineIndex >= 0) {
    lineStarts.push(newlineIndex + 1)
    newlineIndex = source.indexOf('\n', newlineIndex + 1)
  }
  return lineStarts
}

function materializePlainSourceLines(
  source: string,
  lineStarts: readonly number[],
  start: number,
  end: number,
) {
  return Array.from({ length: end - start }, (_, visibleIndex) => {
    const lineIndex = start + visibleIndex
    const lineStart = lineStarts[lineIndex] ?? source.length
    const nextLineStart = lineStarts[lineIndex + 1]
    const lineEnd = nextLineStart === undefined ? source.length : nextLineStart - 1
    return [{ content: source.slice(lineStart, lineEnd) }]
  })
}

export function SourceView({
  syntax,
  source,
  language,
  path,
  className,
  showLineNumbers = true,
  ariaLabel,
}: SourceViewProps) {
  const sourceLineStarts = useMemo(() => indexSourceLines(source), [source])
  const sourceLineCount = sourceLineStarts.length
  const highlightEnabled =
    source.length <= SOURCE_VIEW_HIGHLIGHT_MAX_CODE_UNITS &&
    sourceLineCount <= SOURCE_VIEW_HIGHLIGHT_MAX_LINES
  const result = useExtensionSyntaxResult({
    syntax,
    source,
    language,
    path,
    enabled: highlightEnabled,
  })
  const [scrollTop, setScrollTop] = useState(0)
  const lineCount = Math.max(1, result?.lines.length ?? sourceLineCount)
  const firstVisible = Math.floor(scrollTop / SOURCE_VIEW_LINE_HEIGHT_PX)
  const start = Math.max(0, firstVisible - SOURCE_VIEW_OVERSCAN_LINES)
  const visibleLines = Math.ceil(SOURCE_VIEW_HEIGHT_PX / SOURCE_VIEW_LINE_HEIGHT_PX)
  const end = Math.min(lineCount, firstVisible + visibleLines + SOURCE_VIEW_OVERSCAN_LINES)
  const visibleRows = useMemo(
    () =>
      result?.lines.slice(start, end) ??
      materializePlainSourceLines(source, sourceLineStarts, start, end),
    [end, result, source, sourceLineStarts, start],
  )
  return (
    <section aria-label={ariaLabel}>
      <pre
        className={openWaggleExtensionClassName(
          OPENWAGGLE_EXTENSION_UI_CLASS_NAMES.syntaxBlock,
          className,
        )}
        data-ow-syntax-language={(result?.language ?? language?.trim()) || 'text'}
        data-ow-syntax-status={result?.status ?? 'plain-text'}
        title={result?.diagnostic}
        onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
        style={{
          height: Math.min(SOURCE_VIEW_HEIGHT_PX, lineCount * SOURCE_VIEW_LINE_HEIGHT_PX),
          overflow: 'auto',
          position: 'relative',
          ...(result?.background ? { backgroundColor: result.background } : {}),
          ...(result?.foreground ? { color: result.foreground } : {}),
        }}
      >
        <code
          style={{
            display: 'block',
            height: lineCount * SOURCE_VIEW_LINE_HEIGHT_PX,
            minWidth: 'max-content',
            position: 'relative',
          }}
        >
          {visibleRows.map((line, visibleIndex) => {
            const lineIndex = start + visibleIndex
            return (
              <span
                key={String(lineIndex)}
                data-ow-source-row={lineIndex + 1}
                style={{
                  display: 'block',
                  height: SOURCE_VIEW_LINE_HEIGHT_PX,
                  left: 0,
                  position: 'absolute',
                  top: lineIndex * SOURCE_VIEW_LINE_HEIGHT_PX,
                  whiteSpace: 'pre',
                }}
              >
                {showLineNumbers ? (
                  <span
                    aria-hidden="true"
                    className={OPENWAGGLE_EXTENSION_UI_CLASS_NAMES.syntaxLineNumber}
                  >
                    {lineIndex + 1}
                  </span>
                ) : null}
                {line.map((token, tokenIndex) => (
                  <span key={String(tokenIndex)} style={syntaxTokenStyle(token)}>
                    {token.content}
                  </span>
                ))}
              </span>
            )
          })}
        </code>
      </pre>
    </section>
  )
}

export interface StackProps {
  readonly children?: ReactNode
  readonly className?: string
  readonly gap?: CSSProperties['gap']
  readonly ref?: Ref<HTMLDivElement>
  readonly style?: CSSProperties
}

export function Stack({ children, className, gap, ref, style }: StackProps) {
  return (
    <div
      ref={ref}
      className={openWaggleExtensionClassName(OPENWAGGLE_EXTENSION_UI_CLASS_NAMES.stack, className)}
      style={{ ...style, ...(gap !== undefined ? { gap } : {}) }}
    >
      {children}
    </div>
  )
}

export interface PanelProps {
  readonly children?: ReactNode
  readonly className?: string
  readonly ref?: Ref<HTMLDivElement>
  readonly style?: CSSProperties
}

export function Panel({ children, className, ref, style }: PanelProps) {
  return (
    <section
      ref={ref}
      className={openWaggleExtensionClassName(OPENWAGGLE_EXTENSION_UI_CLASS_NAMES.panel, className)}
      style={style}
    >
      {children}
    </section>
  )
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly ref?: Ref<HTMLButtonElement>
  readonly variant?: OpenWaggleExtensionUiButtonVariant
}

export function Button({ children, className, ref, variant = 'secondary', ...props }: ButtonProps) {
  return (
    <button
      {...props}
      ref={ref}
      className={openWaggleExtensionClassName(
        OPENWAGGLE_EXTENSION_UI_CLASS_NAMES.button,
        className,
      )}
      data-ow-variant={variant}
    >
      {children}
    </button>
  )
}

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  readonly ref?: Ref<HTMLInputElement>
}

export function Input({ className, ref, ...props }: InputProps) {
  return (
    <input
      {...props}
      ref={ref}
      className={openWaggleExtensionClassName(OPENWAGGLE_EXTENSION_UI_CLASS_NAMES.input, className)}
    />
  )
}

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  readonly ref?: Ref<HTMLTextAreaElement>
}

export function Textarea({ className, ref, ...props }: TextareaProps) {
  return (
    <textarea
      {...props}
      ref={ref}
      className={openWaggleExtensionClassName(
        OPENWAGGLE_EXTENSION_UI_CLASS_NAMES.textarea,
        className,
      )}
    />
  )
}

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  readonly ref?: Ref<HTMLSelectElement>
}

export function Select({ children, className, ref, ...props }: SelectProps) {
  return (
    <select
      {...props}
      ref={ref}
      className={openWaggleExtensionClassName(
        OPENWAGGLE_EXTENSION_UI_CLASS_NAMES.select,
        className,
      )}
    >
      {children}
    </select>
  )
}

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  readonly ref?: Ref<HTMLInputElement>
}

export function Checkbox({ className, ref, ...props }: CheckboxProps) {
  return (
    <input
      {...props}
      ref={ref}
      type="checkbox"
      className={openWaggleExtensionClassName(
        OPENWAGGLE_EXTENSION_UI_CLASS_NAMES.checkbox,
        className,
      )}
    />
  )
}

export interface BadgeProps {
  readonly children?: ReactNode
  readonly className?: string
  readonly ref?: Ref<HTMLSpanElement>
  readonly tone?: OpenWaggleExtensionUiTone
}

export function Badge({ children, className, ref, tone = 'neutral' }: BadgeProps) {
  return (
    <span
      ref={ref}
      className={openWaggleExtensionClassName(OPENWAGGLE_EXTENSION_UI_CLASS_NAMES.badge, className)}
      data-ow-tone={tone}
    >
      {children}
    </span>
  )
}

export interface AlertProps {
  readonly children?: ReactNode
  readonly className?: string
  readonly ref?: Ref<HTMLDivElement>
  readonly role?: 'alert' | 'status' | 'note'
  readonly tone?: OpenWaggleExtensionUiTone
}

export function Alert({ children, className, ref, role = 'status', tone = 'neutral' }: AlertProps) {
  return (
    <div
      ref={ref}
      role={role}
      className={openWaggleExtensionClassName(OPENWAGGLE_EXTENSION_UI_CLASS_NAMES.alert, className)}
      data-ow-tone={tone}
    >
      {children}
    </div>
  )
}

export interface FieldProps extends HTMLAttributes<HTMLDivElement> {
  readonly description?: ReactNode
  readonly error?: ReactNode
  readonly htmlFor?: string
  readonly label: ReactNode
  readonly ref?: Ref<HTMLDivElement>
}

export function Field({
  children,
  className,
  description,
  error,
  htmlFor,
  label,
  ref,
  ...props
}: FieldProps) {
  return (
    <div
      {...props}
      ref={ref}
      className={openWaggleExtensionClassName(OPENWAGGLE_EXTENSION_UI_CLASS_NAMES.field, className)}
    >
      {htmlFor === undefined ? (
        <span className={OPENWAGGLE_EXTENSION_UI_CLASS_NAMES.text}>{label}</span>
      ) : (
        <label className={OPENWAGGLE_EXTENSION_UI_CLASS_NAMES.text} htmlFor={htmlFor}>
          {label}
        </label>
      )}
      {description ? (
        <span className={OPENWAGGLE_EXTENSION_UI_CLASS_NAMES.muted}>{description}</span>
      ) : null}
      {children}
      {error ? <span data-ow-tone="danger">{error}</span> : null}
    </div>
  )
}

export type { OpenWaggleExtensionUiButtonVariant, OpenWaggleExtensionUiTone }
export { OPENWAGGLE_EXTENSION_UI_ATTRIBUTES, OPENWAGGLE_EXTENSION_UI_CLASS_NAMES }
