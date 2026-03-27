import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import {
  $createTextNode,
  $isTextNode,
  COMMAND_PRIORITY_NORMAL,
  PASTE_COMMAND,
  TextNode,
} from 'lexical'
import { useEffect } from 'react'
import { $createURLMentionNode } from '../nodes/URLMentionNode'

const URL_REGEX = /https?:\/\/[^\s]+/g

/**
 * Detects URLs in pasted text and during typing, converting them to URLMentionNodes.
 *
 * Paste: scans pasted text for URLs and inserts URLMentionNode for each.
 * Typing: uses a text node transform to detect when a space/Enter follows a URL pattern.
 */
export function URLDetectPlugin(): null {
  const [editor] = useLexicalComposerContext()

  // Paste detection — lower priority than PastePlugin (which handles long-paste auto-attachment)
  useEffect(() => {
    return editor.registerCommand<ClipboardEvent>(
      PASTE_COMMAND,
      (event) => {
        const clipboardData = event instanceof ClipboardEvent ? event.clipboardData : null
        if (!clipboardData) return false

        const pastedText = clipboardData.getData('text/plain')
        if (!pastedText) return false

        // Only handle if text contains URLs
        const urls = pastedText.match(URL_REGEX)
        if (!urls || urls.length === 0) return false

        // Split text around URLs and build nodes
        event.preventDefault()
        editor.update(() => {
          const parts = splitTextByUrls(pastedText)
          for (const part of parts) {
            if (part.type === 'url') {
              const urlNode = $createURLMentionNode(part.text)
              urlNode.selectEnd()
              continue
            }
            if (part.text) {
              const textNode = $createTextNode(part.text)
              textNode.selectEnd()
            }
          }
        })

        return true
      },
      COMMAND_PRIORITY_NORMAL,
    )
  }, [editor])

  // Typing detection — text node transform
  useEffect(() => {
    return editor.registerNodeTransform(TextNode, (textNode) => {
      if (!$isTextNode(textNode)) return

      const text = textNode.getTextContent()
      // Only trigger when text ends with a space (user just finished typing a word)
      if (!text.endsWith(' ')) return

      const match = findTrailingUrl(text)
      if (!match) return

      const { url, startIndex } = match
      const beforeUrl = text.slice(0, startIndex)
      const afterUrl = text.slice(startIndex + url.length)

      // Replace: text before URL + URLMentionNode + text after URL
      if (beforeUrl) {
        textNode.setTextContent(beforeUrl)
      } else {
        textNode.remove()
      }

      const urlNode = $createURLMentionNode(url)
      const trailingNode = $createTextNode(afterUrl)

      if (beforeUrl) {
        textNode.insertAfter(urlNode)
      } else {
        const parent = textNode.getParent()
        if (parent) {
          parent.append(urlNode)
        }
      }
      urlNode.insertAfter(trailingNode)
      trailingNode.selectEnd()
    })
  }, [editor])

  return null
}

interface TextPart {
  type: 'text' | 'url'
  text: string
}

function splitTextByUrls(text: string): TextPart[] {
  const parts: TextPart[] = []
  let lastIndex = 0

  for (const match of text.matchAll(URL_REGEX)) {
    const matchIndex = match.index
    if (matchIndex > lastIndex) {
      parts.push({ type: 'text', text: text.slice(lastIndex, matchIndex) })
    }
    parts.push({ type: 'url', text: match[0] })
    lastIndex = matchIndex + match[0].length
  }

  if (lastIndex < text.length) {
    parts.push({ type: 'text', text: text.slice(lastIndex) })
  }

  return parts
}

function findTrailingUrl(text: string): { url: string; startIndex: number } | null {
  // Look for a URL that ends right before the trailing space
  const trimmed = text.trimEnd()
  const words = trimmed.split(/\s/)
  const lastWord = words[words.length - 1]
  if (!lastWord) return null

  const urlMatch = lastWord.match(/^https?:\/\/\S+$/)
  if (!urlMatch) return null

  const startIndex = trimmed.lastIndexOf(lastWord)
  return { url: lastWord, startIndex }
}
