import { fromAny } from '@total-typescript/shoehorn'
import * as Effect from 'effect/Effect'
import { vi } from 'vitest'
import type * as AttachmentsHandler from '../attachments-handler'
import {
  type AttachmentFileFixture,
  createAttachmentFileHandle,
} from './attachment-file-handle.test-support'

type TestMock = ReturnType<typeof vi.fn>

interface AttachmentHandlerMocks {
  readonly typedHandleMock: TestMock
  readonly createLoggerMock: TestMock
  readonly attachmentsLoggerMock: {
    readonly debug: TestMock
    readonly info: TestMock
    readonly warn: TestMock
    readonly error: TestMock
  }
  readonly statMock: TestMock
  readonly readFileMock: TestMock
  readonly writeFileMock: TestMock
  readonly renameMock: TestMock
  readonly rmMock: TestMock
  readonly realpathMock: TestMock
  readonly mkdirMock: TestMock
  readonly openMock: TestMock
  readonly readdirMock: TestMock
  readonly unlinkMock: TestMock
  readonly appGetPathMock: TestMock
  readonly broadcastToWindowsMock: TestMock
  readonly unpdfExtractTextMock: TestMock
  readonly ocrRecognizeMock: TestMock
  readonly mammothExtractMock: TestMock
  readonly jszipLoadAsyncMock: TestMock
  readonly showMessageBoxMock: TestMock
  readonly dispatchLocalSessionCommandMock: TestMock
  readonly files: Map<string, AttachmentFileFixture>
}

const mocks: AttachmentHandlerMocks = vi.hoisted(() => ({
  typedHandleMock: vi.fn(),
  createLoggerMock: vi.fn(),
  attachmentsLoggerMock: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
  statMock: vi.fn(),
  readFileMock: vi.fn(),
  writeFileMock: vi.fn(),
  renameMock: vi.fn(),
  rmMock: vi.fn(),
  realpathMock: vi.fn(),
  mkdirMock: vi.fn(),
  openMock: vi.fn(),
  readdirMock: vi.fn(),
  unlinkMock: vi.fn(),
  appGetPathMock: vi.fn(),
  broadcastToWindowsMock: vi.fn(),
  unpdfExtractTextMock: vi.fn(),
  ocrRecognizeMock: vi.fn(),
  mammothExtractMock: vi.fn(),
  jszipLoadAsyncMock: vi.fn(),
  showMessageBoxMock: vi.fn(),
  dispatchLocalSessionCommandMock: vi.fn(),
  files: new Map<string, AttachmentFileFixture>(),
}))

export const typedHandleMock: TestMock = mocks.typedHandleMock
export const createLoggerMock: TestMock = mocks.createLoggerMock
export const attachmentsLoggerMock: AttachmentHandlerMocks['attachmentsLoggerMock'] =
  mocks.attachmentsLoggerMock
export const statMock: TestMock = mocks.statMock
export const readFileMock: TestMock = mocks.readFileMock
export const writeFileMock: TestMock = mocks.writeFileMock
export const renameMock: TestMock = mocks.renameMock
export const rmMock: TestMock = mocks.rmMock
export const realpathMock: TestMock = mocks.realpathMock
export const mkdirMock: TestMock = mocks.mkdirMock
export const openMock: TestMock = mocks.openMock
export const readdirMock: TestMock = mocks.readdirMock
export const unlinkMock: TestMock = mocks.unlinkMock
export const appGetPathMock: TestMock = mocks.appGetPathMock
export const broadcastToWindowsMock: TestMock = mocks.broadcastToWindowsMock
export const unpdfExtractTextMock: TestMock = mocks.unpdfExtractTextMock
export const ocrRecognizeMock: TestMock = mocks.ocrRecognizeMock
export const mammothExtractMock: TestMock = mocks.mammothExtractMock
export const jszipLoadAsyncMock: TestMock = mocks.jszipLoadAsyncMock
export const showMessageBoxMock: TestMock = mocks.showMessageBoxMock
export const dispatchLocalSessionCommandMock: TestMock = mocks.dispatchLocalSessionCommandMock
export const files: Map<string, AttachmentFileFixture> = mocks.files

vi.mock('../typed-ipc', () => ({
  typedHandle: typedHandleMock,
}))

vi.mock('../../application/local-session-command-dispatcher', () => ({
  dispatchLocalSessionCommand: dispatchLocalSessionCommandMock,
}))

vi.mock('../../logger', () => ({
  createLogger: createLoggerMock.mockImplementation(() => attachmentsLoggerMock),
}))

vi.mock('node:fs/promises', () => ({
  default: {
    stat: statMock,
    readFile: readFileMock,
    writeFile: writeFileMock,
    rename: renameMock,
    rm: rmMock,
    realpath: realpathMock,
    mkdir: mkdirMock,
    open: openMock,
    readdir: readdirMock,
    unlink: unlinkMock,
  },
  stat: statMock,
  readFile: readFileMock,
  writeFile: writeFileMock,
  rename: renameMock,
  rm: rmMock,
  realpath: realpathMock,
  mkdir: mkdirMock,
  open: openMock,
  readdir: readdirMock,
  unlink: unlinkMock,
}))

vi.mock('../../utils/broadcast', () => ({
  broadcastToWindows: broadcastToWindowsMock,
}))

vi.mock('electron', () => ({
  app: {
    getPath: appGetPathMock,
  },
  dialog: {
    showMessageBox: showMessageBoxMock,
  },
}))

vi.mock('unpdf', () => ({
  extractText: unpdfExtractTextMock,
}))

vi.mock('tesseract.js', () => ({
  recognize: ocrRecognizeMock,
}))

vi.mock('mammoth', () => ({
  extractRawText: mammothExtractMock,
}))

vi.mock('jszip', () => ({
  default: {
    loadAsync: jszipLoadAsyncMock,
  },
}))

export function registeredHandler(name: string) {
  const call = typedHandleMock.mock.calls.find((c: unknown[]) => c[0] === name)
  const handler = call?.[1]
  if (typeof handler !== 'function') {
    return undefined
  }
  return (...args: unknown[]) => Effect.runPromise(handler(...args))
}

export function loadAttachmentHandlers(): Promise<typeof AttachmentsHandler> {
  return import('../attachments-handler')
}

export function registerFile(
  path: string,
  content: string | Buffer,
  size?: number,
  mtimeMs = Date.now(),
) {
  const buffer = typeof content === 'string' ? Buffer.from(content, 'utf8') : content
  files.set(path, {
    size: size ?? buffer.length,
    content: buffer,
    isFile: true,
    isDirectory: false,
    mtimeMs,
  })
}

function registerDirectory(path: string, mtimeMs = Date.now()) {
  files.set(path, {
    size: 0,
    content: Buffer.alloc(0),
    isFile: false,
    isDirectory: true,
    mtimeMs,
  })
}

export function resetAttachmentHandlerMocks() {
  typedHandleMock.mockReset()
  createLoggerMock.mockReset()
  createLoggerMock.mockImplementation(() => attachmentsLoggerMock)
  attachmentsLoggerMock.debug.mockReset()
  attachmentsLoggerMock.info.mockReset()
  attachmentsLoggerMock.warn.mockReset()
  attachmentsLoggerMock.error.mockReset()
  dispatchLocalSessionCommandMock.mockReset()
  dispatchLocalSessionCommandMock.mockImplementation((rawInput: unknown) =>
    Effect.promise(async () => {
      const input = fromAny<
        {
          readonly caller: { readonly workingDirectory: string }
          readonly payload: {
            readonly request: {
              readonly requestId: string
              readonly entries: readonly {
                readonly path: string
                readonly origin?: 'user-file' | 'auto-paste-text'
              }[]
            }
          }
        },
        unknown
      >(rawInput)
      const { prepareAttachmentFiles } = await import('../../utils/attachment-preparation')
      const attachments = await prepareAttachmentFiles({
        baseDirectory: input.caller.workingDirectory,
        entries: input.payload.request.entries,
      })
      return {
        contract: 'local-attachments-v1',
        response: { requestId: input.payload.request.requestId, attachments },
      }
    }),
  )
  statMock.mockReset()
  readFileMock.mockReset()
  writeFileMock.mockReset()
  renameMock.mockReset()
  rmMock.mockReset()
  realpathMock.mockReset()
  mkdirMock.mockReset()
  openMock.mockReset()
  readdirMock.mockReset()
  unlinkMock.mockReset()
  appGetPathMock.mockReset()
  broadcastToWindowsMock.mockReset()
  unpdfExtractTextMock.mockReset()
  ocrRecognizeMock.mockReset()
  mammothExtractMock.mockReset()
  jszipLoadAsyncMock.mockReset()
  showMessageBoxMock.mockReset()
  files.clear()
  registerDirectory('/tmp/repo')

  statMock.mockImplementation(async (filePath: string) => {
    const file = files.get(filePath)
    if (!file) {
      throw new Error(`ENOENT: ${filePath}`)
    }
    return {
      size: file.size,
      isFile: () => file.isFile,
      isDirectory: () => file.isDirectory,
      mtimeMs: file.mtimeMs,
    }
  })

  readFileMock.mockImplementation(async (filePath: string) => {
    const file = files.get(filePath)
    if (!file) {
      throw Object.assign(new Error(`ENOENT: ${filePath}`), { code: 'ENOENT' })
    }
    return file.content
  })
  writeFileMock.mockImplementation(async (filePath: string, content: string | Buffer) => {
    registerFile(filePath, content)
  })
  renameMock.mockImplementation(async (sourcePath: string, destinationPath: string) => {
    const source = files.get(sourcePath)
    if (!source) throw new Error(`ENOENT: ${sourcePath}`)
    files.set(destinationPath, source)
    files.delete(sourcePath)
  })
  rmMock.mockImplementation(async (filePath: string) => {
    files.delete(filePath)
  })

  realpathMock.mockImplementation(async (filePath: string) => {
    if (filePath === '/tmp/repo') return '/tmp/repo'
    const file = files.get(filePath)
    if (file) return filePath
    throw new Error(`ENOENT: ${filePath}`)
  })
  mkdirMock.mockResolvedValue(undefined)
  openMock.mockImplementation(async (filePath: string) =>
    createAttachmentFileHandle({ filePath, files, persistWrittenFile: registerFile }),
  )
  readdirMock.mockResolvedValue([])
  unlinkMock.mockImplementation(async (filePath: string) => {
    files.delete(filePath)
  })
  appGetPathMock.mockReturnValue('/tmp/user-data')

  unpdfExtractTextMock.mockResolvedValue({ text: 'Extracted PDF text' })
  ocrRecognizeMock.mockResolvedValue({ data: { text: 'OCR extracted text' } })
  mammothExtractMock.mockResolvedValue({ value: 'Extracted DOCX text' })
  showMessageBoxMock.mockResolvedValue({ response: 0 })
  jszipLoadAsyncMock.mockResolvedValue({
    file: (name: string) =>
      name === 'content.xml'
        ? {
            async: async () => '<text:p>Hello ODT</text:p>',
          }
        : null,
  })
}
