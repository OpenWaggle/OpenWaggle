// Named pipes require handle-based security APIs, not SetNamedSecurityInfo.
// https://learn.microsoft.com/en-us/windows/win32/ipc/named-pipe-security-and-access-rights
export const WINDOWS_PIPE_SECURITY_SOURCE = `
using System;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Principal;
using Microsoft.Win32.SafeHandles;

public static class OpenWagglePipeSecurity
{
    private const uint OWNER_SECURITY_INFORMATION = 0x00000001;
    private const uint DACL_SECURITY_INFORMATION = 0x00000004;
    private const uint PROTECTED_DACL_SECURITY_INFORMATION = 0x80000000;
    private const int SE_KERNEL_OBJECT = 6;
    private const int GENERIC_ALL = unchecked((int)0x10000000);
    private const uint READ_CONTROL = 0x00020000;
    private const uint WRITE_DAC = 0x00040000;
    private const uint WRITE_OWNER = 0x00080000;
    private const uint OPEN_EXISTING = 3;
    private const uint FILE_FLAG_OVERLAPPED = 0x40000000;

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern SafeFileHandle CreateFile(
        string fileName, uint desiredAccess, uint shareMode, IntPtr securityAttributes,
        uint creationDisposition, uint flagsAndAttributes, IntPtr templateFile);

    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool ConvertStringSecurityDescriptorToSecurityDescriptor(
        string descriptor, uint revision, out IntPtr securityDescriptor, out uint size);

    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern bool GetSecurityDescriptorDacl(
        IntPtr securityDescriptor, out bool present, out IntPtr dacl, out bool defaulted);

    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern bool GetSecurityDescriptorOwner(
        IntPtr securityDescriptor, out IntPtr owner, out bool defaulted);

    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern uint SetSecurityInfo(
        SafeFileHandle handle, int objectType, uint securityInformation,
        IntPtr owner, IntPtr group, IntPtr dacl, IntPtr sacl);

    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern uint GetSecurityInfo(
        SafeFileHandle handle, int objectType, uint securityInformation,
        out IntPtr owner, out IntPtr group, out IntPtr dacl,
        out IntPtr sacl, out IntPtr securityDescriptor);

    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern uint GetSecurityDescriptorLength(IntPtr securityDescriptor);

    [DllImport("kernel32.dll")]
    private static extern IntPtr LocalFree(IntPtr memory);

    private static void Stage(string stage)
    {
        Console.Error.WriteLine("OW_SECURITY_STAGE:" + stage);
        Console.Error.Flush();
    }

    private static Exception Win32Failure(string operation, uint code)
    {
        return new System.ComponentModel.Win32Exception((int)code, operation + " failed");
    }

    public static string ProtectAndVerify(string pipePath)
    {
        Stage("pipe-open");
        // Open only security metadata rights, never protocol read/write access.
        // The server keeps its ordinary pre-admission connection rejection active.
        using (SafeFileHandle pipe = CreateFile(
            pipePath, READ_CONTROL | WRITE_DAC | WRITE_OWNER, 0, IntPtr.Zero,
            OPEN_EXISTING, FILE_FLAG_OVERLAPPED, IntPtr.Zero))
        {
            if (pipe.IsInvalid)
                throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
            return ProtectAndVerifyHandle(pipe);
        }
    }

    private static string ProtectAndVerifyHandle(SafeFileHandle pipe)
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
            Stage("pipe-set");
            uint set = SetSecurityInfo(
                pipe,
                SE_KERNEL_OBJECT,
                OWNER_SECURITY_INFORMATION | DACL_SECURITY_INFORMATION | PROTECTED_DACL_SECURITY_INFORMATION,
                owner,
                IntPtr.Zero,
                dacl,
                IntPtr.Zero);
            if (set != 0) throw Win32Failure("SetSecurityInfo", set);
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
        Stage("pipe-readback");
        uint get = GetSecurityInfo(
            pipe,
            SE_KERNEL_OBJECT,
            OWNER_SECURITY_INFORMATION | DACL_SECURITY_INFORMATION,
            out verifiedOwner,
            out verifiedGroup,
            out verifiedDacl,
            out verifiedSacl,
            out verified);
        if (get != 0) throw Win32Failure("GetSecurityInfo", get);
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
`
