import type { WagglePreset } from '@shared/types/waggle'
import type { LexicalEditor } from 'lexical'
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isElementNode,
  $isRangeSelection,
  $isTextNode,
  $nodesOfType,
} from 'lexical'
import { $createSkillMentionNode } from '../components/nodes/SkillMentionNode'
import { $createWaggleMentionNode, WaggleMentionNode } from '../components/nodes/WaggleMentionNode'
import { useComposerStore } from '../state/composer-store'
import { findSlashCommandMatch, replaceSlashCommandMatch } from './slash-command'

export function insertTextAtEditorOrStore(
  editor: LexicalEditor | null,
  text: string,
  setInput: (value: string) => void,
) {
  if (!editor) {
    const store = useComposerStore.getState()
    setInput(store.input + text)
    return
  }

  editor.update(() => {
    const root = $getRoot()
    root.selectEnd()
    const lastChild = root.getLastChild()
    const paragraph = lastChild && $isElementNode(lastChild) ? lastChild : $createParagraphNode()
    if (!lastChild || !$isElementNode(lastChild)) {
      root.append(paragraph)
    }
    paragraph.append($createTextNode(text))
    root.selectEnd()
  })
}

/** Insert a composer-native invocation character at the caret without creating another draft path. */
export function insertComposerInvocation(invocation: '@' | '/') {
  const store = useComposerStore.getState()
  const editor = store.lexicalEditor
  if (!editor) {
    const index = Math.max(0, Math.min(store.cursorIndex, store.input.length))
    store.setInput(`${store.input.slice(0, index)}${invocation}${store.input.slice(index)}`)
    store.setCursorIndex(index + 1)
    return
  }

  editor.update(() => {
    const selection = $getSelection()
    if ($isRangeSelection(selection)) {
      selection.insertText(invocation)
      return
    }
    const root = $getRoot()
    root.selectEnd()
    const lastChild = root.getLastChild()
    const paragraph = lastChild && $isElementNode(lastChild) ? lastChild : $createParagraphNode()
    if (!lastChild || !$isElementNode(lastChild)) root.append(paragraph)
    paragraph.append($createTextNode(invocation))
    root.selectEnd()
  })
  editor.focus()
}

export function insertSkillReferenceAtActiveSlash(skillId: string, skillName: string) {
  const store = useComposerStore.getState()
  if (!store.lexicalEditor) {
    replaceSlashCommandInStore(`/${skillId}`, true)
    return
  }

  store.lexicalEditor.update(() => {
    const activeSlash = readActiveSlashTextNode()
    if (!activeSlash) return

    const { textNode, match } = activeSlash
    const text = textNode.getTextContent()
    const before = text.slice(0, match.startOffset)
    const after = text.slice(match.endOffset)
    const trailingTextContent = after.startsWith(' ') ? after : ` ${after}`
    const cursorOffset = trailingTextContent.length > 0 ? 1 : 0
    const mentionNode = $createSkillMentionNode(skillId, skillName)
    const trailingTextNode = $createTextNode(trailingTextContent)

    if (before) {
      textNode.setTextContent(before)
      textNode.insertAfter(mentionNode)
    } else {
      textNode.replace(mentionNode)
    }
    mentionNode.insertAfter(trailingTextNode)
    trailingTextNode.select(cursorOffset, cursorOffset)
  })

  store.lexicalEditor.focus()
}

export function insertWagglePresetAtActiveSlash(preset: WagglePreset) {
  const store = useComposerStore.getState()
  if (!store.lexicalEditor) {
    consumeActiveSlashCommand()
    store.setSelectedWagglePreset(preset)
    return
  }

  store.lexicalEditor.update(() => {
    const activeSlash = readActiveSlashTextNode()
    if (!activeSlash) return

    for (const existing of $nodesOfType(WaggleMentionNode)) existing.remove()
    const { textNode, match } = activeSlash
    const text = textNode.getTextContent()
    const before = text.slice(0, match.startOffset)
    const after = text.slice(match.endOffset)
    const trailingTextContent =
      after.startsWith(' ') || before.endsWith(' ') || !after ? after : ` ${after}`
    const cursorOffset = trailingTextContent.length > 0 ? 1 : 0
    const mentionNode = $createWaggleMentionNode(preset)
    const trailingTextNode = $createTextNode(trailingTextContent)

    if (before) {
      textNode.setTextContent(before)
      textNode.insertAfter(mentionNode)
    } else {
      textNode.replace(mentionNode)
    }
    mentionNode.insertAfter(trailingTextNode)
    trailingTextNode.select(cursorOffset, cursorOffset)
  })

  store.setSelectedWagglePreset(preset)
  store.lexicalEditor.focus()
}

export function insertSlashCommandTextAtActiveSlash(command: string) {
  replaceActiveSlashCommand(command, true)
}

export function consumeActiveSlashCommand() {
  replaceActiveSlashCommand('', false)
}

function replaceActiveSlashCommand(replacement: string, ensureTrailingSpace: boolean) {
  const store = useComposerStore.getState()
  if (!store.lexicalEditor) {
    replaceSlashCommandInStore(replacement, ensureTrailingSpace)
    return
  }

  store.lexicalEditor.update(() => {
    const activeSlash = readActiveSlashTextNode()
    if (!activeSlash) return

    const { textNode, match } = activeSlash
    const next = replaceSlashCommandMatch(
      textNode.getTextContent(),
      match,
      replacement,
      ensureTrailingSpace,
    )
    textNode.setTextContent(next.text)
    textNode.select(next.cursorOffset, next.cursorOffset)
  })

  store.lexicalEditor.focus()
}

function replaceSlashCommandInStore(replacement: string, ensureTrailingSpace: boolean) {
  const store = useComposerStore.getState()
  const match =
    findSlashCommandMatch(store.input, store.cursorIndex) ??
    findSlashCommandMatch(store.input, store.input.length)
  if (!match) return

  const next = replaceSlashCommandMatch(store.input, match, replacement, ensureTrailingSpace)
  store.setInput(next.text)
  store.setCursorIndex(next.cursorOffset)
}

function readActiveSlashTextNode() {
  const selection = $getSelection()
  if (!$isRangeSelection(selection) || !selection.isCollapsed()) return null

  const textNode = selection.anchor.getNode()
  if (!$isTextNode(textNode)) return null

  const match = findSlashCommandMatch(textNode.getTextContent(), selection.anchor.offset)
  return match ? { textNode, match } : null
}
