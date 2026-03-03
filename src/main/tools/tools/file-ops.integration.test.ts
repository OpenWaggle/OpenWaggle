import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { ConversationId } from '@shared/types/brand'
import { afterEach, describe, expect, it } from 'vitest'
import { runWithToolContext, type ToolContext } from '../define-tool'
import { editFileTool } from './edit-file'
import { runCommandTool } from './run-command'
import { writeFileTool } from './write-file'

const TEMP_DIRECTORY_PREFIX = 'openwaggle-file-ops-integration-'
const TEST_FILE_PATH = 'fixtures/sample.md'
const INITIAL_FILE_CONTENT = '# Sample\nOriginal line'
const UPDATED_LINE = 'Updated line'
const UPDATED_FILE_CONTENT = '# Sample\nUpdated line'
const VERIFY_OUTPUT_TOKEN = 'VERIFY_OK'
const DELETE_OUTPUT_TOKEN = 'DELETE_OK'
const ATTACHMENT_FILE_PATH = 'fixtures/from-attachment.md'
const ATTACHMENT_CONTENT = 'Attachment content line'
const SIZE_OUTPUT_PREFIX = 'SIZE='

const temporaryDirectories: string[] = []

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function getToolExecutor<TArgs>(
  tool: { execute?: (args: TArgs) => Promise<unknown> },
  toolName: string,
): (args: TArgs) => Promise<unknown> {
  if (!tool.execute) {
    throw new Error(`Missing execute() for ${toolName}`)
  }
  return tool.execute
}

function extractTextResult(result: unknown): string {
  if (typeof result === 'string') {
    return result
  }

  if (isRecord(result) && result.kind === 'text' && typeof result.text === 'string') {
    return result.text
  }

  if (isRecord(result) && result.kind === 'json') {
    return JSON.stringify(result.data)
  }

  throw new Error(`Unexpected text result shape: ${String(result)}`)
}

function extractJsonResult(result: unknown): Record<string, unknown> {
  if (typeof result === 'string') {
    const parsed: unknown = JSON.parse(result)
    if (isRecord(parsed)) {
      return parsed
    }
    throw new Error('Expected parsed string result to be a JSON object')
  }

  if (isRecord(result) && result.kind === 'json' && isRecord(result.data)) {
    return result.data
  }

  throw new Error(`Unexpected json result shape: ${String(result)}`)
}

async function makeTempDirectory(): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), TEMP_DIRECTORY_PREFIX))
  temporaryDirectories.push(directory)
  return directory
}

function makeContext(
  projectPath: string,
  attachments: readonly { name: string; extractedText: string }[] = [],
): ToolContext {
  return {
    conversationId: ConversationId('test-conversation'),
    projectPath,
    signal: new AbortController().signal,
    attachments,
  }
}

async function executeWriteFile(
  args: { path: string; content?: string; attachmentName?: string },
  context: ToolContext,
): Promise<Record<string, unknown>> {
  const execute = getToolExecutor(writeFileTool, 'writeFile')
  const result = await runWithToolContext(context, () => execute(args))
  return extractJsonResult(result)
}

async function executeEditFile(
  args: { path: string; oldString: string; newString: string },
  context: ToolContext,
): Promise<Record<string, unknown>> {
  const execute = getToolExecutor(editFileTool, 'editFile')
  const result = await runWithToolContext(context, () => execute(args))
  return extractJsonResult(result)
}

async function executeRunCommand(
  args: { command: string; timeout?: number },
  context: ToolContext,
): Promise<string> {
  const execute = getToolExecutor(runCommandTool, 'runCommand')
  const result = await runWithToolContext(context, () => execute(args))
  return extractTextResult(result)
}

describe('file operation integration contract', () => {
  afterEach(async () => {
    for (const directory of temporaryDirectories.splice(0)) {
      await fs.rm(directory, { recursive: true, force: true })
    }
  })

  it('supports write -> edit -> runCommand verify -> runCommand delete sequence', async () => {
    const directory = await makeTempDirectory()
    const context = makeContext(directory)

    const writeResult = await executeWriteFile(
      { path: TEST_FILE_PATH, content: INITIAL_FILE_CONTENT },
      context,
    )
    expect(writeResult.message).toBe(`File written: ${TEST_FILE_PATH}`)

    const writtenContent = await fs.readFile(path.join(directory, TEST_FILE_PATH), 'utf-8')
    expect(writtenContent).toBe(INITIAL_FILE_CONTENT)

    const editResult = await executeEditFile(
      { path: TEST_FILE_PATH, oldString: 'Original line', newString: UPDATED_LINE },
      context,
    )
    expect(editResult.message).toBe(`File edited: ${TEST_FILE_PATH}`)

    const editedContent = await fs.readFile(path.join(directory, TEST_FILE_PATH), 'utf-8')
    expect(editedContent).toBe(UPDATED_FILE_CONTENT)

    const verifyCommand = [
      'node -e "',
      `const fs=require('node:fs');`,
      `const text=fs.readFileSync('${TEST_FILE_PATH}','utf8');`,
      `if(!text.includes('${UPDATED_LINE}')){process.exit(1);}`,
      `console.log('${VERIFY_OUTPUT_TOKEN}');`,
      '"',
    ].join('')
    const verifyOutput = await executeRunCommand({ command: verifyCommand }, context)
    expect(verifyOutput).toContain(VERIFY_OUTPUT_TOKEN)

    const deleteCommand = [
      'node -e "',
      `const fs=require('node:fs');`,
      `fs.rmSync('${TEST_FILE_PATH}',{force:true});`,
      `console.log(fs.existsSync('${TEST_FILE_PATH}')?'DELETE_FAILED':'${DELETE_OUTPUT_TOKEN}');`,
      '"',
    ].join('')
    const deleteOutput = await executeRunCommand({ command: deleteCommand }, context)
    expect(deleteOutput).toContain(DELETE_OUTPUT_TOKEN)

    await expect(fs.stat(path.join(directory, TEST_FILE_PATH))).rejects.toThrow()
  })

  it('writes from attachment context without embedding huge content args', async () => {
    const directory = await makeTempDirectory()
    const context = makeContext(directory, [
      { name: 'Pasted Text 1.md', extractedText: ATTACHMENT_CONTENT },
    ])

    const writeResult = await executeWriteFile({ path: ATTACHMENT_FILE_PATH }, context)
    expect(writeResult.message).toBe(`File written: ${ATTACHMENT_FILE_PATH}`)

    const attachmentContent = await fs.readFile(path.join(directory, ATTACHMENT_FILE_PATH), 'utf-8')
    expect(attachmentContent).toBe(ATTACHMENT_CONTENT)

    const sizeCommand = [
      'node -e "',
      `const fs=require('node:fs');`,
      `const value=fs.readFileSync('${ATTACHMENT_FILE_PATH}','utf8').length;`,
      `console.log('${SIZE_OUTPUT_PREFIX}'+String(value));`,
      '"',
    ].join('')
    const sizeOutput = await executeRunCommand({ command: sizeCommand }, context)
    expect(sizeOutput).toContain(`${SIZE_OUTPUT_PREFIX}${String(ATTACHMENT_CONTENT.length)}`)
  })
})
