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
import { SymbolMentionChip } from './SymbolMentionChip'

export type SymbolKind = 'function' | 'class' | 'type'

export type SerializedSymbolMentionNode = Spread<
  { symbolName: string; filePath: string; kind: SymbolKind },
  SerializedLexicalNode
>

export class SymbolMentionNode extends DecoratorNode<ReactNode> {
  __symbolName: string
  __filePath: string
  __kind: SymbolKind

  static getType() {
    return 'symbol-mention'
  }

  static clone(node: SymbolMentionNode) {
    return new SymbolMentionNode(node.__symbolName, node.__filePath, node.__kind, node.__key)
  }

  constructor(symbolName: string, filePath: string, kind: SymbolKind, key?: NodeKey) {
    super(key)
    this.__symbolName = symbolName
    this.__filePath = filePath
    this.__kind = kind
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
    element.textContent = `@#${this.__symbolName}`
    return { element }
  }

  static importDOM() {
    return null
  }

  static importJSON(serializedNode: SerializedSymbolMentionNode) {
    return $createSymbolMentionNode(
      serializedNode.symbolName,
      serializedNode.filePath,
      serializedNode.kind,
    )
  }

  exportJSON() {
    return {
      ...super.exportJSON(),
      symbolName: this.__symbolName,
      filePath: this.__filePath,
      kind: this.__kind,
      type: 'symbol-mention',
      version: 1,
    }
  }

  getTextContent() {
    return `@#${this.__symbolName}`
  }

  isInline() {
    return true
  }

  decorate(): ReactNode {
    return createElement(SymbolMentionChip, {
      symbolName: this.__symbolName,
      kind: this.__kind,
    })
  }
}

export function $createSymbolMentionNode(
  symbolName: string,
  filePath: string,
  kind: SymbolKind,
): SymbolMentionNode {
  return $applyNodeReplacement(new SymbolMentionNode(symbolName, filePath, kind))
}
