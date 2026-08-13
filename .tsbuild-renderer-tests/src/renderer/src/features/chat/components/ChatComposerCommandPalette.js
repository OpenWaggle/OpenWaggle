import { jsx as _jsx } from "react/jsx-runtime";
import { CommandPalette } from '@/features/command-palette/components';
/** Command palette overlay slot above the composer (extracted to keep ChatComposerStack small). */
export function ChatComposerCommandPalette(props) {
    if (!props.open)
        return null;
    return (_jsx("div", { className: "mx-auto w-full max-w-[720px] px-5 pb-2", children: _jsx(CommandPalette, { slashSkills: props.slashSkills, onSelectSkill: props.onSelectSkill, onStartWaggle: props.onStartWaggle, onOpenSessionTree: props.onOpenSessionTree, onForkToNewSession: props.onForkToNewSession, onCloneToNewSession: props.onCloneToNewSession }) }));
}
