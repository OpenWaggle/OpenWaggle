import { PlainTextBlock } from './PlainTextBlock'
import { SyntaxBlock } from './SyntaxBlock'

const JSON_INDENT_SPACES = 2

export function serializeStructuredPayload(value: unknown) {
  try {
    return JSON.stringify(value, null, JSON_INDENT_SPACES)
  } catch {
    return null
  }
}

export function StructuredPayload({
  value,
  ariaLabel = 'Structured data',
  className,
  theme,
  serialized,
}: {
  readonly value: unknown
  readonly ariaLabel?: string
  readonly className?: string
  readonly theme?: string
  readonly serialized?: string | null
}) {
  if (typeof value === 'string') {
    return (
      <PlainTextBlock reason="prose" className={className}>
        {value}
      </PlainTextBlock>
    )
  }
  const source = serialized ?? serializeStructuredPayload(value)
  if (source === null) {
    return (
      <PlainTextBlock reason="unknown-language" className={className}>
        {String(value)}
      </PlainTextBlock>
    )
  }
  return (
    <SyntaxBlock
      source={source ?? 'null'}
      language="json"
      theme={theme}
      ariaLabel={ariaLabel}
      className={className}
      wrap
    />
  )
}
