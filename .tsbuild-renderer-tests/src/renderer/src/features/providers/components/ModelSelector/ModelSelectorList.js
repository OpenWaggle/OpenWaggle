import { jsx as _jsx } from "react/jsx-runtime";
import { ModelSelectorRow } from './ModelSelectorRow';
export function ModelSelectorList({ models, selectedModel, onSelectModel, }) {
    if (models.length === 0) {
        return (_jsx("div", { className: "px-4 py-6 text-[13px] text-[#9098a8]", children: "No models available. Configure providers in Connections." }));
    }
    return (_jsx("div", { className: "space-y-px", children: models.map((model) => {
            const isSelected = selectedModel !== undefined && model.id === selectedModel.id;
            return (_jsx(ModelSelectorRow, { model: model, isSelected: isSelected, onSelect: onSelectModel }, model.id));
        }) }));
}
