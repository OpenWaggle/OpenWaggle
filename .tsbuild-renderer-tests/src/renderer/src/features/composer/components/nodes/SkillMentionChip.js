import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Sparkles } from 'lucide-react';
import { cn } from '@/shared/lib/cn';
const ICON_SIZE = 12;
export function SkillMentionChip({ skillId, skillName }) {
    return (_jsxs("span", { className: cn('bg-accent/10 text-accent rounded px-1.5 py-0.5 text-[13px]', 'inline-flex items-center gap-1', 'select-none cursor-default'), title: `/${skillId}`, children: [_jsx(Sparkles, { size: ICON_SIZE, className: "shrink-0" }), _jsx("span", { className: "truncate max-w-[200px]", children: skillName })] }));
}
