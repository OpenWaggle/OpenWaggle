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
const STYLE_ELEMENT = 'style'

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

/** Shape and structure elements kept in the mask. Everything else is dropped with its subtree. */
const ALLOWED_ELEMENTS = new Set([
  ROOT_ELEMENT,
  STYLE_ELEMENT,
  'g',
  'path',
  'circle',
  'ellipse',
  'line',
  'polyline',
  'polygon',
  'rect',
  'defs',
  'clipPath',
  'mask',
  'use',
  'symbol',
  'linearGradient',
  'radialGradient',
  'stop',
])

const ALLOWED_ATTRIBUTES = new Set([
  'id',
  'class',
  'style',
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

const REFERENCE_ATTRIBUTES = new Set(['href', 'xlink:href'])
const CSS_URL_FUNCTION = /url\s*\(([^)]*)\)/giu
const CSS_URL_START = /url\s*\(/giu
const UNSAFE_CSS = /\\|@import|expression\s*\(/iu
const CSS_QUOTES = /^['"]|['"]$/gu
const LENGTH_IN_PIXELS = /^\s*(\d+(?:\.\d+)?)(?:px)?\s*$/u
const VIEW_BOX_SEPARATOR = /[\s,]+/u

function isLocalFragmentReference(value: string) {
  return value.trim().startsWith('#')
}

/** True when every CSS `url(...)` in the value points at a fragment inside this document. */
function referencesOnlyLocalFragments(value: string) {
  if (UNSAFE_CSS.test(value)) return false
  const urlStarts = [...value.matchAll(CSS_URL_START)].length
  const urls = [...value.matchAll(CSS_URL_FUNCTION)]
  return (
    urls.length === urlStarts &&
    urls.every((url) => isLocalFragmentReference((url[1] ?? '').trim().replace(CSS_QUOTES, '')))
  )
}

function sanitizeAttribute(attribute: SvgMarkupAttribute): readonly SvgMarkupAttribute[] {
  if (REFERENCE_ATTRIBUTES.has(attribute.name)) {
    return isLocalFragmentReference(attribute.value)
      ? [{ name: 'href', value: attribute.value.trim() }]
      : []
  }
  if (!ALLOWED_ATTRIBUTES.has(attribute.name)) return []
  return referencesOnlyLocalFragments(attribute.value) ? [attribute] : []
}

function sanitizeStyleElement(element: SvgMarkupElement): SvgMarkupElement | null {
  if (element.children.some((child) => child.kind === 'element')) return null
  const css = element.children.map((child) => (child.kind === 'text' ? child.text : '')).join('')
  if (!referencesOnlyLocalFragments(css)) return null
  return {
    kind: 'element',
    name: STYLE_ELEMENT,
    attributes: [],
    children: css.length > 0 ? [{ kind: 'text', text: css }] : [],
  }
}

function sanitizeElement(element: SvgMarkupElement): SvgMarkupElement | null {
  if (!ALLOWED_ELEMENTS.has(element.name)) return null
  if (element.name === STYLE_ELEMENT) return sanitizeStyleElement(element)

  const children: SvgMarkupNode[] = []
  for (const child of element.children) {
    if (child.kind !== 'element') continue
    const sanitized = sanitizeElement(child)
    if (sanitized !== null) children.push(sanitized)
  }
  return {
    kind: 'element',
    name: element.name,
    attributes: element.attributes.flatMap(sanitizeAttribute),
    children,
  }
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

function isValidViewBox(value: string) {
  const numbers = value.trim().split(VIEW_BOX_SEPARATOR)
  return (
    numbers.length === VIEW_BOX_NUMBER_COUNT &&
    numbers.every((part) => Number.isFinite(Number(part)))
  )
}

function pixelLength(value: string | undefined) {
  const matched = value === undefined ? null : LENGTH_IN_PIXELS.exec(value)
  const length = matched ? Number(matched[1]) : Number.NaN
  return length > 0 ? length : null
}

/** The root must carry a viewBox so the mask scales; derive one from numeric width/height. */
function rootViewBox(root: SvgMarkupElement) {
  const declared = attributeValue(root, 'viewBox')
  if (declared !== undefined) return isValidViewBox(declared) ? declared.trim() : null
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
 * foreign content are rejected; unknown elements, event handlers, external references and CSS
 * that loads resources are removed.
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
  if (sanitized === null) return { ok: false, reason: 'The SVG file has no usable shapes.' }
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
