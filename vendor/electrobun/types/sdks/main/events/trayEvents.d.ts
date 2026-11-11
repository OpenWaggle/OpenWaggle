import ElectrobunEvent from "./event";
type TrayClickedData = {
    id: number;
    action: string;
    data?: unknown;
};
declare const _default: {
    trayClicked: (data: TrayClickedData) => ElectrobunEvent<TrayClickedData, {
        allow: boolean;
    }>;
};
export default _default;
