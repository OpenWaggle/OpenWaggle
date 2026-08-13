import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { safeMarkdownComponents } from '@/shared/lib/markdown-link-components';
import { safeMarkdownRehypePlugins, safeMarkdownUrlTransform } from '@/shared/lib/markdown-safety';
import { Spinner } from '@/shared/ui/Spinner';
export function SkillPreviewPane({ error, selectedSkill, isPreviewLoading, previewMarkdown, }) {
    return (_jsxs("div", { className: "min-h-0 overflow-y-auto px-5 py-4", children: [error && (_jsx("div", { className: "mb-3 rounded-md border border-error/30 bg-error/10 px-3 py-2 text-[12px] text-error", children: error })), _jsx(SkillPreviewContent, { selectedSkill: selectedSkill, isPreviewLoading: isPreviewLoading, previewMarkdown: previewMarkdown })] }));
}
function SkillPreviewContent({ selectedSkill, isPreviewLoading, previewMarkdown, }) {
    if (!selectedSkill) {
        return (_jsx("div", { className: "rounded-lg border border-border bg-bg-secondary p-4 text-[13px] text-text-tertiary", children: "Select a skill to preview its instructions." }));
    }
    if (selectedSkill.loadStatus === 'error') {
        return (_jsx("div", { className: "rounded-lg border border-error/30 bg-error/10 p-4 text-[13px] text-error", children: selectedSkill.loadError ?? 'This skill file is invalid.' }));
    }
    if (isPreviewLoading) {
        return (_jsxs("div", { className: "flex items-center gap-2 text-[13px] text-text-tertiary", children: [_jsx(Spinner, {}), "Loading preview\u2026"] }));
    }
    return _jsx(SkillPreviewMarkdown, { previewMarkdown: previewMarkdown });
}
function SkillPreviewMarkdown({ previewMarkdown }) {
    return (_jsx("article", { className: "prose max-w-none text-[13px]", children: _jsx(ReactMarkdown, { remarkPlugins: [remarkGfm], rehypePlugins: safeMarkdownRehypePlugins, urlTransform: safeMarkdownUrlTransform, components: safeMarkdownComponents, children: previewMarkdown }) }));
}
