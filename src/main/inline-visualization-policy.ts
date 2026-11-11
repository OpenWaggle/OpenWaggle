import { trustedOrigins } from './desktop-shell/trusted-origins'

/**
 * The Content Security Policy every inline visualization document is served with
 * (`inline-visualization-protocol.ts`): inline and CDN scripts and styles, the frames' own origins
 * for the host stylesheet and the Lucide runtime, and nothing else (no workers, frames, forms or
 * network beyond `blob:` and `data:`).
 */
const CDN_SOURCES = [
  'https://cdnjs.cloudflare.com',
  'https://cdn.jsdelivr.net',
  'https://esm.sh',
  'https://fonts.bunny.net',
  'https://fonts.googleapis.com',
  'https://fonts.gstatic.com',
  'https://unpkg.com',
] as const
const LOCAL_RESOURCE_SOURCES = ['blob:', 'data:'] as const
const IMAGE_SOURCES = ['data:', 'blob:', ...CDN_SOURCES] as const

/**
 * The frames' own origins, where the host stylesheet and the Lucide runtime come from: the
 * visualization scheme in Electron, the loopback servers in Electrobun (ADR 0064).
 */
function visualizationSources() {
  return trustedOrigins.sourcesOf('inline-visualization')
}

/** The policy every visualization document is served with. */
export function visualizationContentSecurityPolicy() {
  const scriptSources = [
    "'unsafe-inline'",
    "'unsafe-eval'",
    "'wasm-unsafe-eval'",
    ...visualizationSources(),
    ...LOCAL_RESOURCE_SOURCES,
    ...CDN_SOURCES,
  ]
  const styleSources = [
    "'unsafe-inline'",
    ...visualizationSources(),
    ...LOCAL_RESOURCE_SOURCES,
    ...CDN_SOURCES,
  ]
  return [
    `default-src 'none'`,
    `script-src ${scriptSources.join(' ')}`,
    `script-src-elem ${scriptSources.join(' ')}`,
    `style-src ${styleSources.join(' ')}`,
    `img-src ${IMAGE_SOURCES.join(' ')}`,
    `font-src ${LOCAL_RESOURCE_SOURCES.join(' ')} ${CDN_SOURCES.join(' ')}`,
    `media-src data: blob: ${CDN_SOURCES.join(' ')}`,
    'connect-src blob: data:',
    `worker-src 'none'`,
    `child-src 'none'`,
    `frame-src 'none'`,
    `object-src 'none'`,
    `base-uri 'none'`,
    `form-action 'none'`,
  ].join('; ')
}
