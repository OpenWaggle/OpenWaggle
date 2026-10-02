import { serializeSvgIconRoot } from '../../domain/extension-panel-icon/svg-icon-sanitizer'
import type { SvgMarkupElement } from '../../domain/extension-panel-icon/svg-markup'

type LucideAttributes = Readonly<Record<string, string | number | undefined>>
type LucideIconNode = readonly (readonly [tag: string, attributes: LucideAttributes])[]
export type LucideIconCatalog = Readonly<Record<string, LucideIconNode | undefined>>

/** Lucide's own `defaultAttributes`, so extension icons match built-in lucide-react icons. */
const LUCIDE_ROOT_ATTRIBUTES = [
  { name: 'width', value: '24' },
  { name: 'height', value: '24' },
  { name: 'viewBox', value: '0 0 24 24' },
  { name: 'fill', value: 'none' },
  { name: 'stroke', value: 'currentColor' },
  { name: 'stroke-width', value: '2' },
  { name: 'stroke-linecap', value: 'round' },
  { name: 'stroke-linejoin', value: 'round' },
] as const

let bundledCatalog: Promise<LucideIconCatalog> | null = null

/** Loads the bundled `lucide` icon catalog once, on first use, keyed by PascalCase name. */
export function loadBundledLucideIcons() {
  bundledCatalog ??= import('lucide').then((module): LucideIconCatalog => module.icons)
  return bundledCatalog
}

/** `git-pull-request` → `GitPullRequest`, `arrow-down-0-1` → `ArrowDown01`, as Lucide names them. */
export function lucideExportName(kebabName: string) {
  return kebabName
    .split('-')
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join('')
}

function lucideNodeToElement([name, attributes]: LucideIconNode[number]): SvgMarkupElement {
  return {
    kind: 'element',
    name,
    attributes: Object.entries(attributes).flatMap(([attributeName, value]) =>
      value === undefined || attributeName === 'key'
        ? []
        : [{ name: attributeName, value: String(value) }],
    ),
    children: [],
  }
}

/** Standalone SVG markup for a Lucide icon name, or null when Lucide has no icon by that name. */
export function lucideIconSvg(catalog: LucideIconCatalog, kebabName: string) {
  const exportName = lucideExportName(kebabName)
  const iconNode = Object.hasOwn(catalog, exportName) ? catalog[exportName] : undefined
  if (iconNode === undefined) return null
  return serializeSvgIconRoot({
    kind: 'element',
    name: 'svg',
    attributes: LUCIDE_ROOT_ATTRIBUTES,
    children: iconNode.map(lucideNodeToElement),
  })
}
