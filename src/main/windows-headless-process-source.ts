// libuv 1.52.1 lets Windows children inherit handles outside its stdio mapping.
// The short-lived helper starts the authority without inheriting any kernel handles.
export const WINDOWS_HEADLESS_PROCESS_SOURCE = String.raw`
using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;

public static class OpenWaggleHeadlessProcess
{
    private const uint DETACHED_PROCESS = 0x00000008;
    private const uint CREATE_NEW_PROCESS_GROUP = 0x00000200;
    private const uint STARTF_USESHOWWINDOW = 0x00000001;
    private const int MAX_COMMAND_LINE_LENGTH = 32766;

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct StartupInfo
    {
        public uint size;
        public string reserved;
        public string desktop;
        public string title;
        public uint x, y, xSize, ySize, xCountChars, yCountChars, fillAttribute, flags;
        public ushort showWindow, reservedSize;
        public IntPtr reservedPointer, standardInput, standardOutput, standardError;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct ProcessInformation
    {
        public IntPtr process, thread;
        public uint processId, threadId;
    }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true, ExactSpelling = true)]
    private static extern bool CreateProcessW(
        string applicationName, StringBuilder commandLine, IntPtr processAttributes,
        IntPtr threadAttributes, bool inheritHandles, uint creationFlags,
        IntPtr environment, string currentDirectory, ref StartupInfo startup,
        out ProcessInformation processInformation);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool CloseHandle(IntPtr handle);

    public static void Launch(string command, string commandLine)
    {
        if (String.IsNullOrEmpty(command) || !Path.IsPathRooted(command) ||
            command.IndexOf('\0') >= 0 || String.IsNullOrEmpty(commandLine) ||
            commandLine.IndexOf('\0') >= 0 || commandLine.Length > MAX_COMMAND_LINE_LENGTH)
            throw new ArgumentException("Invalid headless launch input.");

        StartupInfo startup = new StartupInfo();
        startup.size = (uint)Marshal.SizeOf(typeof(StartupInfo));
        startup.flags = STARTF_USESHOWWINDOW;
        startup.showWindow = 0;
        ProcessInformation child;
        // Null environment inherits the helper's intended Host environment, not handles.
        // Do not use STARTF_USESTDHANDLES: no client-owned standard handle may survive.
        if (!CreateProcessW(command, new StringBuilder(commandLine), IntPtr.Zero,
            IntPtr.Zero, false, DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP,
            IntPtr.Zero, null, ref startup, out child))
            throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());

        bool threadClosed = CloseHandle(child.thread);
        int threadError = Marshal.GetLastWin32Error();
        bool processClosed = CloseHandle(child.process);
        int processError = Marshal.GetLastWin32Error();
        if (!threadClosed || !processClosed)
            throw new System.ComponentModel.Win32Exception(threadClosed ? processError : threadError);
    }
}
`

export const WINDOWS_HEADLESS_PROCESS_SCRIPT = `
$ErrorActionPreference = 'Stop'
$stage = 'compile'
try {
  $source = @'
${WINDOWS_HEADLESS_PROCESS_SOURCE}
'@
  $compiler = Get-Command -Name 'Microsoft.PowerShell.Utility\\Add-Type' -CommandType Cmdlet
  & $compiler -TypeDefinition $source -Language CSharp
  $stage = 'read-input'
  $encoding = New-Object System.Text.UTF8Encoding($false, $true)
  $reader = New-Object System.IO.StreamReader([Console]::OpenStandardInput(), $encoding)
  try {
    $request = $reader.ReadToEnd() | ConvertFrom-Json
  } finally {
    $reader.Dispose()
  }
  if ($request.command -isnot [string] -or $request.commandLine -isnot [string]) {
    throw 'Invalid headless launch input.'
  }
  $stage = 'create-process'
  [OpenWaggleHeadlessProcess]::Launch($request.command, $request.commandLine)
  [Console]::Out.Write('OW_HEADLESS_LAUNCHED')
  [Console]::Out.Flush()
} catch {
  $code = 0
  $exception = $_.Exception
  for ($depth = 0; $null -ne $exception -and $depth -lt 8; $depth++) {
    if ($exception -is [System.ComponentModel.Win32Exception]) {
      $code = $exception.NativeErrorCode
      break
    }
    $exception = $exception.InnerException
  }
  # Never echo an input argument, environment value, or unrestricted exception message.
  [Console]::Error.WriteLine('OW_HEADLESS_ERROR:' + $stage + ':' + $code)
  exit 1
}
`
