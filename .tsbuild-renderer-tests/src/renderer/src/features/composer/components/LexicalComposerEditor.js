import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { AutoFocusPlugin } from '@lexical/react/LexicalAutoFocusPlugin';
import { LexicalComposer } from '@lexical/react/LexicalComposer';
import { ContentEditable } from '@lexical/react/LexicalContentEditable';
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary';
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin';
import { PlainTextPlugin } from '@lexical/react/LexicalPlainTextPlugin';
import { cn } from '@/shared/lib/cn';
import { createRendererLogger } from '@/shared/lib/logger';
import { FileMentionNode } from './nodes/FileMentionNode';
import { SkillMentionNode } from './nodes/SkillMentionNode';
import { SymbolMentionNode } from './nodes/SymbolMentionNode';
import { AutoResizePlugin } from './plugins/AutoResizePlugin';
import { EditorRefPlugin } from './plugins/EditorRefPlugin';
import { KeyboardPlugin } from './plugins/KeyboardPlugin';
import { MentionTypeaheadPlugin } from './plugins/MentionTypeaheadPlugin';
import { PastePlugin } from './plugins/PastePlugin';
import { SyncPlugin } from './plugins/SyncPlugin';
const logger = createRendererLogger('lexical-composer');
const EDITOR_THEME = {
    root: 'composer-lexical-root',
    paragraph: 'composer-lexical-paragraph m-0',
};
export function LexicalComposerEditor({ onSubmit, disabled, placeholder, editorRef, checkAndConvertPaste, }) {
    const initialConfig = {
        namespace: 'composer',
        theme: EDITOR_THEME,
        nodes: [FileMentionNode, SkillMentionNode, SymbolMentionNode],
        editable: !disabled,
        onError: (error) => {
            logger.error('Lexical editor error', { message: error.message });
        },
    };
    return (_jsxs(LexicalComposer, { initialConfig: initialConfig, children: [_jsx(PlainTextPlugin, { contentEditable: _jsx(ContentEditable, { "aria-label": "Message input", className: cn('w-full min-h-[24px] resize-none bg-transparent text-[14px] text-text-primary', 'focus:outline-none focus-visible:shadow-none', 'disabled:opacity-50') }), placeholder: _jsx("div", { className: "pointer-events-none absolute top-[14px] left-4 text-[14px] text-text-tertiary select-none", children: placeholder }), ErrorBoundary: LexicalErrorBoundary }), _jsx(HistoryPlugin, {}), _jsx(AutoFocusPlugin, {}), _jsx(KeyboardPlugin, { onSubmit: onSubmit }), _jsx(SyncPlugin, {}), _jsx(AutoResizePlugin, {}), _jsx(PastePlugin, { checkAndConvertPaste: checkAndConvertPaste }), _jsx(MentionTypeaheadPlugin, {}), _jsx(EditorRefPlugin, { editorRef: editorRef })] }));
}
