import { execFile } from 'node:child_process'
import { getWindowsSecurityChildEnv } from '../../env'
import { WINDOWS_PIPE_SECURITY_SOURCE } from '../windows-pipe-security-source'

const READBACK_PROBE_TIMEOUT_MS = 20_000

const READBACK_PROBE_SOURCE = `
public static class OpenWagglePipeReadbackProbe
{
    [System.Runtime.InteropServices.DllImport("kernel32.dll", CharSet = System.Runtime.InteropServices.CharSet.Unicode, SetLastError = true)]
    private static extern Microsoft.Win32.SafeHandles.SafeFileHandle CreateFile(
        string fileName, uint desiredAccess, uint shareMode, System.IntPtr securityAttributes,
        uint creationDisposition, uint flagsAndAttributes, System.IntPtr templateFile);

    [System.Runtime.InteropServices.DllImport("kernel32.dll", CharSet = System.Runtime.InteropServices.CharSet.Unicode, SetLastError = true)]
    private static extern bool WaitNamedPipe(string pipeName, uint timeout);

    public static string VerifyInstances(string pipePath, int count)
    {
        var handles = new System.Collections.Generic.List<Microsoft.Win32.SafeHandles.SafeFileHandle>();
        string userSid = null;
        try
        {
            for (int index = 0; index < count; index++)
            {
                // Let libuv replenish pending instances; this never retries a failed ACL check.
                if (!WaitNamedPipe(pipePath, 1000))
                    throw new System.ComponentModel.Win32Exception(System.Runtime.InteropServices.Marshal.GetLastWin32Error());
                var handle = CreateFile(pipePath, 0x00020000 /* READ_CONTROL only */, 0,
                    System.IntPtr.Zero, 3 /* OPEN_EXISTING */, 0x40000000 /* OVERLAPPED */, System.IntPtr.Zero);
                if (handle.IsInvalid)
                {
                    handle.Dispose();
                    throw new System.ComponentModel.Win32Exception(System.Runtime.InteropServices.Marshal.GetLastWin32Error());
                }
                handles.Add(handle);
                userSid = OpenWagglePipeSecurity.VerifyHandle(handle);
            }
            return userSid;
        }
        finally
        {
            foreach (var handle in handles) handle.Dispose();
        }
    }
}
`

export function windowsPipeReadbackProbeScript() {
  return `
$ErrorActionPreference = 'Stop'
$source = @'
${WINDOWS_PIPE_SECURITY_SOURCE}
${READBACK_PROBE_SOURCE}
'@
$compiler = Get-Command -Name 'Microsoft.PowerShell.Utility\\Add-Type' -CommandType Cmdlet
& $compiler -TypeDefinition $source -Language CSharp
$pipePath = [Console]::In.ReadToEnd() | ConvertFrom-Json
# Keep eight distinct clients open together, then repeat after disposing the first batch.
$first = [OpenWagglePipeReadbackProbe]::VerifyInstances($pipePath, 8)
$replacement = [OpenWagglePipeReadbackProbe]::VerifyInstances($pipePath, 8)
if ($first -ne $replacement) { throw 'Named pipe owner changed between instance batches.' }
[Console]::Out.Write($replacement)
`
}

export function verifyWindowsPipeInstances(endpoint: string) {
  return runWindowsPipeProbe(windowsPipeReadbackProbeScript(), endpoint)
}

export function windowsPipeDescriptorProbeScript() {
  return `
$ErrorActionPreference = 'Stop'
$source = @'
${WINDOWS_PIPE_SECURITY_SOURCE}
'@
$compiler = Get-Command -Name 'Microsoft.PowerShell.Utility\\Add-Type' -CommandType Cmdlet
& $compiler -TypeDefinition $source -Language CSharp
$owner = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
$fullControl = '0x' + ([int][System.IO.Pipes.PipeAccessRights]::FullControl).ToString('x')
$cases = [Console]::In.ReadToEnd() | ConvertFrom-Json
$results = @(foreach ($case in $cases) {
  $sddl = $case.sddl.Replace('{user}', $owner.Value).Replace('{fullControl}', $fullControl)
  # Parsing happens outside the rejection check: invalid fixtures must fail the probe.
  $descriptor = New-Object System.Security.AccessControl.RawSecurityDescriptor($sddl)
  $accepted = $true
  try { [OpenWagglePipeSecurity]::VerifyDescriptor($descriptor, $owner) }
  catch { $accepted = $false }
  [PSCustomObject]@{ name = $case.name; accepted = $accepted }
})
[Console]::Out.Write((ConvertTo-Json -InputObject $results -Compress))
`
}

export async function verifyWindowsPipeDescriptors(
  cases: readonly { readonly name: string; readonly sddl: string }[],
): Promise<unknown> {
  const result: unknown = JSON.parse(
    await runWindowsPipeProbe(windowsPipeDescriptorProbeScript(), cases),
  )
  return result
}

function runWindowsPipeProbe(script: string, input: unknown) {
  return new Promise<string>((resolve, reject) => {
    const child = execFile(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-EncodedCommand',
        Buffer.from(script, 'utf16le').toString('base64'),
      ],
      {
        env: getWindowsSecurityChildEnv(),
        windowsHide: true,
        timeout: READBACK_PROBE_TIMEOUT_MS,
        maxBuffer: 64 * 1024,
      },
      (error, stdout) => (error ? reject(error) : resolve(stdout.trim())),
    )
    child.stdin?.once('error', reject)
    child.stdin?.end(JSON.stringify(input))
  })
}
