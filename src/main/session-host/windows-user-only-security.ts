import { spawn } from 'node:child_process'
import { getWindowsSecurityChildEnv } from '../env'

const WINDOWS_SECURITY_TIMEOUT_MS = 20_000
const MAX_HELPER_OUTPUT_BYTES = 64 * 1024
const WINDOWS_SID_PATTERN = /^S-1-(?:\d+-)+\d+$/

export type WindowsUserOnlySecurityTarget =
  | { readonly kind: 'directory'; readonly path: string }
  | { readonly kind: 'file'; readonly path: string }
  | { readonly kind: 'pipe'; readonly path: string }

export type WindowsUserOnlySecurity = (
  targets: readonly WindowsUserOnlySecurityTarget[],
) => Promise<{ readonly userSid: string }>

const WINDOWS_SECURITY_SCRIPT = `
$ErrorActionPreference = 'Stop'

$source = @'
using System;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Principal;

public static class OpenWagglePipeSecurity
{
    private const uint OWNER_SECURITY_INFORMATION = 0x00000001;
    private const uint DACL_SECURITY_INFORMATION = 0x00000004;
    private const uint PROTECTED_DACL_SECURITY_INFORMATION = 0x80000000;
    private const int SE_KERNEL_OBJECT = 6;
    private const int GENERIC_ALL = unchecked((int)0x10000000);

    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool ConvertStringSecurityDescriptorToSecurityDescriptor(
        string descriptor, uint revision, out IntPtr securityDescriptor, out uint size);

    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern bool GetSecurityDescriptorDacl(
        IntPtr securityDescriptor, out bool present, out IntPtr dacl, out bool defaulted);

    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern bool GetSecurityDescriptorOwner(
        IntPtr securityDescriptor, out IntPtr owner, out bool defaulted);

    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern uint SetNamedSecurityInfo(
        string objectName,
        int objectType,
        uint securityInformation,
        IntPtr owner,
        IntPtr group,
        IntPtr dacl,
        IntPtr sacl);

    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern uint GetNamedSecurityInfo(
        string objectName,
        int objectType,
        uint securityInformation,
        out IntPtr owner,
        out IntPtr group,
        out IntPtr dacl,
        out IntPtr sacl,
        out IntPtr securityDescriptor);

    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern uint GetSecurityDescriptorLength(IntPtr securityDescriptor);

    [DllImport("kernel32.dll")]
    private static extern IntPtr LocalFree(IntPtr memory);

    private static Exception Win32Failure(string operation, uint code)
    {
        return new System.ComponentModel.Win32Exception((int)code, operation + " failed");
    }

    public static string ProtectAndVerify(string pipePath)
    {
        SecurityIdentifier expectedUser = WindowsIdentity.GetCurrent().User;
        string sid = expectedUser.Value;
        string sddl = "O:" + sid + "G:" + sid + "D:P(A;;GA;;;" + sid + ")";
        IntPtr requested = IntPtr.Zero;
        uint ignoredSize;
        if (!ConvertStringSecurityDescriptorToSecurityDescriptor(sddl, 1, out requested, out ignoredSize))
            throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
        try
        {
            IntPtr owner;
            bool ownerDefaulted;
            if (!GetSecurityDescriptorOwner(requested, out owner, out ownerDefaulted))
                throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
            bool present;
            IntPtr dacl;
            bool daclDefaulted;
            if (!GetSecurityDescriptorDacl(requested, out present, out dacl, out daclDefaulted) || !present)
                throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
            uint set = SetNamedSecurityInfo(
                pipePath,
                SE_KERNEL_OBJECT,
                OWNER_SECURITY_INFORMATION | DACL_SECURITY_INFORMATION | PROTECTED_DACL_SECURITY_INFORMATION,
                owner,
                IntPtr.Zero,
                dacl,
                IntPtr.Zero);
            if (set != 0) throw Win32Failure("SetNamedSecurityInfo", set);
        }
        finally
        {
            LocalFree(requested);
        }

        IntPtr verifiedOwner;
        IntPtr verifiedGroup;
        IntPtr verifiedDacl;
        IntPtr verifiedSacl;
        IntPtr verified;
        uint get = GetNamedSecurityInfo(
            pipePath,
            SE_KERNEL_OBJECT,
            OWNER_SECURITY_INFORMATION | DACL_SECURITY_INFORMATION,
            out verifiedOwner,
            out verifiedGroup,
            out verifiedDacl,
            out verifiedSacl,
            out verified);
        if (get != 0) throw Win32Failure("GetNamedSecurityInfo", get);
        try
        {
            int length = checked((int)GetSecurityDescriptorLength(verified));
            byte[] binary = new byte[length];
            Marshal.Copy(verified, binary, 0, length);
            RawSecurityDescriptor descriptor = new RawSecurityDescriptor(binary, 0);
            if (!expectedUser.Equals(descriptor.Owner))
                throw new InvalidOperationException("Named pipe owner SID verification failed.");
            if ((descriptor.ControlFlags & ControlFlags.DiscretionaryAclProtected) == 0)
                throw new InvalidOperationException("Named pipe DACL is not protected.");
            RawAcl acl = descriptor.DiscretionaryAcl;
            CommonAce ace = acl == null || acl.Count != 1 ? null : acl[0] as CommonAce;
            if (ace == null)
                throw new InvalidOperationException("Named pipe DACL is not user-only.");
            if (ace.AceQualifier != AceQualifier.AccessAllowed ||
                ace.AccessMask != GENERIC_ALL ||
                !expectedUser.Equals(ace.SecurityIdentifier))
                throw new InvalidOperationException("Named pipe DACL grants an unexpected principal or access mask.");
        }
        finally
        {
            LocalFree(verified);
        }
        return sid;
    }
}
'@

Add-Type -TypeDefinition $source -Language CSharp
$targets = [Console]::In.ReadToEnd() | ConvertFrom-Json
$identity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
$owner = $identity.User

foreach ($target in $targets) {
  if ($target.kind -eq 'pipe') {
    [void][OpenWagglePipeSecurity]::ProtectAndVerify([string]$target.path)
    continue
  }
  if ($target.kind -eq 'directory') {
    $security = New-Object System.Security.AccessControl.DirectorySecurity
    $inheritance = [System.Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit'
  } elseif ($target.kind -eq 'file') {
    $security = New-Object System.Security.AccessControl.FileSecurity
    $inheritance = [System.Security.AccessControl.InheritanceFlags]::None
  } else {
    throw 'Unsupported user-only security target.'
  }
  $security.SetOwner($owner)
  $security.SetAccessRuleProtection($true, $false)
  $rule = New-Object System.Security.AccessControl.FileSystemAccessRule(
    $owner,
    [System.Security.AccessControl.FileSystemRights]::FullControl,
    $inheritance,
    [System.Security.AccessControl.PropagationFlags]::None,
    [System.Security.AccessControl.AccessControlType]::Allow)
  [void]$security.AddAccessRule($rule)
  if ($target.kind -eq 'directory') {
    [System.IO.Directory]::SetAccessControl([string]$target.path, $security)
    $verified = [System.IO.Directory]::GetAccessControl([string]$target.path)
  } else {
    [System.IO.File]::SetAccessControl([string]$target.path, $security)
    $verified = [System.IO.File]::GetAccessControl([string]$target.path)
  }
  $rules = @($verified.GetAccessRules($true, $false, [System.Security.Principal.SecurityIdentifier]))
  if (!$verified.AreAccessRulesProtected -or $rules.Count -ne 1 -or
      !$rules[0].IdentityReference.Equals($owner) -or
      $rules[0].AccessControlType -ne [System.Security.AccessControl.AccessControlType]::Allow -or
      (($rules[0].FileSystemRights -band [System.Security.AccessControl.FileSystemRights]::FullControl) -ne
       [System.Security.AccessControl.FileSystemRights]::FullControl)) {
    throw 'Filesystem user-only DACL verification failed.'
  }
}

[Console]::Out.Write($owner.Value)
`

function encodedPowerShellCommand() {
  return Buffer.from(WINDOWS_SECURITY_SCRIPT, 'utf16le').toString('base64')
}

function appendBounded(output: string, chunk: Buffer) {
  if (Buffer.byteLength(output, 'utf8') + chunk.byteLength > MAX_HELPER_OUTPUT_BYTES) {
    throw new Error('The Windows user-only security helper exceeded its output limit.')
  }
  return output + chunk.toString('utf8')
}

export const secureWindowsUserOnly: WindowsUserOnlySecurity = (targets) =>
  new Promise((resolve, reject) => {
    if (targets.length === 0) {
      reject(new Error('At least one Windows user-only security target is required.'))
      return
    }
    const child = spawn(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-EncodedCommand',
        encodedPowerShellCommand(),
      ],
      {
        env: getWindowsSecurityChildEnv(),
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      },
    )
    let stdout = ''
    let stderr = ''
    let settled = false
    const fail = (error: Error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      child.kill()
      reject(error)
    }
    const timer = setTimeout(() => {
      fail(new Error('Timed out applying Windows user-only security.'))
    }, WINDOWS_SECURITY_TIMEOUT_MS)
    child.stdout.on('data', (chunk: Buffer) => {
      try {
        stdout = appendBounded(stdout, chunk)
      } catch (error) {
        fail(error instanceof Error ? error : new Error(String(error)))
      }
    })
    child.stderr.on('data', (chunk: Buffer) => {
      try {
        stderr = appendBounded(stderr, chunk)
      } catch (error) {
        fail(error instanceof Error ? error : new Error(String(error)))
      }
    })
    child.stdin.once('error', (error) => fail(error))
    child.once('error', (error) => fail(error))
    child.once('close', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      const userSid = stdout.trim()
      if (code !== 0 || !WINDOWS_SID_PATTERN.test(userSid)) {
        reject(
          new Error(
            `Windows user-only security verification failed${stderr.trim() ? `: ${stderr.trim()}` : '.'}`,
          ),
        )
        return
      }
      resolve({ userSid })
    })
    child.stdin.end(JSON.stringify(targets))
  })

export const windowsUserOnlySecurityCommandForTests = () => ({
  command: 'powershell.exe',
  arguments: [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-EncodedCommand',
    encodedPowerShellCommand(),
  ],
})
