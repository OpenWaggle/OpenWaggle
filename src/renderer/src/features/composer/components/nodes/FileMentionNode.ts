import {
  $applyNodeReplacement,
  DecoratorNode,
  type DOMExportOutput,
  type EditorConfig,
  type NodeKey,
  type SerializedLexicalNode,
  type Spread,
} from 'lexical'
import type { ReactNode } from 'react'
import { createElement } from 'react'
import { FileMentionChip } from './FileMentionChip'

export type SerializedFileMentionNode = Spread<
  { mentionPath: string; mentionBasename: string },
  SerializedLexicalNode
>

export class FileMentionNode extends DecoratorNode<ReactNode> {
  __path: string
  __basename: string

  static getType() {
    return 'file-mention'
  }

  static clone(node: FileMentionNode) {
    return new FileMentionNode(node.__path, node.__basename, node.__key)
  }

  constructor(filePath: string, basename: string, key?: NodeKey) {
    super(key)
    this.__path = filePath
    this.__basename = basename
  }

  createDOM(_config: EditorConfig) {
    const span = document.createElement('span')
    span.style.display = 'inline'
    return span
  }

  updateDOM() {
    return false
  }

  exportDOM(): DOMExportOutput {
    const element = document.createElement('span')
    element.textContent = `@${this.__path}`
    return { element }
  }

  static importDOM() {
    return null
  }

  static importJSON(serializedNode: SerializedFileMentionNode) {
    return $createFileMentionNode(serializedNode.mentionPath, serializedNode.mentionBasename)
  }

  exportJSON() {
    return {
      ...super.exportJSON(),
      mentionPath: this.__path,
      mentionBasename: this.__basename,
      type: 'file-mention',
      version: 1,
    }
  }

  getTextContent() {
    return `@${this.__path}`
  }

  isInline() {
    return true
  }

  decorate(): ReactNode {
    return createElement(FileMentionChip, {
      path: this.__path,
      basename: this.__basename,
    })
  }
}

export function $createFileMentionNode(filePath: string, basename: string): FileMentionNode {
  return $applyNodeReplacement(new FileMentionNode(filePath, basename))
}
