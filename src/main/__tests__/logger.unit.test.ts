import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let createLogger: typeof import('../logger').createLogger
let getLogFilePath: typeof import('../logger').getLogFilePath
let initFileLogger: typeof import('../logger').initFileLogger
let drainFileLogger: typeof import('../logger').drainFileLogger

const mockLogsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openwaggle-log-test-'))

afterAll(() => {
  fs.rmSync(mockLogsDir, { recursive: true, force: true })
})

describe('file logger', () => {
  beforeEach(async () => {
    vi.stubEnv('OPENWAGGLE_LOG_LEVEL', 'info')
    // Clean log dir
    for (const f of fs.readdirSync(mockLogsDir)) {
      fs.rmSync(path.join(mockLogsDir, f), { recursive: true, force: true })
    }
    // Reset module to get a fresh FileWriter instance
    vi.resetModules()
    const mod = await import('../logger')
    createLogger = mod.createLogger
    getLogFilePath = mod.getLogFilePath
    initFileLogger = mod.initFileLogger
    drainFileLogger = mod.drainFileLogger
  })

  afterEach(async () => {
    // A test that logs without draining would otherwise write its batch after the next test
    // reset the module, recreating a file a prune test expects gone.
    await drainFileLogger()
    vi.useRealTimers()
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('writes log lines to file after flush', async () => {
    await initFileLogger(mockLogsDir)

    const logger = createLogger('test')
    logger.info('hello world')
    logger.warn('a warning', { key: 'val' })

    const logPath = getLogFilePath()
    expect(logPath).toContain('openwaggle-')
    expect(logPath).toMatch(/\.log$/)

    // Wait for async flush (process.nextTick + fs.appendFile)
    await new Promise((resolve) => setTimeout(resolve, 50))

    const content = fs.readFileSync(logPath, 'utf-8')
    expect(content).toContain('[test] hello world')
    expect(content).toContain('[test] a warning')
    expect(content).toContain('"key":"val"')
  })

  it('stamps each line with its UTC time and a Z, matching the UTC date of the file', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-25T16:54:22.855Z'))
    await initFileLogger(mockLogsDir, 'openwaggle-host')
    createLogger('host').info('zoned line')
    const consoleLine = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    createLogger('host').info('console line')

    await drainFileLogger()

    const file = path.join(mockLogsDir, 'openwaggle-host-2026-10-25.log')
    expect(getLogFilePath()).toBe(file)
    expect(fs.readFileSync(file, 'utf8')).toContain('16:54:22.855Z [host] zoned line\n')
    expect(consoleLine).toHaveBeenCalledWith('16:54:22.855Z [host] console line')
  })

  it('writes a line logged just before midnight UTC to that day, with its own time', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-25T23:59:59.999Z'))
    await initFileLogger(mockLogsDir, 'openwaggle-host')
    const logger = createLogger('host')
    logger.info('last line of the day')
    // The buffered batch is written after the day changed.
    vi.setSystemTime(new Date('2026-10-26T00:00:00.001Z'))
    logger.info('first line of the next day')

    await drainFileLogger()

    expect(fs.readFileSync(path.join(mockLogsDir, 'openwaggle-host-2026-10-25.log'), 'utf8')).toBe(
      '23:59:59.999Z [host] last line of the day\n',
    )
    expect(fs.readFileSync(path.join(mockLogsDir, 'openwaggle-host-2026-10-26.log'), 'utf8')).toBe(
      '00:00:00.001Z [host] first line of the next day\n',
    )
    expect(getLogFilePath()).toBe(path.join(mockLogsDir, 'openwaggle-host-2026-10-26.log'))
  })

  it('does not write to file before initFileLogger is called', async () => {
    const logger = createLogger('test')
    logger.info('should be console only')

    // No log file should exist
    const files = fs.readdirSync(mockLogsDir)
    expect(files.filter((f) => f.startsWith('openwaggle-'))).toHaveLength(0)
  })

  it('writes to a separate file stem for the detached Session Host', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-25T12:00:00Z'))
    await initFileLogger(mockLogsDir, 'openwaggle-host')
    createLogger('host').info('host line')

    expect(getLogFilePath()).toBe(path.join(mockLogsDir, 'openwaggle-host-2026-10-25.log'))
  })

  it('prunes old Session Host logs with the GUI logs, under one retention policy', async () => {
    // A fixed past day no other test logs to, so no late write can recreate or touch it.
    const oldDate = new Date('2026-01-04T12:00:00Z')
    const oldHostLog = path.join(mockLogsDir, 'openwaggle-host-2026-01-04.log')
    fs.writeFileSync(oldHostLog, 'old host log')
    fs.utimesSync(oldHostLog, oldDate, oldDate)

    await initFileLogger(mockLogsDir)

    expect(fs.existsSync(oldHostLog)).toBe(false)
  })

  it('drains buffered lines to the file before a process exits', async () => {
    await initFileLogger(mockLogsDir, 'openwaggle-host')
    createLogger('host').error('fatal before exit')

    await drainFileLogger()

    expect(fs.readFileSync(getLogFilePath(), 'utf8')).toContain('fatal before exit')
  })

  it('names the current day even when nothing was logged since midnight', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-25T23:59:00Z'))
    await initFileLogger(mockLogsDir)
    vi.setSystemTime(new Date('2026-09-26T00:01:00Z'))

    expect(getLogFilePath()).toBe(path.join(mockLogsDir, 'openwaggle-2026-09-26.log'))
    vi.useRealTimers()
  })

  it('getLogFilePath returns correct date-based path', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-25T12:00:00Z'))
    await initFileLogger(mockLogsDir)
    createLogger('init').info('init')

    expect(getLogFilePath()).toContain('openwaggle-2026-10-25.log')
  })

  it('prunes old log files on init', async () => {
    // An old log file from a fixed past day no other test logs to.
    const oldFile = path.join(mockLogsDir, 'openwaggle-2026-01-04.log')
    fs.writeFileSync(oldFile, 'old log content')
    const oldDate = new Date('2026-01-04T12:00:00Z')
    fs.utimesSync(oldFile, oldDate, oldDate)

    // Trigger logger init and await pruning completion
    await initFileLogger(mockLogsDir)
    createLogger('prune').info('trigger init')

    // Old file should be pruned
    expect(fs.existsSync(oldFile)).toBe(false)
  })

  it('reports append failures to stderr fallback', async () => {
    const stderrWriteSpy = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    vi.spyOn(fs, 'appendFile').mockImplementation((_path, _data, callback) => {
      callback(new Error('append failed'))
      return undefined
    })

    await initFileLogger(mockLogsDir)
    createLogger('test').info('trigger append failure')

    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(stderrWriteSpy).toHaveBeenCalledWith(
      expect.stringContaining('[file-logger] failed to append log batch'),
    )
  })

  it('reports init failures to stderr fallback', async () => {
    const stderrWriteSpy = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    const occupiedPath = path.join(mockLogsDir, 'occupied-path')
    fs.writeFileSync(occupiedPath, 'occupied')

    await initFileLogger(occupiedPath)

    expect(stderrWriteSpy).toHaveBeenCalledWith(
      expect.stringContaining('[file-logger] failed to initialize log directory'),
    )

    stderrWriteSpy.mockClear()
    createLogger('test').info('should not keep retrying a failed init')

    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(stderrWriteSpy).not.toHaveBeenCalled()
  })

  it('suppresses debug logs when the configured level is info', async () => {
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {})
    await initFileLogger(mockLogsDir)

    createLogger('test').debug('hidden debug log')

    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(debugSpy).not.toHaveBeenCalled()
    expect(fs.existsSync(getLogFilePath())).toBe(false)
  })
})
