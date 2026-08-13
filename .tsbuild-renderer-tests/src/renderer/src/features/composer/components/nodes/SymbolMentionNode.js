import { $applyNodeReplacement, DecoratorNode, } from 'lexical';
import { createElement } from 'react';
import { SymbolMentionChip } from './SymbolMentionChip';
export class SymbolMentionNode extends DecoratorNode {
    __symbolName;
    __filePath;
    __kind;
    static getType() {
        return 'symbol-mention';
    }
    static clone(node) {
        return new SymbolMentionNode(node.__symbolName, node.__filePath, node.__kind, node.__key);
    }
    constructor(symbolName, filePath, kind, key) {
        super(key);
        this.__symbolName = symbolName;
        this.__filePath = filePath;
        this.__kind = kind;
    }
    createDOM(_config) {
        const span = document.createElement('span');
        span.style.display = 'inline';
        return span;
    }
    updateDOM() {
        return false;
    }
    exportDOM() {
        const element = document.createElement('span');
        element.textContent = `@#${this.__symbolName}`;
        return { element };
    }
    static importDOM() {
        return null;
    }
    static importJSON(serializedNode) {
        return $createSymbolMentionNode(serializedNode.symbolName, serializedNode.filePath, serializedNode.kind);
    }
    exportJSON() {
        return {
            ...super.exportJSON(),
            symbolName: this.__symbolName,
            filePath: this.__filePath,
            kind: this.__kind,
            type: 'symbol-mention',
            version: 1,
        };
    }
    getTextContent() {
        return `@#${this.__symbolName}`;
    }
    isInline() {
        return true;
    }
    decorate() {
        return createElement(SymbolMentionChip, {
            symbolName: this.__symbolName,
            kind: this.__kind,
        });
    }
}
export function $createSymbolMentionNode(symbolName, filePath, kind) {
    return $applyNodeReplacement(new SymbolMentionNode(symbolName, filePath, kind));
}
