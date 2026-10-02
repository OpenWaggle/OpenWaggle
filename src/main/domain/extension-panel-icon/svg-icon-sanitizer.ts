import {
  parseSvgMarkup,
  type SvgMarkupAttribute,
  type SvgMarkupElement,
  type SvgMarkupNode,
  serializeSvgMarkup,
} from './svg-markup'

/** Extension SVG icons larger than this are rejected before parsing (ADR 0043). */
export const SVG_ICON_MAX_BYTES = 32_768

export const SVG_NAMESPACE = 'http://www.w3.org/2000/svg'

export type SvgIconSanitizeResult =
  | { readonly ok: true; readonly svg: string }
  | { readonly ok: false; readonly reason: string }

const VIEW_BOX_NUMBER_COUNT = 4
const ROOT_ELEMENT = 'svg'
const REFERENCE_ATTRIBUTE = 'href'
const ID_ATTRIBUTE = 'id'

/** Active content: an icon containing any of these is rejected rather than silently repaired. */
const REJECTED_ELEMENTS = new Set([
  'script',
  'foreignObject',
  'iframe',
  'embed',
  'object',
  'handler',
  'listener',
])

/** Elements that draw something; a sanitized icon without one of these has nothing to show. */
const SHAPE_ELEMENTS = new Set([
  'path',
  'circle',
  'ellipse',
  'line',
  'polyline',
  'polygon',
  'rect',
  'use',
])

/**
 * Shape and structure elements kept in the mask. Everything else is dropped with its subtree,
 * including `<style>`: a single-colour mask never needs CSS, and CSS can load resources in more
 * ways than an allowlist can follow.
 */
const ALLOWED_ELEMENTS = new Set([
  ROOT_ELEMENT,
  ...SHAPE_ELEMENTS,
  'g',
  'defs',
  'clipPath',
  'mask',
  'symbol',
  'linearGradient',
  'radialGradient',
  'stop',
])

/** Presentation and geometry attributes kept in the mask; `style` and `class` are dropped. */
const ALLOWED_ATTRIBUTES = new Set([
  ID_ATTRIBUTE,
  'transform',
  'fill',
  'fill-rule',
  'fill-opacity',
  'stroke',
  'stroke-width',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-miterlimit',
  'stroke-dasharray',
  'stroke-dashoffset',
  'stroke-opacity',
  'opacity',
  'clip-path',
  'clip-rule',
  'mask',
  'display',
  'visibility',
  'vector-effect',
  'shape-rendering',
  'paint-order',
  'd',
  'x',
  'y',
  'x1',
  'y1',
  'x2',
  'y2',
  'cx',
  'cy',
  'r',
  'rx',
  'ry',
  'fx',
  'fy',
  'width',
  'height',
  'points',
  'pathLength',
  'offset',
  'stop-color',
  'stop-opacity',
  'viewBox',
  'preserveAspectRatio',
  'gradientUnits',
  'gradientTransform',
  'spreadMethod',
  'clipPathUnits',
  'maskUnits',
  'maskContentUnits',
])

const REFERENCE_ATTRIBUTES = new Set([REFERENCE_ATTRIBUTE, 'xlink:href'])
/**
 * A `url(#id)` reference to an element of this document, optionally quoted. Every part matches a
 * disjoint character class, so matching stays linear however long the value is (no backtracking
 * blow-up), and whitespace is CSS's ASCII whitespace only.
 */
const LOCAL_URL_REFERENCE = /url\([\t\n\f\r ]*(['"]?)#[A-Za-z_][\w.:-]*\1[\t\n\f\r ]*\)/gu
const ASCII_WHITESPACE_EDGES = /^[\t\n\f\r ]+|[\t\n\f\r ]+$/gu
/** An SVG number: no hex, no `Infinity`, no empty parts. */
const SVG_NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/u
/** Containers whose children are only referenced, never drawn where they stand. */
const NON_RENDERING_ELEMENTS = new Set([
  'defs',
  'clipPath',
  'mask',
  'symbol',
  'linearGradient',
  'radialGradient',
])
/** What a shape needs before it can draw anything: any one of these attribute sets. */
const SHAPE_GEOMETRY: Readonly<Record<string, readonly (readonly string[])[]>> = {
  path: [['d']],
  circle: [['r']],
  ellipse: [['rx'], ['ry']],
  line: [['x1'], ['y1'], ['x2'], ['y2']],
  polyline: [['points']],
  polygon: [['points']],
  rect: [['width', 'height']],
  use: [[REFERENCE_ATTRIBUTE]],
}
/**
 * Anything that can still name a resource once local `url(#…)` references are removed: other
 * `url()` forms, image functions, `src()`, escapes, imports and quoted strings.
 */
const RESOURCE_CSS =
  /\\|@import|expression\s*\(|url\s*\(|image-set\s*\(|image\s*\(|cross-fade\s*\(|element\s*\(|src\s*\(|['"]/iu
const LENGTH_IN_PIXELS = /^\s*(\d+(?:\.\d+)?)(?:px)?\s*$/u
const VIEW_BOX_SEPARATOR = /[\s,]+/u

function trimAsciiWhitespace(value: string) {
  return value.replace(ASCII_WHITESPACE_EDGES, '')
}

function isLocalFragmentReference(value: string) {
  return trimAsciiWhitespace(value).startsWith('#')
}

/** True when the value refers to nothing but fragments inside this document. */
function referencesOnlyLocalFragments(value: string) {
  return !RESOURCE_CSS.test(value.replace(LOCAL_URL_REFERENCE, ''))
}

function sanitizeAttribute(attribute: SvgMarkupAttribute): readonly SvgMarkupAttribute[] {
  if (REFERENCE_ATTRIBUTES.has(attribute.name)) {
    return isLocalFragmentReference(attribute.value)
      ? [{ name: REFERENCE_ATTRIBUTE, value: trimAsciiWhitespace(attribute.value) }]
      : []
  }
  if (!ALLOWED_ATTRIBUTES.has(attribute.name)) return []
  // An id is a name, not a value the renderer resolves, so it may hold any character.
  if (attribute.name === ID_ATTRIBUTE) return [attribute]
  return referencesOnlyLocalFragments(attribute.value) ? [attribute] : []
}

/** `href` and `xlink:href` both become `href`; only the first usable reference is kept. */
function sanitizeAttributes(attributes: readonly SvgMarkupAttribute[]) {
  const sanitized: SvgMarkupAttribute[] = []
  for (const attribute of attributes.flatMap(sanitizeAttribute)) {
    const duplicateReference =
      attribute.name === REFERENCE_ATTRIBUTE &&
      sanitized.some((kept) => kept.name === REFERENCE_ATTRIBUTE)
    if (!duplicateReference) sanitized.push(attribute)
  }
  return sanitized
}

function sanitizeElement(element: SvgMarkupElement): SvgMarkupElement | null {
  if (!ALLOWED_ELEMENTS.has(element.name)) return null

  const children: SvgMarkupNode[] = []
  for (const child of element.children) {
    if (child.kind !== 'element') continue
    const sanitized = sanitizeElement(child)
    if (sanitized !== null) children.push(sanitized)
  }
  return {
    kind: 'element',
    name: element.name,
    attributes: sanitizeAttributes(element.attributes),
    children,
  }
}

function drawsSomething(element: SvgMarkupElement) {
  const alternatives = SHAPE_GEOMETRY[element.name] ?? []
  return alternatives.some((names) =>
    names.every((name) => attributeValue(element, name) !== undefined),
  )
}

/** A shape that is drawn where it stands and kept the geometry it needs to draw. */
function containsShape(element: SvgMarkupElement): boolean {
  if (NON_RENDERING_ELEMENTS.has(element.name)) return false
  return (
    drawsSomething(element) ||
    element.children.some((child) => child.kind === 'element' && containsShape(child))
  )
}

function findRejectedElement(element: SvgMarkupElement): string | null {
  const localName = element.name.slice(element.name.indexOf(':') + 1)
  if (REJECTED_ELEMENTS.has(localName)) return localName
  for (const child of element.children) {
    if (child.kind !== 'element') continue
    const rejected = findRejectedElement(child)
    if (rejected !== null) return rejected
  }
  return null
}

function attributeValue(element: SvgMarkupElement, name: string) {
  return element.attributes.find((attribute) => attribute.name === name)?.value
}

/** Four SVG numbers with a positive width and height, as browsers require to draw anything. */
function isValidViewBox(value: string) {
  const numbers = trimAsciiWhitespace(value).split(VIEW_BOX_SEPARATOR)
  if (numbers.length !== VIEW_BOX_NUMBER_COUNT) return false
  if (!numbers.every((part) => SVG_NUMBER.test(part))) return false
  const [, , width, height] = numbers.map(Number)
  return width !== undefined && height !== undefined && width > 0 && height > 0
}

function pixelLength(value: string | undefined) {
  const matched = value === undefined ? null : LENGTH_IN_PIXELS.exec(value)
  const length = matched ? Number(matched[1]) : Number.NaN
  return length > 0 ? length : null
}

/** The root must carry a viewBox so the mask scales; derive one from numeric width/height. */
function rootViewBox(root: SvgMarkupElement) {
  const declared = attributeValue(root, 'viewBox')
  if (declared !== undefined) return isValidViewBox(declared) ? trimAsciiWhitespace(declared) : null
  const width = pixelLength(attributeValue(root, 'width'))
  const height = pixelLength(attributeValue(root, 'height'))
  return width !== null && height !== null ? `0 0 ${String(width)} ${String(height)}` : null
}

/** Serializes an icon root as standalone SVG with the SVG namespace on the root element. */
export function serializeSvgIconRoot(root: SvgMarkupElement) {
  return serializeSvgMarkup({
    ...root,
    name: ROOT_ELEMENT,
    attributes: [
      { name: 'xmlns', value: SVG_NAMESPACE },
      ...root.attributes.filter((attribute) => attribute.name !== 'xmlns'),
    ],
  })
}

function byteLength(value: string) {
  return new TextEncoder().encode(value).byteLength
}

/**
 * Reduces an extension-provided SVG file to an allowlisted shape-only document. Scripts and
 * foreign content are rejected; unknown elements, `<style>` elements, `style` and `class`
 * attributes, event handlers, external references and values that name resources are removed. An
 * icon left without any shape is rejected.
 */
export function sanitizeSvgIcon(source: string): SvgIconSanitizeResult {
  if (byteLength(source) > SVG_ICON_MAX_BYTES) {
    return { ok: false, reason: `The SVG file is larger than ${String(SVG_ICON_MAX_BYTES)} bytes.` }
  }
  const parsed = parseSvgMarkup(source)
  if (!parsed.ok) return { ok: false, reason: `The SVG file is not well-formed: ${parsed.reason}` }
  if (parsed.root.name !== ROOT_ELEMENT) {
    return { ok: false, reason: 'The SVG file must have a single <svg> root element.' }
  }
  const rejected = findRejectedElement(parsed.root)
  if (rejected !== null) {
    return { ok: false, reason: `The SVG file contains a <${rejected}> element.` }
  }
  const viewBox = rootViewBox(parsed.root)
  if (viewBox === null) {
    return { ok: false, reason: 'The SVG root needs a viewBox or numeric width and height.' }
  }

  const sanitized = sanitizeElement(parsed.root)
  if (sanitized === null || !containsShape(sanitized)) {
    return { ok: false, reason: 'The SVG file has no usable shapes.' }
  }
  const svg = serializeSvgIconRoot({
    ...sanitized,
    attributes: [
      { name: 'viewBox', value: viewBox },
      ...sanitized.attributes.filter((attribute) => attribute.name !== 'viewBox'),
    ],
  })
  return byteLength(svg) > SVG_ICON_MAX_BYTES
    ? { ok: false, reason: `The sanitized SVG is larger than ${String(SVG_ICON_MAX_BYTES)} bytes.` }
    : { ok: true, svg }
}
