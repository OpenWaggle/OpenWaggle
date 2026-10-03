/** What an extension panel SVG icon may contain once sanitized (ADR 0043). */
export const ROOT_ELEMENT = 'svg'
export const REFERENCE_ATTRIBUTE = 'href'
export const ID_ATTRIBUTE = 'id'

/** Active content: an icon containing any of these is rejected rather than silently repaired. */
export const REJECTED_ELEMENTS = new Set([
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
export const ALLOWED_ELEMENTS = new Set([
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
export const ALLOWED_ATTRIBUTES = new Set([
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

/** Containers whose children are only referenced, never drawn where they stand. */
export const NON_RENDERING_ELEMENTS = new Set([
  'defs',
  'clipPath',
  'mask',
  'symbol',
  'linearGradient',
  'radialGradient',
])
/** What a shape needs before it can draw anything: any one of these attribute sets. */
export const SHAPE_GEOMETRY: Readonly<Record<string, readonly (readonly string[])[]>> = {
  path: [['d']],
  circle: [['r']],
  ellipse: [['rx'], ['ry']],
  line: [['x1'], ['y1'], ['x2'], ['y2']],
  polyline: [['points']],
  polygon: [['points']],
  rect: [['width', 'height']],
  use: [[REFERENCE_ATTRIBUTE]],
}
