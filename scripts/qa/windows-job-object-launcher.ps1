param(
  [Parameter(Mandatory = $true)][string]$Executable,
  [Parameter(Mandatory = $true)][string]$WorkingDirectory,
  [Parameter(Mandatory = $true)][string]$StatusPath,
  [Parameter(Mandatory = $true)][string]$StopPath,
  [Parameter(Mandatory = $true)][string]$TargetArgumentsBase64
)
$ErrorActionPreference = 'Stop'
$nativeSource = @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;
using Microsoft.Win32.SafeHandles;

public sealed class OpenWaggleQaJob : IDisposable
{
    private const uint CREATE_SUSPENDED = 0x00000004;
    private const uint CREATE_UNICODE_ENVIRONMENT = 0x00000400;
    private const uint JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x00002000;
    private const uint STILL_ACTIVE = 259;
    private const int JobObjectBasicAccountingInformation = 1;
    private const int JobObjectExtendedLimitInformation = 9;
    private const int STARTF_USESTDHANDLES = 0x00000100;
    private const int STD_INPUT_HANDLE = -10;
    private const int STD_OUTPUT_HANDLE = -11;
    private const int STD_ERROR_HANDLE = -12;

    [StructLayout(LayoutKind.Sequential)]
    private struct JOBOBJECT_BASIC_ACCOUNTING_INFORMATION
    {
        public long TotalUserTime;
        public long TotalKernelTime;
        public long ThisPeriodTotalUserTime;
        public long ThisPeriodTotalKernelTime;
        public uint TotalPageFaultCount;
        public uint TotalProcesses;
        public uint ActiveProcesses;
        public uint TotalTerminatedProcesses;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct JOBOBJECT_BASIC_LIMIT_INFORMATION
    {
        public long PerProcessUserTimeLimit;
        public long PerJobUserTimeLimit;
        public uint LimitFlags;
        public UIntPtr MinimumWorkingSetSize;
        public UIntPtr MaximumWorkingSetSize;
        public uint ActiveProcessLimit;
        public UIntPtr Affinity;
        public uint PriorityClass;
        public uint SchedulingClass;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct IO_COUNTERS
    {
        public ulong ReadOperationCount;
        public ulong WriteOperationCount;
        public ulong OtherOperationCount;
        public ulong ReadTransferCount;
        public ulong WriteTransferCount;
        public ulong OtherTransferCount;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION
    {
        public JOBOBJECT_BASIC_LIMIT_INFORMATION BasicLimitInformation;
        public IO_COUNTERS IoInfo;
        public UIntPtr ProcessMemoryLimit;
        public UIntPtr JobMemoryLimit;
        public UIntPtr PeakProcessMemoryUsed;
        public UIntPtr PeakJobMemoryUsed;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct STARTUPINFO
    {
        public uint cb;
        public string lpReserved;
        public string lpDesktop;
        public string lpTitle;
        public uint dwX;
        public uint dwY;
        public uint dwXSize;
        public uint dwYSize;
        public uint dwXCountChars;
        public uint dwYCountChars;
        public uint dwFillAttribute;
        public uint dwFlags;
        public short wShowWindow;
        public short cbReserved2;
        public IntPtr lpReserved2;
        public IntPtr hStdInput;
        public IntPtr hStdOutput;
        public IntPtr hStdError;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct PROCESS_INFORMATION
    {
        public IntPtr hProcess;
        public IntPtr hThread;
        public uint dwProcessId;
        public uint dwThreadId;
    }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern SafeFileHandle CreateJobObject(IntPtr attributes, string name);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool SetInformationJobObject(
        SafeFileHandle job,
        int informationClass,
        IntPtr information,
        uint informationLength);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool QueryInformationJobObject(
        SafeFileHandle job,
        int informationClass,
        IntPtr information,
        uint informationLength,
        out uint returnLength);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CreateProcessW(
        string applicationName,
        StringBuilder commandLine,
        IntPtr processAttributes,
        IntPtr threadAttributes,
        bool inheritHandles,
        uint creationFlags,
        IntPtr environment,
        string currentDirectory,
        ref STARTUPINFO startupInfo,
        out PROCESS_INFORMATION processInformation);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool AssignProcessToJobObject(SafeFileHandle job, IntPtr process);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern uint ResumeThread(IntPtr thread);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool TerminateJobObject(SafeFileHandle job, uint exitCode);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool TerminateProcess(IntPtr process, uint exitCode);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool GetExitCodeProcess(IntPtr process, out uint exitCode);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool CloseHandle(IntPtr handle);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr GetStdHandle(int standardHandle);

    private readonly SafeFileHandle job;
    private IntPtr rootProcess = IntPtr.Zero;
    public OpenWaggleQaJob()
    {
        job = CreateJobObject(IntPtr.Zero, null);
        if (job.IsInvalid) ThrowLastError("CreateJobObject");
        var limits = new JOBOBJECT_EXTENDED_LIMIT_INFORMATION();
        limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        WithStructure(limits, (pointer, size) => {
            if (!SetInformationJobObject(job, JobObjectExtendedLimitInformation, pointer, size))
                ThrowLastError("SetInformationJobObject");
        });
    }

    public uint StartSuspendedAndAssign(string executable, string workingDirectory, string[] arguments)
    {
        var startup = new STARTUPINFO();
        startup.cb = (uint)Marshal.SizeOf(typeof(STARTUPINFO));
        startup.dwFlags = STARTF_USESTDHANDLES;
        startup.hStdInput = GetStdHandle(STD_INPUT_HANDLE);
        startup.hStdOutput = GetStdHandle(STD_OUTPUT_HANDLE);
        startup.hStdError = GetStdHandle(STD_ERROR_HANDLE);
        PROCESS_INFORMATION process;
        var commandLine = new StringBuilder(BuildCommandLine(executable, arguments));
        if (!CreateProcessW(executable, commandLine, IntPtr.Zero, IntPtr.Zero, true,
            CREATE_SUSPENDED | CREATE_UNICODE_ENVIRONMENT, IntPtr.Zero, workingDirectory,
            ref startup, out process)) ThrowLastError("CreateProcessW");
        try
        {
            if (!AssignProcessToJobObject(job, process.hProcess))
            {
                TerminateProcess(process.hProcess, 1);
                ThrowLastError("AssignProcessToJobObject");
            }
            if (ResumeThread(process.hThread) == UInt32.MaxValue)
            {
                TerminateJobObject(job, 1);
                ThrowLastError("ResumeThread");
            }
            rootProcess = process.hProcess;
            process.hProcess = IntPtr.Zero;
            return process.dwProcessId;
        }
        finally
        {
            CloseHandle(process.hThread);
            if (process.hProcess != IntPtr.Zero) CloseHandle(process.hProcess);
        }
    }

    public uint ActiveProcesses()
    {
        var accounting = new JOBOBJECT_BASIC_ACCOUNTING_INFORMATION();
        uint ignored;
        WithStructure(accounting, (pointer, size) => {
            if (!QueryInformationJobObject(job, JobObjectBasicAccountingInformation,
                pointer, size, out ignored)) ThrowLastError("QueryInformationJobObject");
            accounting = (JOBOBJECT_BASIC_ACCOUNTING_INFORMATION)Marshal.PtrToStructure(
                pointer, typeof(JOBOBJECT_BASIC_ACCOUNTING_INFORMATION));
        });
        return accounting.ActiveProcesses;
    }

    public bool TryGetRootExitCode(out uint exitCode)
    {
        if (rootProcess == IntPtr.Zero) throw new InvalidOperationException("Root process is unavailable.");
        if (!GetExitCodeProcess(rootProcess, out exitCode)) ThrowLastError("GetExitCodeProcess");
        return exitCode != STILL_ACTIVE;
    }

    public void Terminate()
    {
        if (!TerminateJobObject(job, 1)) ThrowLastError("TerminateJobObject");
    }

    public void Dispose()
    {
        if (rootProcess != IntPtr.Zero)
        {
            CloseHandle(rootProcess);
            rootProcess = IntPtr.Zero;
        }
        job.Dispose();
    }

    private delegate void StructureAction(IntPtr pointer, uint size);
    private static void WithStructure<T>(T value, StructureAction action)
    {
        var size = (uint)Marshal.SizeOf(typeof(T));
        var pointer = Marshal.AllocHGlobal((int)size);
        try
        {
            Marshal.StructureToPtr(value, pointer, false);
            action(pointer, size);
        }
        finally { Marshal.FreeHGlobal(pointer); }
    }

    private static string BuildCommandLine(string executable, string[] arguments)
    {
        var result = new StringBuilder(Quote(executable));
        foreach (var argument in arguments) result.Append(' ').Append(Quote(argument));
        return result.ToString();
    }

    private static string Quote(string value)
    {
        if (value.Length > 0 && value.IndexOfAny(new[] { ' ', '\t', '"' }) < 0) return value;
        var result = new StringBuilder("\"");
        var slashes = 0;
        foreach (var character in value)
        {
            if (character == '\\') { slashes++; continue; }
            if (character == '"') result.Append('\\', slashes * 2 + 1).Append(character);
            else { result.Append('\\', slashes).Append(character); }
            slashes = 0;
        }
        return result.Append('\\', slashes * 2).Append('"').ToString();
    }

    private static void ThrowLastError(string operation)
    {
        throw new Win32Exception(Marshal.GetLastWin32Error(), operation);
    }
}
'@
Add-Type -TypeDefinition $nativeSource -Language CSharp
$argumentsJson = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($TargetArgumentsBase64))
$TargetArguments = @($argumentsJson | ConvertFrom-Json)
function Write-JobState([string]$state, [string]$detail) {
  [System.IO.File]::AppendAllText($StatusPath, "$state`t$detail`n")
}

$job = $null
try {
  $job = [OpenWaggleQaJob]::new()
  $rootPid = $job.StartSuspendedAndAssign($Executable, $WorkingDirectory, $TargetArguments)
  Write-JobState 'assigned' ([string]$rootPid)
  while ($true) {
    if (Test-Path -LiteralPath $StopPath) {
      $job.Terminate()
    }
    $active = $job.ActiveProcesses()
    if ($active -eq 0) {
      [uint32]$rootExitCode = 0
      if (-not $job.TryGetRootExitCode([ref]$rootExitCode)) {
        throw 'Windows Job Object became empty before the root exit code was available.'
      }
      Write-JobState 'root-exited' ([string]$rootExitCode)
      Write-JobState 'empty' '0'
      exit 0
    }
    Start-Sleep -Milliseconds 25
  }
}
catch {
  $encoded = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($_.Exception.Message))
  Write-JobState 'failed' $encoded
  [Console]::Error.WriteLine($_.Exception.ToString())
  exit 1
}
finally {
  if ($null -ne $job) { $job.Dispose() }
}
