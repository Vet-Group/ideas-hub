# The worker task's action (plan Step 4): starts the worker again whenever it exits, so a crash or a
# kill is back within seconds; the watchdog restart is only the fallback. Keeps the PC awake while it
# runs (SetThreadExecutionState). Logs go to logs\<LogName>.log under the repo root.
# -DatabaseUrl, -LogName and -Run let check-worker-loop.ps1 run a copy against a disposable database.
param(
  [string] $RepoRoot = (Resolve-Path "$PSScriptRoot\..\..").Path,
  [string] $DatabaseUrl = '',
  [string] $LogName = 'worker',
  # pnpm arguments, space-separated (a task's -File command line passes no arrays).
  [string] $Run = '--silent worker'
)
$ErrorActionPreference = 'Continue'
$sig = '[DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint esFlags);'
$k = Add-Type -MemberDefinition $sig -Name Power -Namespace IdeasHubWorker -PassThru
# ES_CONTINUOUS | ES_SYSTEM_REQUIRED, cleared when this process ends.
[void]$k::SetThreadExecutionState([uint32]'0x80000001')
# Ending the task stops only this process, and pnpm runs scripts through Git Bash, whose processes do
# not keep their parent links; so this process joins a job object that kills every process started
# under it (the worker, its shells, Chrome) once this process ends (check-worker-loop.ps1 checks it).
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class IdeasHubJob {
  [StructLayout(LayoutKind.Sequential)] struct Basic { public long UserTime, JobTime; public uint LimitFlags; public UIntPtr MinWs, MaxWs; public uint ActiveProcesses; public UIntPtr Affinity; public uint Priority, Scheduling; }
  [StructLayout(LayoutKind.Sequential)] struct Io { public ulong R, W, O, RB, WB, OB; }
  [StructLayout(LayoutKind.Sequential)] struct Extended { public Basic Basic; public Io Io; public UIntPtr ProcessMem, JobMem, PeakProcessMem, PeakJobMem; }
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern IntPtr CreateJobObject(IntPtr attributes, string name);
  [DllImport("kernel32.dll")] static extern bool SetInformationJobObject(IntPtr job, int infoClass, ref Extended info, uint length);
  [DllImport("kernel32.dll")] static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
  [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
  public static bool KillTreeOnExit() {
    IntPtr job = CreateJobObject(IntPtr.Zero, null);
    Extended info = new Extended();
    info.Basic.LimitFlags = 0x2000; // JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
    // 9 = JobObjectExtendedLimitInformation. The handle stays open until this process ends.
    return SetInformationJobObject(job, 9, ref info, (uint)Marshal.SizeOf(typeof(Extended))) && AssignProcessToJobObject(job, GetCurrentProcess());
  }
}
'@
if (-not [IdeasHubJob]::KillTreeOnExit()) { throw 'could not create the job object' }
# The worker reads the repo's .env only for variables not set already (process.loadEnvFile).
if ($DatabaseUrl) { $env:DATABASE_URL = $DatabaseUrl }
$logs = Join-Path $RepoRoot 'logs'
New-Item -ItemType Directory -Force $logs | Out-Null
# Read by the cmd line below; passing them through variables keeps the quoting simple.
$env:IH_LOG = Join-Path $logs "$LogName.log"
$env:IH_PNPM = (Get-Command pnpm.cmd).Source
$env:IH_RUN = $Run
$log = $env:IH_LOG
Set-Location $RepoRoot
while ($true) {
  "$(Get-Date -Format o) worker starting" | Out-File -Append -Encoding utf8 $log
  # Through cmd so the log stays UTF-8 and stderr lines are not wrapped as PowerShell errors.
  cmd.exe /d /c '"%IH_PNPM%" %IH_RUN% >> "%IH_LOG%" 2>&1'
  "$(Get-Date -Format o) worker exited with $LASTEXITCODE; restarting in 5 s" | Out-File -Append -Encoding utf8 $log
  Start-Sleep -Seconds 5
}
