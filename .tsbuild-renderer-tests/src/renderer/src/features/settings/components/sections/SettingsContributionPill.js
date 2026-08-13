import { jsx as _jsx } from "react/jsx-runtime";
import { cn } from '@/shared/lib/cn';
import { contributionPillToneClassName, } from './settings-contribution-host-model';
export function SettingsContributionPill({ children, tone, }) {
    return (_jsx("span", { className: cn('rounded px-1.5 py-0.5 text-[10px] font-medium', contributionPillToneClassName(tone)), children: children }));
}
