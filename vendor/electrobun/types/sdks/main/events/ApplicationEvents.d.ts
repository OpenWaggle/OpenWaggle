import ElectrobunEvent from "./event";
type MenuClickedData = {
    id?: number;
    action: string;
    data?: unknown;
};
type OpenUrlData = {
    url: string;
};
declare const _default: {
    applicationMenuClicked: (data: MenuClickedData) => ElectrobunEvent<MenuClickedData, {
        allow: boolean;
    }>;
    contextMenuClicked: (data: MenuClickedData) => ElectrobunEvent<MenuClickedData, {
        allow: boolean;
    }>;
    openUrl: (data: OpenUrlData) => ElectrobunEvent<OpenUrlData, void>;
    reopen: (data: {}) => ElectrobunEvent<{}, void>;
    beforeQuit: (data: {}) => ElectrobunEvent<{}, {
        allow: boolean;
    }>;
};
export default _default;
