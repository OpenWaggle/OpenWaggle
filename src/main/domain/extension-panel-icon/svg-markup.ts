/**
 * A deliberately small, strict XML reader for single-root SVG icon files. It accepts elements,
 * attributes, text, comments, CDATA and processing instructions; it rejects DOCTYPE and entity
 * declarations, unknown entities, mismatched tags and anything outside a single root element.
 */

export interface SvgMarkupAttribute {
  readonly name: string
  readonly value: string
}

export interface SvgMarkupElement {
  readonly kind: 'element'
  readonly name: string
  readonly attributes: readonly SvgMarkupAttribute[]
  readonly children: readonly SvgMarkupNode[]
}

export interface SvgMarkupText {
  readonly kind: 'text'
  readonly text: string
}

export type SvgMarkupNode = SvgMarkupElement | SvgMarkupText

export type SvgMarkupParseResult =
  | { readonly ok: true; readonly root: SvgMarkupElement }
  | { readonly ok: false; readonly reason: string }

const MAX_ELEMENT_DEPTH = 32
const MAX_ELEMENT_COUNT = 4096
const HEX_RADIX = 16
const DECIMAL_RADIX = 10
const MAX_CODE_POINT = 0x10ffff
const HEX_REFERENCE_PREFIX = '#x'
const DECIMAL_REFERENCE_PREFIX = '#'
const HEX_REFERENCE = /^#x[0-9a-fA-F]+$/u
const DECIMAL_REFERENCE = /^#[0-9]+$/u
const NAME_PATTERN = /^[A-Za-z_][\w.:-]*/u
const WHITESPACE_PATTERN = /\s/u
const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
}

class SvgMarkupError extends Error {}

function decodeEntity(reference: string) {
  const named = NAMED_ENTITIES[reference]
  if (named !== undefined) return named
  const codePoint = HEX_REFERENCE.test(reference)
    ? Number.parseInt(reference.slice(HEX_REFERENCE_PREFIX.length), HEX_RADIX)
    : DECIMAL_REFERENCE.test(reference)
      ? Number.parseInt(reference.slice(DECIMAL_REFERENCE_PREFIX.length), DECIMAL_RADIX)
      : Number.NaN
  if (!Number.isInteger(codePoint) || codePoint <= 0 || codePoint > MAX_CODE_POINT) {
    throw new SvgMarkupError(`Unsupported character reference "&${reference};".`)
  }
  return String.fromCodePoint(codePoint)
}

function decodeCharacterData(raw: string) {
  let decoded = ''
  let index = 0
  while (index < raw.length) {
    const ampersand = raw.indexOf('&', index)
    if (ampersand === -1) return decoded + raw.slice(index)
    const semicolon = raw.indexOf(';', ampersand)
    if (semicolon === -1) throw new SvgMarkupError('Unterminated character reference.')
    decoded += raw.slice(index, ampersand) + decodeEntity(raw.slice(ampersand + 1, semicolon))
    index = semicolon + 1
  }
  return decoded
}

class SvgMarkupReader {
  private index = 0
  private elementCount = 0

  constructor(private readonly source: string) {}

  parseDocument() {
    this.skipMisc()
    if (!this.source.startsWith('<', this.index)) {
      throw new SvgMarkupError('The file must contain a single root element.')
    }
    const root = this.parseElement(1)
    this.skipMisc()
    if (this.index < this.source.length) {
      throw new SvgMarkupError('Content after the root element is not allowed.')
    }
    return root
  }

  private skipWhitespace() {
    while (
      this.index < this.source.length &&
      WHITESPACE_PATTERN.test(this.source[this.index] ?? '')
    ) {
      this.index += 1
    }
  }

  private skipUntil(terminator: string, description: string) {
    const end = this.source.indexOf(terminator, this.index)
    if (end === -1) throw new SvgMarkupError(`Unterminated ${description}.`)
    const content = this.source.slice(this.index, end)
    this.index = end + terminator.length
    return content
  }

  /** Skips whitespace, comments and processing instructions; rejects declarations. */
  private skipMisc() {
    while (true) {
      this.skipWhitespace()
      if (this.source.startsWith('<!--', this.index)) {
        this.index += '<!--'.length
        this.skipUntil('-->', 'comment')
        continue
      }
      if (this.source.startsWith('<?', this.index)) {
        this.index += '<?'.length
        this.skipUntil('?>', 'processing instruction')
        continue
      }
      if (this.source.startsWith('<!', this.index)) {
        throw new SvgMarkupError('DOCTYPE and entity declarations are not allowed.')
      }
      return
    }
  }

  private readName() {
    const matched = NAME_PATTERN.exec(this.source.slice(this.index))
    if (!matched) throw new SvgMarkupError('Expected an element or attribute name.')
    this.index += matched[0].length
    return matched[0]
  }

  private readAttributeValue() {
    const quote = this.source[this.index]
    if (quote !== '"' && quote !== "'") {
      throw new SvgMarkupError('Attribute values must be quoted.')
    }
    this.index += 1
    const raw = this.skipUntil(quote, 'attribute value')
    if (raw.includes('<')) throw new SvgMarkupError('Attribute values must not contain "<".')
    return decodeCharacterData(raw)
  }

  private readAttributes() {
    const attributes: SvgMarkupAttribute[] = []
    while (true) {
      this.skipWhitespace()
      const next = this.source[this.index]
      if (next === undefined) throw new SvgMarkupError('Unterminated start tag.')
      if (next === '>' || this.source.startsWith('/>', this.index)) return attributes
      const name = this.readName()
      this.skipWhitespace()
      if (this.source[this.index] !== '=') {
        throw new SvgMarkupError(`Attribute "${name}" must have a value.`)
      }
      this.index += 1
      this.skipWhitespace()
      if (attributes.some((attribute) => attribute.name === name)) {
        throw new SvgMarkupError(`Duplicate attribute "${name}".`)
      }
      attributes.push({ name, value: this.readAttributeValue() })
    }
  }

  private parseElement(depth: number): SvgMarkupElement {
    if (depth > MAX_ELEMENT_DEPTH) throw new SvgMarkupError('Elements are nested too deeply.')
    this.elementCount += 1
    if (this.elementCount > MAX_ELEMENT_COUNT) throw new SvgMarkupError('Too many elements.')

    this.index += 1
    const name = this.readName()
    const attributes = this.readAttributes()
    if (this.source.startsWith('/>', this.index)) {
      this.index += '/>'.length
      return { kind: 'element', name, attributes, children: [] }
    }
    this.index += 1
    return { kind: 'element', name, attributes, children: this.parseChildren(name, depth) }
  }

  private parseChildren(parentName: string, depth: number) {
    const children: SvgMarkupNode[] = []
    while (true) {
      const tagStart = this.source.indexOf('<', this.index)
      if (tagStart === -1) throw new SvgMarkupError(`Element "${parentName}" is not closed.`)
      if (tagStart > this.index) {
        children.push({
          kind: 'text',
          text: decodeCharacterData(this.source.slice(this.index, tagStart)),
        })
      }
      this.index = tagStart
      if (this.source.startsWith('</', this.index)) {
        this.index += '</'.length
        const closingName = this.readName()
        this.skipWhitespace()
        if (closingName !== parentName || this.source[this.index] !== '>') {
          throw new SvgMarkupError(`Mismatched closing tag for "${parentName}".`)
        }
        this.index += 1
        return children
      }
      this.parseChildMarkup(children, depth)
    }
  }

  private parseChildMarkup(children: SvgMarkupNode[], depth: number) {
    if (this.source.startsWith('<!--', this.index)) {
      this.index += '<!--'.length
      this.skipUntil('-->', 'comment')
      return
    }
    if (this.source.startsWith('<![CDATA[', this.index)) {
      this.index += '<![CDATA['.length
      children.push({ kind: 'text', text: this.skipUntil(']]>', 'CDATA section') })
      return
    }
    if (this.source.startsWith('<?', this.index)) {
      this.index += '<?'.length
      this.skipUntil('?>', 'processing instruction')
      return
    }
    if (this.source.startsWith('<!', this.index)) {
      throw new SvgMarkupError('Declarations are not allowed inside elements.')
    }
    children.push(this.parseElement(depth + 1))
  }
}

export function parseSvgMarkup(source: string): SvgMarkupParseResult {
  try {
    return { ok: true, root: new SvgMarkupReader(source).parseDocument() }
  } catch (error) {
    if (error instanceof SvgMarkupError) return { ok: false, reason: error.message }
    throw error
  }
}

function escapeXml(value: string) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

function escapeAttribute(value: string) {
  return escapeXml(value).replaceAll('"', '&quot;')
}

/** Serializes a markup tree into standalone markup; text is only emitted where it is present. */
export function serializeSvgMarkup(node: SvgMarkupNode): string {
  if (node.kind === 'text') return escapeXml(node.text)
  const attributes = node.attributes
    .map((attribute) => ` ${attribute.name}="${escapeAttribute(attribute.value)}"`)
    .join('')
  if (node.children.length === 0) return `<${node.name}${attributes}/>`
  return `<${node.name}${attributes}>${node.children.map(serializeSvgMarkup).join('')}</${node.name}>`
}
