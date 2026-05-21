import * as Effect from 'effect/Effect'
import { vi } from 'vitest'
import type * as AttachmentsHandler from '../attachments-handler'

type TestMock = ReturnType<typeof vi.fn>

interface AttachmentFileFixture {
  readonly size: number
  readonly content: Buffer
  readonly isFile: boolean
  readonly isDirectory: boolean
  readonly mtimeMs: number
}

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
  files: new Map<string, AttachmentFileFixture>(),
}))

export const typedHandleMock: TestMock = mocks.typedHandleMock
export const createLoggerMock: TestMock = mocks.createLoggerMock
export const attachmentsLoggerMock: AttachmentHandlerMocks['attachmentsLoggerMock'] =
  mocks.attachmentsLoggerMock
export const statMock: TestMock = mocks.statMock
export const readFileMock: TestMock = mocks.readFileMock
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
export const files: Map<string, AttachmentFileFixture> = mocks.files

vi.mock('../typed-ipc', () => ({
  typedHandle: typedHandleMock,
}))

vi.mock('../../logger', () => ({
  createLogger: createLoggerMock.mockImplementation(() => attachmentsLoggerMock),
}))

vi.mock('node:fs/promises', () => ({
  default: {
    stat: statMock,
    readFile: readFileMock,
    realpath: realpathMock,
    mkdir: mkdirMock,
    open: openMock,
    readdir: readdirMock,
    unlink: unlinkMock,
  },
  stat: statMock,
  readFile: readFileMock,
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
  statMock.mockReset()
  readFileMock.mockReset()
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
      throw new Error(`ENOENT: ${filePath}`)
    }
    return file.content
  })

  realpathMock.mockImplementation(async (filePath: string) => {
    if (filePath === '/tmp/repo') return '/tmp/repo'
    const file = files.get(filePath)
    if (file) return filePath
    throw new Error(`ENOENT: ${filePath}`)
  })
  mkdirMock.mockResolvedValue(undefined)
  openMock.mockImplementation(async (filePath: string) => {
    let output = Buffer.alloc(0)
    return {
      write: async (buffer: Buffer, offset: number, length: number, position: number) => {
        const chunk = Buffer.from(buffer.subarray(offset, offset + length))
        const requiredBytes = position + chunk.length
        if (output.length < requiredBytes) {
          const grown = Buffer.alloc(requiredBytes)
          output.copy(grown)
          output = grown
        }
        chunk.copy(output, position)
        return { bytesWritten: chunk.length, buffer: chunk }
      },
      close: async () => {
        registerFile(filePath, Buffer.from(output))
      },
    }
  })
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
