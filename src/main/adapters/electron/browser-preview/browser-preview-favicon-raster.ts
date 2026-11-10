import type { Buffer } from 'node:buffer'
import { DOUBLE_FACTOR } from '@shared/constants/math'
import { BROWSER_PREVIEW_LIMITS } from '@shared/types/browser-preview'
import type { WebContents } from 'electron'
import type { BrowserPreviewImageDimensions } from './browser-preview-favicon-dimensions'

const RASTER_WORLD_ID = 1_001
const RASTER_TIMEOUT_MS = 1_000
const FAVICON_RASTER_SIZE = 32
const BASE64_GROUP_SIZE = 4

interface RasterGate {
  generation: number
  launchAllowed?: Promise<void>
}

const rasterGates = new WeakMap<WebContents, RasterGate>()

export type BrowserPreviewFaviconCaptureResult =
  | { readonly kind: 'captured'; readonly dataUrl: string }
  | { readonly kind: 'none' }
  | { readonly kind: 'timed-out' }

function validPngDataUrl(value: unknown): value is string {
  if (
    typeof value !== 'string' ||
    value.length > BROWSER_PREVIEW_LIMITS.FAVICON_DATA_URL_LENGTH ||
    !value.startsWith('data:image/png;base64,')
  ) {
    return false
  }
  const payload = value.slice('data:image/png;base64,'.length)
  return (
    payload.length > 0 &&
    payload.length % BASE64_GROUP_SIZE !== 1 &&
    /^[a-z0-9+/]*={0,2}$/iu.test(payload)
  )
}

function rasterExpression(mime: string, buffer: Buffer, dimensions: BrowserPreviewImageDimensions) {
  const scale = Math.min(
    FAVICON_RASTER_SIZE / dimensions.width,
    FAVICON_RASTER_SIZE / dimensions.height,
  )
  const width = Math.max(1, Math.round(dimensions.width * scale))
  const height = Math.max(1, Math.round(dimensions.height * scale))
  const x = (FAVICON_RASTER_SIZE - width) / DOUBLE_FACTOR
  const y = (FAVICON_RASTER_SIZE - height) / DOUBLE_FACTOR
  const payload = JSON.stringify(buffer.toString('base64'))
  const contentType = JSON.stringify(mime)
  return `(async()=>{try{const b=Uint8Array.from(atob(${payload}),c=>c.charCodeAt(0));const i=await createImageBitmap(new Blob([b],{type:${contentType}}),{resizeWidth:${String(width)},resizeHeight:${String(height)},resizeQuality:'high'});try{const c=new OffscreenCanvas(${String(FAVICON_RASTER_SIZE)},${String(FAVICON_RASTER_SIZE)});const x=c.getContext('2d');if(!x)return null;x.drawImage(i,${String(x)},${String(y)},${String(width)},${String(height)});const o=new Uint8Array(await(await c.convertToBlob({type:'image/png'})).arrayBuffer());let s='';for(const v of o)s+=String.fromCharCode(v);return'data:image/png;base64,'+btoa(s)}finally{i.close()}}catch{return null}})()`
}

async function waitForLaunch(previous: Promise<void>, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return
  await new Promise<void>((resolve) => {
    const finish = () => {
      signal.removeEventListener('abort', finish)
      resolve()
    }
    signal.addEventListener('abort', finish, { once: true })
    void previous.then(finish)
  })
}

async function logicalRasterResult(execution: Promise<unknown>, signal: AbortSignal) {
  return new Promise<{ readonly timedOut: boolean; readonly value: unknown }>((resolve) => {
    const timeout = AbortSignal.timeout(RASTER_TIMEOUT_MS)
    let settled = false
    const finish = (timedOut: boolean, value: unknown) => {
      if (settled) return
      settled = true
      timeout.removeEventListener('abort', onTimeout)
      signal.removeEventListener('abort', onAbort)
      resolve({ timedOut, value })
    }
    const onTimeout = () => finish(true, null)
    const onAbort = () => finish(false, null)
    timeout.addEventListener('abort', onTimeout, { once: true })
    signal.addEventListener('abort', onAbort, { once: true })
    void execution.then(
      (value) => finish(false, value),
      () => finish(false, null),
    )
    if (signal.aborted) onAbort()
  })
}

export async function rasterizeBrowserPreviewFavicon(
  contents: WebContents,
  mime: string,
  buffer: Buffer,
  dimensions: BrowserPreviewImageDimensions,
  signal: AbortSignal,
): Promise<BrowserPreviewFaviconCaptureResult> {
  const gate = rasterGates.get(contents) ?? { generation: 0 }
  rasterGates.set(contents, gate)
  const generation = ++gate.generation
  if (gate.launchAllowed) await waitForLaunch(gate.launchAllowed, signal)
  if (signal.aborted || generation !== gate.generation) return { kind: 'none' }
  const execution = contents.executeJavaScriptInIsolatedWorld(RASTER_WORLD_ID, [
    { code: rasterExpression(mime, buffer, dimensions) },
  ])
  const launchAllowed = execution.then(
    () => undefined,
    () => undefined,
  )
  gate.launchAllowed = launchAllowed
  void launchAllowed.then(() => {
    if (gate.launchAllowed === launchAllowed) delete gate.launchAllowed
  })
  const result = await logicalRasterResult(execution, signal)
  if (result.timedOut) return { kind: 'timed-out' }
  return validPngDataUrl(result.value)
    ? { kind: 'captured', dataUrl: result.value }
    : { kind: 'none' }
}
