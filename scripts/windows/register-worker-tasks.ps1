# Registers the worker and watchdog tasks for the current user (interactive logon, because headed and
# off-screen Chrome need the desktop session), from the checkout given as -RepoRoot:
#   IdeasHub-Worker    worker-loop.ps1 at logon and from -StartAt, restarted every minute if it stops
#   IdeasHub-Watchdog  pnpm watchdog every 5 min
# Remove them with: Get-ScheduledTask -TaskName 'IdeasHub-Worker','IdeasHub-Watchdog' | Unregister-ScheduledTask -Confirm:$false
# -Name lets a test register a copy (for example IdeasHub-Worker-Test) against another DATABASE_URL.
param(
  [string] $RepoRoot = (Resolve-Path "$PSScriptRoot\..\..").Path,
  [datetime] $StartAt = (Get-Date).AddMinutes(1),
  [string] $Name = 'IdeasHub-Worker',
  [switch] $NoWatchdog,
  # Passed on to worker-loop.ps1 (check-worker-loop.ps1 uses them).
  [string] $DatabaseUrl = '',
  [string] $LogName = 'worker',
  [string] $Run = '--silent worker'
)
$ErrorActionPreference = 'Stop'
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive
$loop = Join-Path $RepoRoot 'scripts\windows\worker-loop.ps1'
$worker = New-ScheduledTaskAction -Execute 'powershell.exe' -WorkingDirectory $RepoRoot `
  -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$loop`" -RepoRoot `"$RepoRoot`" -DatabaseUrl `"$DatabaseUrl`" -LogName $LogName -Run `"$Run`""
$workerSettings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::Zero) `
  -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew `
  -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
$triggers = @((New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"), (New-ScheduledTaskTrigger -Once -At $StartAt))
Register-ScheduledTask -TaskName $Name -Action $worker -Trigger $triggers -Settings $workerSettings -Principal $principal -Force | Out-Null

if (-not $NoWatchdog) {
  $pnpm = (Get-Command pnpm.cmd).Source
  $watchdog = New-ScheduledTaskAction -Execute 'cmd.exe' -WorkingDirectory $RepoRoot `
    -Argument "/c `"`"$pnpm`" --silent watchdog >> logs\watchdog.log 2>&1`""
  $every5 = New-ScheduledTaskTrigger -Once -At $StartAt -RepetitionInterval (New-TimeSpan -Minutes 5)
  $wdSettings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 4) -MultipleInstances IgnoreNew
  Register-ScheduledTask -TaskName 'IdeasHub-Watchdog' -Action $watchdog -Trigger $every5 -Settings $wdSettings -Principal $principal -Force | Out-Null
}
Get-ScheduledTask -TaskName 'IdeasHub-Worker*', 'IdeasHub-Watchdog' -ErrorAction SilentlyContinue | Get-ScheduledTaskInfo | Select-Object TaskName, NextRunTime
