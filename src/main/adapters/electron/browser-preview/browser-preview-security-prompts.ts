import type {
  AuthInfo,
  BluetoothDevice,
  Certificate,
  Event,
  LoginAuthenticationResponseDetails,
  WebContents,
} from 'electron'

export function monitorBrowserPreviewSecurityPrompts(contents: WebContents) {
  const cancelBasicAuth = (
    event: Event,
    _details: LoginAuthenticationResponseDetails,
    _authInfo: AuthInfo,
    callback: (username?: string, password?: string) => void,
  ) => {
    event.preventDefault()
    callback()
  }
  const rejectCertificate = (
    event: Event,
    _url: string,
    _error: string,
    _certificate: Certificate,
    callback: (isTrusted: boolean) => void,
  ) => {
    event.preventDefault()
    callback(false)
  }
  const rejectBluetooth = (
    event: Event,
    _devices: BluetoothDevice[],
    callback: (deviceId: string) => void,
  ) => {
    event.preventDefault()
    callback('')
  }
  const rejectClientCertificate = (
    event: Event,
    _url: string,
    _certificateList: Certificate[],
    callback: (certificate: Certificate) => void,
  ) => {
    event.preventDefault()
    // Electron accepts an omitted certificate to reject, despite the required callback type.
    Reflect.apply(callback, undefined, [])
  }
  contents.on('login', cancelBasicAuth)
  contents.on('certificate-error', rejectCertificate)
  contents.on('select-bluetooth-device', rejectBluetooth)
  contents.on('select-client-certificate', rejectClientCertificate)
  return [
    () => contents.removeListener('login', cancelBasicAuth),
    () => contents.removeListener('certificate-error', rejectCertificate),
    () => contents.removeListener('select-bluetooth-device', rejectBluetooth),
    () => contents.removeListener('select-client-certificate', rejectClientCertificate),
  ]
}
