import { DecoratorNode, type DOMExportOutput, type EditorConfig, type NodeKey, type SerializedLexicalNode, type Spread } from 'lexical';
import type { ReactNode } from 'react';
export type SerializedFileMentionNode = Spread<{
    mentionPath: string;
    mentionBasename: string;
}, SerializedLexicalNode>;
export declare class FileMentionNode extends DecoratorNode<ReactNode> {
    __path: string;
    __basename: string;
    static getType(): string;
    static clone(node: FileMentionNode): FileMentionNode;
    constructor(filePath: string, basename: string, key?: NodeKey);
    createDOM(_config: EditorConfig): HTMLSpanElement;
    updateDOM(): boolean;
    exportDOM(): DOMExportOutput;
    static importDOM(): null;
    static importJSON(serializedNode: SerializedFileMentionNode): FileMentionNode;
    exportJSON(): {
        mentionPath: string;
        mentionBasename: string;
        type: string;
        version: number;
        $?: Record<string, unknown>;
    };
    getTextContent(): string;
    isInline(): boolean;
    decorate(): ReactNode;
}
export declare function $createFileMentionNode(filePath: string, basename: string): FileMentionNode;
