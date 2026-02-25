import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let createLogger: typeof import('./logger').createLogger
let getLogFilePath: typeof import('./logger').getLogFilePath
let initFileLogger: typeof import('./logger').initFileLogger

const mockLogsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openwaggle-log-test-'))

describe('file logger', () => {
  beforeEach(async () => {
    // Clean log dir
    for (const f of fs.readdirSync(mockLogsDir)) {
      fs.unlinkSync(path.join(mockLogsDir, f))
    }
    // Reset module to get a fresh FileWriter instance
    vi.resetModules()
    const mod = await import('./logger')
    createLogger = mod.createLogger
    getLogFilePath = mod.getLogFilePath
    initFileLogger = mod.initFileLogger
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('writes log lines to file after flush', async () => {
    initFileLogger(mockLogsDir)

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

  it('does not write to file before initFileLogger is called', async () => {
    const logger = createLogger('test')
    logger.info('should be console only')

    // No log file should exist
    const files = fs.readdirSync(mockLogsDir)
    expect(files.filter((f) => f.startsWith('openwaggle-'))).toHaveLength(0)
  })

  it('getLogFilePath returns correct date-based path', () => {
    initFileLogger(mockLogsDir)
    createLogger('init').info('init')

    const logPath = getLogFilePath()
    const dateStr = new Date().toISOString().slice(0, 10)
    expect(logPath).toContain(`openwaggle-${dateStr}.log`)
  })

  it('prunes old log files on init', async () => {
    // Create an old log file (4 days ago)
    const oldDate = new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    const oldFile = path.join(mockLogsDir, `openwaggle-${oldDate}.log`)
    fs.writeFileSync(oldFile, 'old log content')
    // Set mtime to 4 days ago
    const fourDaysAgo = new Date(Date.now() - 4 * 24 * 60 * 60 * 1000)
    fs.utimesSync(oldFile, fourDaysAgo, fourDaysAgo)

    // Trigger logger init (which prunes)
    initFileLogger(mockLogsDir)
    createLogger('prune').info('trigger init')

    // Old file should be pruned
    expect(fs.existsSync(oldFile)).toBe(false)
  })
})
