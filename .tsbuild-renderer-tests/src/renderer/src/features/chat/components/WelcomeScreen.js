import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { ChevronDown, FileText, FolderOpen, Gamepad2, PencilLine } from 'lucide-react';
import { useState } from 'react';
import openwaggleMark from '@/assets/openwaggle-mark.png';
import { projectName } from '@/shared/lib/format';
import { Button } from '@/shared/ui/Button';
import { Popover } from '@/shared/ui/Popover';
const STARTER_PROMPTS = [
    { label: 'Build a coding game in this repo', icon: Gamepad2 },
    { label: 'Draft a one-page summary of this app', icon: FileText },
    { label: 'Create a refactor plan for this codebase', icon: PencilLine },
];
const WELCOME_KICKER_CLASS = 'text-[clamp(22px,2.6vw,28px)] leading-[1.12] font-normal tracking-[-0.02em] text-text-secondary';
const WELCOME_PROJECT_CLASS = 'text-[clamp(28px,3.8vw,40px)] leading-[1.18] font-light tracking-tight text-text-primary transition-colors hover:text-text-primary';
export function WelcomeScreen({ projectPath, hasProject, recentProjects, onOpenProject, onSelectProjectPath, onRetry, }) {
    const [projectMenuOpen, setProjectMenuOpen] = useState(false);
    function handleChooseProject(path) {
        setProjectMenuOpen(false);
        void onSelectProjectPath?.(path);
    }
    return (_jsx("div", { className: "mx-auto flex min-size-full max-w-[720px] p-5", children: _jsxs("div", { className: "flex w-full flex-col pt-8", children: [_jsx("div", { className: "flex flex-1 items-center justify-center pb-20", children: _jsxs("div", { className: "flex flex-col items-center text-center", children: [_jsx("img", { src: openwaggleMark, alt: "OpenWaggle logo", className: "size-20 object-contain" }), _jsxs("div", { className: "mt-5 space-y-2", children: [_jsx("h2", { className: WELCOME_KICKER_CLASS, children: "Let's build" }), hasProject ? (_jsxs(Popover, { open: projectMenuOpen, onOpenChange: setProjectMenuOpen, placement: "bottom-start", className: "w-[340px] p-2 left-1/2 -translate-x-1/2 mt-2", trigger: _jsxs(Button, { variant: "unstyled", type: "button", onClick: () => setProjectMenuOpen((prev) => !prev), className: `relative inline-flex max-w-full items-center justify-center px-[0.45em] pb-[0.08em] ${WELCOME_PROJECT_CLASS}`, title: "Open project picker", children: [_jsx("span", { className: "truncate", children: projectName(projectPath) }), _jsx(ChevronDown, { className: "pointer-events-none absolute right-0 top-1/2 size-5 -translate-y-1/2" })] }), children: [_jsxs(Button, { variant: "unstyled", type: "button", onClick: () => {
                                                    setProjectMenuOpen(false);
                                                    onOpenProject?.();
                                                }, className: "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] text-text-secondary transition-colors hover:bg-bg-hover", children: [_jsx(FolderOpen, { className: "size-3.5 shrink-0" }), "Select folder\u2026"] }), recentProjects.length > 0 && (_jsxs("div", { className: "mt-1 border-t border-border pt-1", children: [_jsx("div", { className: "px-2.5 py-1 text-[11px] uppercase tracking-wide text-text-muted", children: "Recent projects" }), recentProjects.map((path) => (_jsxs(Button, { variant: "unstyled", type: "button", onClick: () => handleChooseProject(path), className: "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] text-text-secondary transition-colors hover:bg-bg-hover", children: [_jsx(FolderOpen, { className: "size-3.5 shrink-0 text-text-tertiary" }), _jsx("span", { className: "min-w-0 flex-1 truncate", children: projectName(path) }), path === projectPath && (_jsx("span", { className: "text-[11px] text-text-muted", children: "Current" }))] }, path)))] }))] })) : (_jsxs(Button, { variant: "unstyled", type: "button", onClick: () => {
                                            onOpenProject?.();
                                        }, className: "inline-flex max-w-sm items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm text-text-tertiary transition-colors hover:border-border-light hover:text-text-secondary", title: "Open project picker", children: [_jsx(FolderOpen, { className: "size-4 shrink-0" }), _jsx("span", { children: "Select a project folder to get started" })] }))] })] }) }), _jsx("div", { className: "pb-6", children: _jsx("div", { className: "grid grid-cols-3 gap-4", children: STARTER_PROMPTS.map((prompt) => (_jsxs(Button, { variant: "unstyled", type: "button", onClick: () => onRetry?.(prompt.label), className: "group flex min-h-[98px] flex-col rounded-2xl border border-border bg-bg-secondary px-5 py-3.5 text-left transition-[transform,border-color,background-color,box-shadow] hover:-translate-y-0.5 hover:border-accent/50 hover:bg-bg-hover/45 hover:shadow-[0_0_0_2px_color-mix(in_srgb,var(--color-accent)_18%,transparent)]", children: [_jsx("span", { className: "mb-2 inline-flex size-5 items-center justify-center rounded-full bg-bg/80", children: _jsx(prompt.icon, { className: "size-3.5 text-text-secondary transition-colors group-hover:text-text-primary" }) }), _jsx("p", { className: "text-[14px] leading-snug text-text-primary/92", children: prompt.label })] }, prompt.label))) }) })] }) }));
}
