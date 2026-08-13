import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Folder } from 'lucide-react';
import { SidebarProjectGroupSection } from './SidebarProjectGroupSection';
export function SidebarProjectList({ sessionGroups, renderState, displayProjectName, projectActions, sessionActions, branchActions, }) {
    if (sessionGroups.projects.length === 0) {
        return (_jsxs("div", { className: "flex flex-col items-center gap-2 px-4 py-10 text-center", children: [_jsx(Folder, { className: "size-5 text-text-muted/75" }), _jsx("p", { className: "text-[13px] text-text-muted", children: "No projects yet" })] }));
    }
    return sessionGroups.projects.map((group) => (_jsx(SidebarProjectGroupSection, { group: group, renderState: renderState, displayProjectName: displayProjectName, projectActions: projectActions, sessionActions: sessionActions, branchActions: branchActions }, group.projectPath)));
}
