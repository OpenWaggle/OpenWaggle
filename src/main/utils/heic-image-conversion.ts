import { createRequire } from 'node:module'
import { Worker } from 'node:worker_threads'
import { PI_PROMPT_IMAGE_DEFAULTS } from '@shared/constants/prompt-image'
import { TIME_UNIT } from '@shared/constants/time'
import { loadSharp } from '../adapters/sharp-module'

const BASE64_INPUT_BYTES = 3
const BASE64_OUTPUT_BYTES = 4
const RGBA_CHANNELS = 4
/** Each step the encoder shrinks by when the payload still does not fit. */
const SCALE_STEP = 0.8
/** How far the encode may shrink: a 20000px image can still fit, and 16 steps reach this floor. */
const MIN_SCALE = 0.05
/** The steps from full size down to the floor, so the encode loop cannot run on. */
const MAX_ENCODE_ATTEMPTS = 16

const HEIC_MIME_TYPES = new Set([
  'image/heic',
  'image/heif',
  'image/heic-sequence',
  'image/heif-sequence',
])

/** Pi measures its inline image budget in base64 characters, so this does too. */
export function base64ByteLength(byteLength: number) {
  return Math.ceil(byteLength / BASE64_INPUT_BYTES) * BASE64_OUTPUT_BYTES
}

export function isHeicImageMimeType(mimeType: string) {
  return HEIC_MIME_TYPES.has(mimeType.split(';')[0]?.trim().toLowerCase() ?? '')
}

export interface DecodedImage {
  readonly data: Uint8ClampedArray
  readonly width: number
  readonly height: number
}

/** How long one decode may run before its worker is stopped; a 12 MP photo takes about 0.4 s. */
const HEIC_DECODE_TIMEOUT_MS = 60_000

interface HeicDecoderFiles {
  /** `heic-decode`'s decoder, which takes the libheif module it runs on. */
  readonly decoder: string
  /** libheif's emscripten loader, without the wasm inlined as base64. */
  readonly libheif: string
  /** The libheif wasm binary the loader is handed, a separate replaceable file (ADR 0068). */
  readonly wasm: string
}

let heicDecoderFiles: HeicDecoderFiles | undefined

/**
 * The decoder's files, resolved on the first decode rather than when the GUI and the Host evaluate
 * this module at startup. `libheif-js` is resolved from `heic-decode`, which depends on it: the
 * isolated linker does not hoist it to the project's own `node_modules`.
 */
function heicDecoderFilesOnFirstUse() {
  if (heicDecoderFiles !== undefined) return heicDecoderFiles
  const decoder = createRequire(__filename).resolve('heic-decode/lib.js')
  const resolveFromDecoder = createRequire(decoder).resolve
  heicDecoderFiles = {
    decoder,
    libheif: resolveFromDecoder('libheif-js/libheif-wasm/libheif.js'),
    wasm: resolveFromDecoder('libheif-js/libheif-wasm/libheif.wasm'),
  }
  return heicDecoderFiles
}

/*
 * libheif decodes synchronously, on whichever thread calls it: about 0.4 s for a 12 MP iPhone photo
 * and seconds for a larger one. On the GUI's or the Session Host's main thread that stalls every
 * IPC reply and every Run's stream, so each decode runs in a worker of its own, which also keeps a
 * malformed file's wasm failure out of the process. The pixels come back transferred, not copied.
 */
const HEIC_DECODE_WORKER_SOURCE = String.raw`
const fs = require('node:fs')
const { parentPort, workerData } = require('node:worker_threads')

async function decode() {
  const wasmBinary = fs.readFileSync(workerData.files.wasm)
  const libheif = require(workerData.files.libheif)({ wasmBinary })
  const { one } = require(workerData.files.decoder)(libheif)
  return await one({ buffer: workerData.bytes })
}

decode().then(
  (image) => parentPort.postMessage(
    { ok: true, width: image.width, height: image.height, data: image.data },
    [image.data.buffer],
  ),
  (error) => parentPort.postMessage({
    ok: false,
    error: error instanceof Error ? error.message : String(error),
  }),
)
`

function decodedImageMessage(value: unknown) {
  if (typeof value !== 'object' || value === null || !('ok' in value)) {
    return 'The HEIC decoder returned an invalid response.'
  }
  if (value.ok === false) {
    return 'error' in value && typeof value.error === 'string'
      ? value.error
      : 'The HEIC image could not be decoded.'
  }
  if (
    'data' in value &&
    value.data instanceof Uint8ClampedArray &&
    'width' in value &&
    typeof value.width === 'number' &&
    'height' in value &&
    typeof value.height === 'number'
  ) {
    return { data: value.data, width: value.width, height: value.height }
  }
  return 'The HEIC decoder returned an invalid response.'
}

/** libheif reads the format Pi's own decoder cannot (ADR 0068), with the container transform applied. */
function decodeHeicInWorker(bytes: Uint8Array) {
  const files = heicDecoderFilesOnFirstUse()
  return new Promise<DecodedImage>((resolve, reject) => {
    const worker = new Worker(HEIC_DECODE_WORKER_SOURCE, {
      eval: true,
      workerData: { bytes, files },
    })
    // The first of these settles the promise; the rest are no-ops.
    const timer = setTimeout(() => {
      reject(
        new Error(
          `Decoding the HEIC image took longer than ${String(HEIC_DECODE_TIMEOUT_MS / TIME_UNIT.MILLISECONDS_PER_SECOND)} s.`,
        ),
      )
      void worker.terminate()
    }, HEIC_DECODE_TIMEOUT_MS)
    worker.once('message', (message: unknown) => {
      clearTimeout(timer)
      const image = decodedImageMessage(message)
      if (typeof image === 'string') reject(new Error(image))
      else resolve(image)
      void worker.terminate()
    })
    worker.once('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    worker.once('exit', (code) => {
      clearTimeout(timer)
      reject(new Error(`The HEIC decoder exited with code ${String(code)} before it answered.`))
    })
  })
}

async function decodeHeic(bytes: Uint8Array) {
  const image = await decodeHeicInWorker(bytes)
  if (image.width <= 0 || image.height <= 0) {
    throw new Error('The image has no pixels to attach.')
  }
  return image
}

function jpegFileName(fileName: string) {
  const dot = fileName.lastIndexOf('.')
  const stem = dot > 0 ? fileName.slice(0, dot) : fileName
  return `${stem || 'image'}.jpg`
}

/**
 * Encodes the pixels once, inside Pi's own defaults, so Pi passes the image through instead of
 * resizing it a second time. Smaller dimensions are tried until the payload fits.
 */
export async function encodePromptImage(image: DecodedImage) {
  const sharp = await loadSharp()
  const source = Buffer.from(image.data.buffer, image.data.byteOffset, image.data.byteLength)
  const longEdge = Math.max(image.width, image.height)
  let scale = Math.max(MIN_SCALE, Math.min(1, PI_PROMPT_IMAGE_DEFAULTS.MAX_DIMENSION / longEdge))

  // Each step shrinks by the same factor, so the loop is bounded by the steps left to the floor.
  for (let attempt = 0; attempt < MAX_ENCODE_ATTEMPTS; attempt += 1) {
    const width = Math.max(1, Math.round(image.width * scale))
    const height = Math.max(1, Math.round(image.height * scale))
    const encoded = await sharp(source, {
      raw: { width: image.width, height: image.height, channels: RGBA_CHANNELS },
    })
      .resize({ width, height, fit: 'fill' })
      .jpeg({ quality: PI_PROMPT_IMAGE_DEFAULTS.JPEG_QUALITY })
      .toBuffer()
    if (base64ByteLength(encoded.byteLength) < PI_PROMPT_IMAGE_DEFAULTS.MAX_BASE64_BYTES) {
      return encoded
    }
    if (scale <= MIN_SCALE) break
    scale = Math.max(MIN_SCALE, scale * SCALE_STEP)
  }
  throw new Error('The image could not be made to fit the prompt image budget.')
}

/**
 * The attachment a HEIC file becomes: one JPEG encode, named after the file it came from, so Pi
 * receives an image it can carry and no other path has to know HEIC existed (ADR 0068).
 */
export async function convertHeicToAttachmentImage(input: {
  readonly bytes: Uint8Array
  readonly fileName: string
}) {
  const image = await decodeHeic(input.bytes)
  const bytes = await encodePromptImage(image)
  return { bytes, fileName: jpegFileName(input.fileName), mimeType: 'image/jpeg' as const }
}
