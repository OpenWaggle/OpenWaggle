export default class ElectrobunEvent<DataType, ResponseType> {
    name: string;
    data: DataType;
    _response: ResponseType | undefined;
    responseWasSet: boolean;
    constructor(name: string, data: DataType);
    get response(): ResponseType | undefined;
    set response(value: ResponseType);
    clearResponse(): void;
}
