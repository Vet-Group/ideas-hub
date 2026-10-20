# Checks the worker task's wrapper loop (plan Step 4 Exit) with a test copy of the task against a
# disposable database, so the real worker task and the dev database are not touched:
#   1. the worker process, killed, is started again by the loop within 2 min;
#   2. ending the task leaves no node process behind;
#   3. with a browser open (test\hold-browser.ts), ending the task leaves no node or Chrome process.
# The test database has no run times and no keywords, so the worker never starts a crawl.
# Prints one line per check and exits 1 if any fails; the task and the database are removed either way.
param(
  [string] $RepoRoot = (Resolve-Path "$PSScriptRoot\..\..").Path,
  [string] $Name = 'IdeasHub-Worker-Check',
  [string] $Database = 'ih_loopcheck'
)
$ErrorActionPreference = 'Stop'
Set-Location $RepoRoot
$base = (Get-Content .env | Where-Object { $_ -match '^DATABASE_URL=' }) -replace '^DATABASE_URL=', ''
$url = $base -replace '/[^/?]+(\?|$)', "/$Database`$1"
$psql = { param($sql, $db = 'ideashub') docker compose exec -T postgres psql -q -U ideashub -d $db -v ON_ERROR_STOP=1 -c $sql | Out-Null }

function Wait-For([scriptblock] $Condition, [int] $Seconds) {
  $deadline = (Get-Date).AddSeconds($Seconds)
  while ((Get-Date) -lt $deadline) {
    $r = & $Condition
    if ($r) { return $r }
    Start-Sleep -Milliseconds 500
  }
  $null
}

# Processes are found by command line, not by parent links: Git Bash's processes break those.
function Get-Mine {
  Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine.Contains($RepoRoot) -and $_.ProcessId -ne $PID -and $_.CommandLine -notlike '*check-worker-loop.ps1*' }
}
# Chrome started by Playwright has a temporary profile; ones already running before the check are not ours.
function Get-PlaywrightChrome {
  Get-CimInstance Win32_Process -Filter "Name = 'chrome.exe'" | Where-Object { $_.CommandLine -like '*playwright_chromiumdev_profile-*' }
}
$chromeBefore = @(Get-PlaywrightChrome | ForEach-Object ProcessId)

# The worker's own node process: tsx runs main.ts in a child node started with its preflight file.
function Get-WorkerNode {
  Get-Mine | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -like '*preflight.cjs*' -and $_.CommandLine -like '*src/main.ts*' } | Select-Object -First 1
}

function Start-Check([string] $Run) {
  & "$PSScriptRoot\register-worker-tasks.ps1" -RepoRoot $RepoRoot -Name $Name -NoWatchdog -DatabaseUrl $url -LogName $Name -Run $Run -StartAt (Get-Date).AddYears(1) | Out-Null
  Start-ScheduledTask -TaskName $Name
}

function Stop-Check {
  $before = @(Get-Mine) + @(Get-PlaywrightChrome | Where-Object { $chromeBefore -notcontains $_.ProcessId })
  Stop-ScheduledTask -TaskName $Name
  Start-Sleep -Seconds 10
  $left = @(Get-Mine) + @(Get-PlaywrightChrome | Where-Object { $chromeBefore -notcontains $_.ProcessId })
  # Reported, then removed: they are this check's own processes.
  $left | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  [pscustomobject]@{ Before = $before.Count; Left = $left }
}

$results = @()
$failed = $false
function Report([string] $Check, [bool] $Ok, [string] $Detail) {
  $script:results += "$(if ($Ok) { 'PASS' } else { 'FAIL' }) $Check - $Detail"
  if (-not $Ok) { $script:failed = $true }
}

try {
  & $psql "drop database if exists $Database with (force)"
  & $psql "create database $Database"
  $env:DATABASE_URL = $url
  pnpm --silent db:migrate | Out-Null
  & $psql "insert into settings (key, value) values ('runTimes', '[]'::jsonb) on conflict (key) do update set value = excluded.value" $Database

  # 1 and 2: the worker itself.
  Start-Check '--silent worker'
  $first = Wait-For { Get-WorkerNode } 120
  if (-not $first) {
    $seen = (Get-Mine | ForEach-Object { "$($_.Name)#$($_.ProcessId): $($_.CommandLine)" }) -join ' | '
    throw "the worker did not start within 120 s ($seen); see logs\$Name.log"
  }
  Start-Sleep -Seconds 5
  $killedAt = Get-Date
  Stop-Process -Id $first.ProcessId -Force
  $second = Wait-For { $n = Get-WorkerNode; if ($n -and $n.ProcessId -ne $first.ProcessId) { $n } } 120
  $took = [int]((Get-Date) - $killedAt).TotalSeconds
  Report 'killed worker restarted by the loop' ([bool]$second) "$(if ($second) { "new worker pid $($second.ProcessId) after $took s" } else { 'no new worker within 120 s' })"
  Start-Sleep -Seconds 5
  $stop = Stop-Check
  Report 'ending the task leaves no process (worker)' ($stop.Left.Count -eq 0) "$($stop.Before) processes before, $($stop.Left.Count) left: $(($stop.Left | ForEach-Object { "$($_.Name)#$($_.ProcessId)" }) -join ', ')"

  # 3: a browser open under the loop.
  Start-Check '--silent --filter @ideas-hub/worker exec tsx test/hold-browser.ts'
  $chrome = Wait-For { Get-PlaywrightChrome | Where-Object { $chromeBefore -notcontains $_.ProcessId } } 120
  if (-not $chrome) { throw "the browser did not start within 120 s; see logs\$Name.log" }
  Start-Sleep -Seconds 3
  $stop = Stop-Check
  $chromeCount = @($stop.Left | Where-Object Name -eq 'chrome.exe').Count
  Report 'ending the task leaves no process (browser open)' ($stop.Left.Count -eq 0) "$($stop.Before) processes before, $($stop.Left.Count) left ($chromeCount chrome.exe): $(($stop.Left | ForEach-Object { "$($_.Name)#$($_.ProcessId)" }) -join ', ')"
} catch {
  Report 'check ran' $false $_.Exception.Message
} finally {
  if (Get-ScheduledTask -TaskName $Name -ErrorAction SilentlyContinue) {
    Stop-ScheduledTask -TaskName $Name -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $Name -Confirm:$false
  }
  & $psql "drop database if exists $Database with (force)"
}
$results | ForEach-Object { Write-Output $_ }
if ($failed) { exit 1 }
