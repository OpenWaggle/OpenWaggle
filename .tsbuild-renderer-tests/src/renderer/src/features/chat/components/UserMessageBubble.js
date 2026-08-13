import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Check, Copy, FileDown, FileText, GitBranch, GitFork, Image } from 'lucide-react';
import { Children, cloneElement, isValidElement } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ATTACHMENT_TEXT_PREFIX } from '@/features/chat/lib/useAgentChat.utils';
import { useCopyToClipboard } from '@/shared/hooks/useCopyToClipboard';
import { cn } from '@/shared/lib/cn';
import { safeMarkdownComponents } from '@/shared/lib/markdown-link-components';
import { safeMarkdownRehypePlugins, safeMarkdownUrlTransform } from '@/shared/lib/markdown-safety';
import { Button } from '@/shared/ui/Button';
import { renderTextWithMentions } from './MentionText';
const USER_REMARK_PLUGINS = [remarkGfm];
/**
 * Recursively walks ReactNode children, replacing string nodes with
 * mention-chip-enriched fragments. Skips recursion into <a> and <code>
 * elements to avoid chipifying link text or code content.
 *
 * Uses Children.map/cloneElement because ReactMarkdown children are opaque
 * ReactNode trees. If React deprecates these APIs, migrate
 * to a custom remark plugin instead.
 */
function processChildrenForMentions(children) {
    return Children.map(children, (child) => {
        if (typeof child === 'string') {
            const parts = renderTextWithMentions(child);
            return parts.length > 0 ? parts : child;
        }
        if (isValidElement(child) && child.props.children !== undefined) {
            // Don't recurse into links or code — @mentions there should stay plain
            if (typeof child.type === 'string' && (child.type === 'a' || child.type === 'code')) {
                return child;
            }
            return cloneElement(child, {}, processChildrenForMentions(child.props.children));
        }
        return child;
    });
}
function UserMarkdownParagraph({ children }) {
    return _jsx("p", { children: processChildrenForMentions(children) });
}
function UserMarkdownListItem({ children }) {
    return _jsx("li", { children: processChildrenForMentions(children) });
}
const userMarkdownComponents = {
    ...safeMarkdownComponents,
    p: UserMarkdownParagraph,
    li: UserMarkdownListItem,
};
function isAttachmentText(content) {
    return content.startsWith(ATTACHMENT_TEXT_PREFIX);
}
function parseAttachmentName(content) {
    const afterPrefix = content.slice(ATTACHMENT_TEXT_PREFIX.length);
    // Name is the first line after the prefix
    const newlineIndex = afterPrefix.indexOf('\n');
    return newlineIndex >= 0 ? afterPrefix.slice(0, newlineIndex) : afterPrefix;
}
function getAttachmentIcon(name) {
    const lower = name.toLowerCase();
    if (lower.endsWith('.png') ||
        lower.endsWith('.jpg') ||
        lower.endsWith('.jpeg') ||
        lower.endsWith('.gif') ||
        lower.endsWith('.webp') ||
        lower.endsWith('.svg')) {
        return Image;
    }
    if (lower.endsWith('.pdf')) {
        return FileDown;
    }
    return FileText;
}
function AttachmentIcon({ name }) {
    const icon = getAttachmentIcon(name);
    if (icon === Image) {
        return _jsx(Image, { className: "size-3.5 shrink-0 text-text-tertiary" });
    }
    if (icon === FileDown) {
        return _jsx(FileDown, { className: "size-3.5 shrink-0 text-text-tertiary" });
    }
    return _jsx(FileText, { className: "size-3.5 shrink-0 text-text-tertiary" });
}
function AttachmentChip({ name }) {
    return (_jsxs("div", { className: cn('inline-flex items-center gap-1.5 rounded-md border border-border', 'bg-bg-tertiary px-2 py-1 text-[12px] text-text-secondary'), children: [_jsx(AttachmentIcon, { name: name }), _jsx("span", { className: "truncate max-w-[200px]", children: name })] }));
}
export function UserMessageBubble({ message, onBranchFromMessage, onForkFromMessage, }) {
    const { copied, copy } = useCopyToClipboard();
    const textParts = message.parts.filter((p) => p.type === 'text');
    const contentParts = textParts.filter((p) => !isAttachmentText(p.content));
    const attachmentParts = textParts.filter((p) => isAttachmentText(p.content));
    function handleCopy() {
        copy(contentParts.map((p) => p.content).join('\n'));
    }
    return (_jsx("div", { className: "group/user-msg flex justify-end w-full", children: _jsxs("div", { className: cn('relative min-w-0 max-w-full rounded-[16px_16px_2px_16px]', 'border border-border-light bg-bg-hover px-3.5 py-2.5'), children: [attachmentParts.length > 0 && (_jsx("div", { className: "flex flex-wrap gap-1.5 mb-2", children: attachmentParts.map((p, i) => (_jsx(AttachmentChip, { name: parseAttachmentName(p.content) }, `${message.id}-attachment-${String(i)}`))) })), contentParts.length > 0 && (_jsx("div", { className: "prose prose-user max-w-none break-words [overflow-wrap:anywhere]", children: contentParts.map((p, i) => (_jsx(ReactMarkdown, { remarkPlugins: USER_REMARK_PLUGINS, rehypePlugins: safeMarkdownRehypePlugins, urlTransform: safeMarkdownUrlTransform, components: userMarkdownComponents, children: p.content }, `${message.id}-text-${String(i)}`))) })), _jsxs("div", { className: "absolute -bottom-7 right-0 flex items-center gap-2 opacity-0 group-hover/user-msg:opacity-100 transition-opacity", children: [onBranchFromMessage ? (_jsx(Button, { variant: "unstyled", type: "button", title: "Branch from message", onClick: () => onBranchFromMessage(message.id), className: "flex items-center gap-1 text-[12px] text-text-muted hover:text-text-secondary cursor-pointer", children: _jsx(GitBranch, { className: "size-3" }) })) : null, onForkFromMessage ? (_jsx(Button, { variant: "unstyled", type: "button", title: "Fork to new session", onClick: () => onForkFromMessage(message.id), className: "flex cursor-pointer items-center gap-1 text-[12px] text-text-muted hover:text-text-secondary", children: _jsx(GitFork, { className: "size-3" }) })) : null, _jsx(Button, { variant: "unstyled", type: "button", title: "Copy message", onClick: handleCopy, className: "flex items-center gap-1 text-[12px] text-text-muted hover:text-text-secondary cursor-pointer", children: copied ? _jsx(Check, { className: "size-3" }) : _jsx(Copy, { className: "size-3" }) })] })] }) }));
}
