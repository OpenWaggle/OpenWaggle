import { OPENWAGGLE_EXTENSION_FRAME_PROTOCOL } from '@shared/constants/extension-frame'

const FRAME_PREFIX_SEGMENT = OPENWAGGLE_EXTENSION_FRAME_PROTOCOL.FRAME_PATH_PREFIX.replaceAll(
  '/',
  '',
)
/** `frames`, the id and the document name end every frame document's path. */
const FRAME_DOCUMENT_SEGMENT_COUNT = 3

function describeError(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

/**
 * The frame id in the path of an extension frame document, `…/frames/<id>/index.html`. Read from
 * the end: Electron serves the document at `/frames/…`, Electrobun under the frame host's
 * capability path (`/<capability>/frames/…`).
 */
export function extensionFrameIdFromPath(pathname: string) {
  const segments = pathname.split('/').filter((segment) => segment.length > 0)
  const [prefix, encodedFrameId, document] = segments.slice(-FRAME_DOCUMENT_SEGMENT_COUNT)
  if (
    prefix !== FRAME_PREFIX_SEGMENT ||
    document !== OPENWAGGLE_EXTENSION_FRAME_PROTOCOL.DOCUMENT_PATH ||
    !encodedFrameId
  ) {
    throw new Error('Invalid OpenWaggle extension frame URL.')
  }

  try {
    return decodeURIComponent(encodedFrameId)
  } catch (error) {
    throw new Error(`Invalid OpenWaggle extension frame id: ${describeError(error)}.`, {
      cause: error,
    })
  }
}
