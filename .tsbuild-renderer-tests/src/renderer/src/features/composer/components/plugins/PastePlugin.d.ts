interface PastePluginProps {
    checkAndConvertPaste: (pastedText: string, currentEditorText: string) => boolean;
}
/**
 * Intercepts paste events to delegate long-text auto-attachment.
 * If the paste triggers auto-conversion, prevents Lexical from handling it.
 * Otherwise, lets Lexical handle the paste normally.
 */
export declare function PastePlugin({ checkAndConvertPaste }: PastePluginProps): null;
export {};
