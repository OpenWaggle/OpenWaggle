import fs from 'node:fs/promises'
import path from 'node:path'
import { ATTACHMENT } from '@shared/constants/resource-limits'
import { Schema } from '@shared/schema'
import { defineOpenWaggleTool, resolvePath } from '../define-tool'
import { buildFileMutationResult } from './file-mutation-result'

const writeFileArgsSchema = Schema.Struct({
  path: Schema.String.annotations({
    description: 'File path relative to the project root, or an absolute path',
  }),
  content: Schema.optional(
    Schema.NullOr(
      Schema.String.annotations({
        description:
          'Content to write to the file. Prefer attachmentName for large attachment content.',
      }),
    ),
  ),
  attachmentName: Schema.optional(
    Schema.NullOr(
      Schema.String.annotations({
        description:
          'Optional attachment name to write from the current user message (for example "Pasted Text 1.md").',
      }),
    ),
  ),
})

function resolveContentFromAttachment(
  attachmentName: string | null | undefined,
  attachments: readonly { name: string; extractedText: string }[],
): string {
  if (attachments.length === 0) {
    throw new Error('No message attachments are available for writeFile.')
  }

  if (attachmentName) {
    const attachment = attachments.find((candidate) => candidate.name === attachmentName)
    if (!attachment) {
      const names = attachments
        .map((candidate) => candidate.name)
        .slice(0, ATTACHMENT.MAX_LIST_PREVIEW)
      const suffix = attachments.length > ATTACHMENT.MAX_LIST_PREVIEW ? ', ...' : ''
      throw new Error(
        `Attachment "${attachmentName}" not found. Available attachments: ${names.join(', ')}${suffix}`,
      )
    }
    return attachment.extractedText
  }

  if (attachments.length === 1) {
    return attachments[0]?.extractedText ?? ''
  }

  throw new Error(
    'Multiple attachments are available. Provide attachmentName when calling writeFile without content.',
  )
}

export const writeFileTool = defineOpenWaggleTool({
  name: 'writeFile',
  description:
    'Write content to a file at the given path. Creates the file and any parent directories if they do not exist, and overwrites the file if it already exists. For large user attachments, prefer passing attachmentName (or only path when exactly one attachment is present) instead of embedding full text in content.',
  needsApproval: true,
  inputSchema: writeFileArgsSchema,
  async execute(args, context) {
    const filePath = resolvePath(context.projectPath, args.path)
    await fs.mkdir(path.dirname(filePath), { recursive: true })

    let beforeContent = ''
    try {
      beforeContent = await fs.readFile(filePath, 'utf-8')
    } catch {
      // File doesn't exist yet — before is empty
    }

    const content =
      args.content ?? resolveContentFromAttachment(args.attachmentName, context.attachments ?? [])

    await fs.writeFile(filePath, content, 'utf-8')

    return buildFileMutationResult({
      path: args.path,
      beforeContent,
      afterContent: content,
      verb: 'written',
    })
  },
})
