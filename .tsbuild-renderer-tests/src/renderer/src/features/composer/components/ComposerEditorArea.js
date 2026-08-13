import { jsx as _jsx } from "react/jsx-runtime";
import { LexicalComposerEditor } from './LexicalComposerEditor';
export function ComposerEditorArea({ onSubmit, disabled, placeholder, isLoading, editorRef, checkAndConvertPaste, }) {
    return (_jsx("div", { className: "relative min-h-[60px] px-4 py-[14px]", children: _jsx(LexicalComposerEditor, { onSubmit: onSubmit, disabled: disabled, placeholder: placeholder ?? getDefaultPlaceholder(isLoading), editorRef: editorRef, checkAndConvertPaste: checkAndConvertPaste }) }));
}
function getDefaultPlaceholder(isLoading) {
    return isLoading ? 'Add a message to the session...' : 'Ask for follow-up changes';
}
