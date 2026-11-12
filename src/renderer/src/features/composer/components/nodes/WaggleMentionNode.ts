import { WagglePresetId } from '@shared/types/brand'
import type { WagglePreset } from '@shared/types/waggle'
import {
  $applyNodeReplacement,
  DecoratorNode,
  type EditorConfig,
  type NodeKey,
  type SerializedLexicalNode,
  type Spread,
} from 'lexical'
import { createElement, type ReactNode } from 'react'
import { WaggleMentionChip } from './WaggleMentionChip'

export type SerializedWaggleMentionNode = Spread<
  {
    presetId: string
    presetName: string
    presetDescription: string
    presetConfig: WagglePreset['config']
    presetIsBuiltIn: boolean
    presetCreatedAt: number
    presetUpdatedAt: number
  },
  SerializedLexicalNode
>

export class WaggleMentionNode extends DecoratorNode<ReactNode> {
  __preset: WagglePreset

  static override getType() {
    return 'waggle-mention'
  }

  static override clone(node: WaggleMentionNode) {
    return new WaggleMentionNode(node.__preset, node.__key)
  }

  constructor(preset: WagglePreset, key?: NodeKey) {
    super(key)
    this.__preset = preset
  }

  override createDOM(_config: EditorConfig) {
    const span = document.createElement('span')
    span.style.display = 'inline'
    return span
  }

  override updateDOM() {
    return false
  }

  override exportDOM() {
    const element = document.createElement('span')
    element.textContent = this.__preset.name
    return { element }
  }

  static override importDOM() {
    return null
  }

  static override importJSON(serializedNode: SerializedWaggleMentionNode) {
    return $createWaggleMentionNode({
      id: WagglePresetId(serializedNode.presetId),
      name: serializedNode.presetName,
      description: serializedNode.presetDescription,
      config: serializedNode.presetConfig,
      isBuiltIn: serializedNode.presetIsBuiltIn,
      createdAt: serializedNode.presetCreatedAt,
      updatedAt: serializedNode.presetUpdatedAt,
    })
  }

  override exportJSON() {
    return {
      ...super.exportJSON(),
      presetId: this.__preset.id,
      presetName: this.__preset.name,
      presetDescription: this.__preset.description,
      presetConfig: this.__preset.config,
      presetIsBuiltIn: this.__preset.isBuiltIn,
      presetCreatedAt: this.__preset.createdAt,
      presetUpdatedAt: this.__preset.updatedAt,
      type: 'waggle-mention',
      version: 1,
    }
  }

  getPreset() {
    return this.getLatest().__preset
  }

  override getTextContent() {
    return ''
  }

  override isInline() {
    return true
  }

  override decorate() {
    const node: ReactNode = createElement(WaggleMentionChip, { presetName: this.__preset.name })
    return node
  }
}

export function $createWaggleMentionNode(preset: WagglePreset) {
  return $applyNodeReplacement(new WaggleMentionNode(preset))
}
