/**
 * Builds the bounded history a Title refinement or regeneration reads.
 *
 * Ported from T3 Code (`apps/server/src/textGeneration/ThreadTitleContext.ts`,
 * https://github.com/pingdotgg/t3code, MIT License, Copyright (c) 2026 T3 Tools Inc.) per ADR 0043.
 * User intent is reserved space before assistant findings, in conversation order.
 */

import { getMessageText, type Message } from '@shared/types/agent'
import { limitTitleMessage } from './session-title-text'

export interface SessionTitleContextAttachment {
  readonly id: string
  readonly name: string
  readonly mimeType: string
}

export interface SessionTitleContextMessage {
  readonly role: 'user' | 'assistant' | 'system'
  readonly text: string
  readonly attachments: readonly SessionTitleContextAttachment[]
}

const MAX_CONTEXT = 8_000
const MAX_MESSAGE = 2_000
/** Space kept for assistant output, which can never evict user messages. */
const ASSISTANT_RESERVE = 2_000
const SECTION_SEPARATOR_LENGTH = 2
const OMITTED = '[Earlier content truncated]\n\n'
const RECENT_ATTACHMENT_LIMIT = 4

/** Reasoning and tool traces are working notes, not what the Session is about, so they are dropped. */
export function toSessionTitleContextMessage(message: Message): SessionTitleContextMessage {
  return {
    role: message.role,
    text: getMessageText(message),
    attachments: message.parts.flatMap((part) =>
      part.type === 'attachment'
        ? [
            {
              id: part.attachment.id,
              name: part.attachment.name,
              mimeType: part.attachment.mimeType,
            },
          ]
        : [],
    ),
  }
}

interface Section {
  readonly index: number
  readonly message: SessionTitleContextMessage
  readonly prefix: string
}

function sectionContents(section: Section) {
  const names = section.message.attachments.map((attachment) => attachment.name).join(', ')
  return [section.message.text.trim(), ...(names ? [`[Attachments: ${names}]`] : [])]
    .filter(Boolean)
    .join('\n')
}

export function formatSessionTitleContext(messages: readonly SessionTitleContextMessage[]) {
  const sections: Section[] = messages.flatMap((message, index) =>
    message.role === 'system' || (!message.text.trim() && message.attachments.length === 0)
      ? []
      : [{ index, message, prefix: `${message.role.toUpperCase()}:\n` }],
  )
  const contents = new Map(sections.map((section) => [section.index, sectionContents(section)]))
  const contentsFor = (section: Section) => contents.get(section.index) ?? ''
  const selected = new Map<number, string>()
  let remaining = MAX_CONTEXT - OMITTED.length
  const add = (section: Section, budget: number) => {
    if (selected.has(section.index)) return
    const limit = Math.min(budget, remaining) - section.prefix.length - SECTION_SEPARATOR_LENGTH
    if (limit <= 0) return
    const limited = limitTitleMessage(contentsFor(section), limit)
    if (!limited) return
    const text = section.prefix + limited
    selected.set(section.index, text)
    remaining -= text.length + SECTION_SEPARATOR_LENGTH
  }

  const newestFirst = [...sections].reverse()
  const firstUser = sections.find((section) => section.message.role === 'user')
  if (firstUser) add(firstUser, MAX_MESSAGE)
  for (const section of newestFirst) {
    if (section.message.role === 'user') {
      add(section, Math.min(MAX_MESSAGE, remaining - ASSISTANT_RESERVE))
    }
  }
  for (const section of newestFirst) {
    if (section.message.role === 'assistant') add(section, MAX_MESSAGE)
  }
  // Use spare space when the conversation has only a few messages.
  for (const role of ['user', 'assistant'] as const) {
    for (const section of newestFirst) {
      const previous = selected.get(section.index)
      if (section.message.role !== role || previous === undefined) continue
      const expanded =
        section.prefix +
        limitTitleMessage(contentsFor(section), previous.length + remaining - section.prefix.length)
      remaining -= expanded.length - previous.length
      selected.set(section.index, expanded)
    }
  }

  const retained = sections.filter((section) => selected.has(section.index))
  const truncated = retained.some(
    (section) => selected.get(section.index) !== section.prefix + contentsFor(section),
  )
  const attachments = retained.flatMap((section) => section.message.attachments)
  const firstAttachment = firstUser?.message.attachments[0]
  const recentAttachments = attachments.filter(
    (attachment) => attachment.id !== firstAttachment?.id,
  )
  return {
    message: `${truncated || retained.length < sections.length ? OMITTED : ''}${retained
      .map((section) => selected.get(section.index))
      .join('\n\n')}`,
    attachments: [
      ...(firstAttachment ? [firstAttachment] : []),
      ...recentAttachments.slice(
        firstAttachment ? -(RECENT_ATTACHMENT_LIMIT - 1) : -RECENT_ATTACHMENT_LIMIT,
      ),
    ],
  }
}
