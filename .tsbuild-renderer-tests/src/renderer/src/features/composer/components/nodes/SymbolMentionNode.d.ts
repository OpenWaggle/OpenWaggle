import { DecoratorNode, type DOMExportOutput, type EditorConfig, type NodeKey, type SerializedLexicalNode, type Spread } from 'lexical';
import type { ReactNode } from 'react';
export type SymbolKind = 'function' | 'class' | 'type';
export type SerializedSymbolMentionNode = Spread<{
    symbolName: string;
    filePath: string;
    kind: SymbolKind;
}, SerializedLexicalNode>;
export declare class SymbolMentionNode extends DecoratorNode<ReactNode> {
    __symbolName: string;
    __filePath: string;
    __kind: SymbolKind;
    static getType(): string;
    static clone(node: SymbolMentionNode): SymbolMentionNode;
    constructor(symbolName: string, filePath: string, kind: SymbolKind, key?: NodeKey);
    createDOM(_config: EditorConfig): HTMLSpanElement;
    updateDOM(): boolean;
    exportDOM(): DOMExportOutput;
    static importDOM(): null;
    static importJSON(serializedNode: SerializedSymbolMentionNode): SymbolMentionNode;
    exportJSON(): {
        symbolName: string;
        filePath: string;
        kind: SymbolKind;
        type: string;
        version: number;
        $?: Record<string, unknown>;
    };
    getTextContent(): string;
    isInline(): boolean;
    decorate(): ReactNode;
}
export declare function $createSymbolMentionNode(symbolName: string, filePath: string, kind: SymbolKind): SymbolMentionNode;
