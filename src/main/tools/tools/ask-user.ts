import type { QuestionAnswer } from '@shared/types/question'
import { BrowserWindow } from 'electron'
import { z } from 'zod'
import { defineOpenHiveTool } from '../define-tool'
import { cancelQuestion, registerQuestion } from '../question-manager'

const questionOptionSchema = z.object({
  label: z.string().describe('Short display text for this option'),
  description: z.string().optional().describe('Explanation of what this option means'),
})

const userQuestionSchema = z.object({
  question: z
    .string()
    .describe('The question to ask the user — clear, specific, ending with a question mark'),
  options: z.array(questionOptionSchema).min(2).max(5).describe('Available choices (2-5 options)'),
})

export const askUserTool = defineOpenHiveTool({
  name: 'askUser',
  description:
    'Ask the user a question with clickable options. Use this only when a user preference is required to proceed and different answers lead to materially different implementation actions. Do not use for simple capability yes/no questions, terminology disambiguation, or generic taxonomy prompts. First provide a direct best-effort answer when possible. Present clear, concise questions with 2-5 options each. You can ask 1-4 questions at once.',
  needsApproval: false,
  inputSchema: z.object({
    questions: z
      .array(userQuestionSchema)
      .min(1)
      .max(4)
      .describe('Questions to present to the user (1-4)'),
  }),
  async execute(args, context) {
    const { conversationId, signal } = context

    // Emit the question event to the renderer
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send('agent:question', {
          conversationId,
          questions: args.questions,
        })
      }
    }

    // Block until the user answers or the run is aborted
    const answers = await new Promise<QuestionAnswer[]>((resolve, reject) => {
      registerQuestion(conversationId, resolve, reject)

      if (signal?.aborted) {
        cancelQuestion(conversationId)
        reject(new Error('Question cancelled'))
        return
      }

      signal?.addEventListener(
        'abort',
        () => {
          cancelQuestion(conversationId)
        },
        { once: true },
      )
    })

    return JSON.stringify({ answers })
  },
})
