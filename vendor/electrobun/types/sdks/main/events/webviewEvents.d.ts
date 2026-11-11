import ElectrobunEvent from "./event";
type DetailData = {
    detail: string;
};
type NewWindowOpenData = {
    detail: string | {
        url: string;
        isCmdClick: boolean;
        modifierFlags?: number;
        targetDisposition?: number;
        userGesture?: boolean;
    };
};
declare const _default: {
    willNavigate: (data: DetailData) => ElectrobunEvent<DetailData, {}>;
    didNavigate: (data: DetailData) => ElectrobunEvent<DetailData, {}>;
    didNavigateInPage: (data: DetailData) => ElectrobunEvent<DetailData, {}>;
    didCommitNavigation: (data: DetailData) => ElectrobunEvent<DetailData, {}>;
    domReady: (data: DetailData) => ElectrobunEvent<DetailData, {}>;
    newWindowOpen: (data: NewWindowOpenData) => ElectrobunEvent<NewWindowOpenData, {}>;
    hostMessage: (data: DetailData) => ElectrobunEvent<DetailData, {}>;
    downloadStarted: (data: DetailData) => ElectrobunEvent<DetailData, {}>;
    downloadProgress: (data: DetailData) => ElectrobunEvent<DetailData, {}>;
    downloadCompleted: (data: DetailData) => ElectrobunEvent<DetailData, {}>;
    downloadFailed: (data: DetailData) => ElectrobunEvent<DetailData, {}>;
};
export default _default;
