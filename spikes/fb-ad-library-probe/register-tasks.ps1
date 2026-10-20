# Registers the Step 1 probe's Windows tasks for the current user (interactive logon, because headed and
# off-screen Chrome need the desktop session). Run it from the probe worktree
# (C:\Users\User\dev\wt\ideas-hub-probe), never from the main checkout, so branch switches there cannot
# break the tasks. Each task wakes the PC and keeps it awake while it runs (keep-awake.ps1):
#   IdeasHub-Probe-Runs         probe runs at 01:00 and 13:00 (Asia/Ho_Chi_Minh, this PC's time zone) until -Until
#   IdeasHub-Probe-Refetch-24h  thumbnail re-fetch of one run's URLs, 24 h after -RunStart
#   IdeasHub-Probe-Refetch-72h  the same, 72 h after -RunStart
# Remove them with: Get-ScheduledTask -TaskName 'IdeasHub-Probe-*' | Unregister-ScheduledTask -Confirm:$false
param(
  [Parameter(Mandatory)] [ValidateSet('headed', 'offscreen', 'headless')] [string] $Mode,
  [Parameter(Mandatory)] [string] $UrlsFile,
  [Parameter(Mandatory)] [datetime] $RunStart,
  [Parameter(Mandatory)] [datetime] $Until
)
$ErrorActionPreference = 'Stop'
$dir = $PSScriptRoot
$pnpm = (Get-Command pnpm.cmd).Source
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -WakeToRun -ExecutionTimeLimit (New-TimeSpan -Hours 12) `
  -MultipleInstances IgnoreNew -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive

function Register($name, $arguments, $triggers) {
  $action = New-ScheduledTaskAction -Execute 'powershell.exe' -WorkingDirectory $dir `
    -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -Command `"& '$dir\keep-awake.ps1' '$pnpm' probe $arguments *>> '$dir\out\scheduled.log'`""
  Register-ScheduledTask -TaskName $name -Action $action -Trigger $triggers -Settings $settings -Principal $principal -Force | Out-Null
  Get-ScheduledTask -TaskName $name | Get-ScheduledTaskInfo | Select-Object TaskName, NextRunTime
}

$runs = foreach ($t in '01:00', '13:00') {
  $at = [datetime]::Today.Add([timespan]$t)
  if ($at -lt (Get-Date)) { $at = $at.AddDays(1) }
  $trigger = New-ScheduledTaskTrigger -Daily -At $at
  $trigger.EndBoundary = $Until.ToString('s')
  $trigger
}
Register 'IdeasHub-Probe-Runs' "--modes $Mode --out out" $runs
foreach ($h in 24, 72) {
  Register "IdeasHub-Probe-Refetch-${h}h" "--refetch '$UrlsFile' --out out" (New-ScheduledTaskTrigger -Once -At $RunStart.AddHours($h))
}
