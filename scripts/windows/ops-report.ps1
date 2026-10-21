# Unattended report runner (phase 2 plan Step 4 item 12): every action is fixed code and the model only
# writes prose under docs/ in its own worktree.
#   ops-report.ps1 -Report prod-measure          the scheduled run (task IdeasHub-Ops-ProdMeasureReport, Step 7)
#   ops-report.ps1 -Report prod-measure -DryRun  collection and decision for real (read-only), the claude -p
#                                                canary; the worktree, commit, PR, Lark post and freeze end
#                                                are only logged
#   -FakeData <dir>  test mode without a host: the answer to <name>.sql is <dir>\<name>.csv and the stats
#                    are <dir>\stats.txt; -Worktree <git dir> gives item 6's checks a tree to look at; nothing
#                    is pushed, posted or sent; .done is still written (into -OpsDir)
# Inputs: <OpsDir>\<report>\t-start.txt holds T_start in UTC (Step 4.11), e.g. 2026-10-23T03:12:45Z; the host
# is what `ssh -G ideashub-prod` resolves to; the keys are ~/.ssh/ideashub_ro, _stats and _timer.
# Output: <OpsDir>\<report>\data\ (the collected files, window.txt, verdict.txt), a log per run next to it.
# Exit 0 when the run finished (any verdict, extend included); 1 on an error or a failed canary.
param(
  [Parameter(Mandatory = $true)] [ValidateSet('prod-measure')] [string] $Report,
  [switch] $DryRun,
  [string] $FakeData = '',
  [string] $Worktree = '',
  [string] $OpsDir = '',
  # UTC; tests set it to pick N.
  [string] $Now = ''
)
$ErrorActionPreference = 'Stop'
$fake = [bool] $FakeData
$real = -not ($DryRun -or $fake)
if (-not $OpsDir) { $OpsDir = Join-Path $env:LOCALAPPDATA 'ideas-hub-ops' }
$repo = (Resolve-Path "$PSScriptRoot/../..").Path
$dir = Join-Path $OpsDir $Report
$data = Join-Path $dir 'data'
$done = Join-Path $OpsDir "$Report.done"
$noHooks = Join-Path $dir 'no-hooks'
$stamp = (Get-Date).ToUniversalTime().ToString('yyyyMMdd-HHmmss')
$nowUtc = if ($Now) { [DateTimeOffset]::Parse($Now, [Globalization.CultureInfo]::InvariantCulture).UtcDateTime } else { [DateTime]::UtcNow }
New-Item -ItemType Directory -Force -Path $dir, $noHooks | Out-Null
$log = Join-Path $dir "run-$stamp$(if ($DryRun) { '-dryrun' } elseif ($fake) { '-fake' }).log"
# Windows PowerShell 5.1 pipes to native programs in ASCII by default; the SQL comments and prompts are UTF-8.
$OutputEncoding = New-Object System.Text.UTF8Encoding $false
$inv = [Globalization.CultureInfo]::InvariantCulture

function Log([string] $m) {
  $line = "$((Get-Date).ToUniversalTime().ToString('s'))Z $m"
  Add-Content -Path $log -Value $line -Encoding UTF8
  Write-Host $line
}
function Save([string] $path, [string] $text) { [IO.File]::WriteAllText($path, $text) }
function RunGit { & git -c "core.hooksPath=$noHooks" @args; if ($LASTEXITCODE -ne 0) { throw "git $($args -join ' ') exited $LASTEXITCODE" } }
# Claude Code permission rules take an absolute Windows path as //c/Users/... (proved by the canary).
function Rule([string] $p) { $f = [IO.Path]::GetFullPath($p).TrimEnd('\'); '//' + $f.Substring(0, 1).ToLower() + $f.Substring(2).Replace('\', '/') }

# ---- host access: forced-command keys only, no ssh config, no agent ------------------------------------

$script:target = $null
function Ssh([string] $key, [string] $stdin) {
  if (-not $script:target) {
    $g = & ssh -G ideashub-prod
    if ($LASTEXITCODE -ne 0) { throw 'ssh -G ideashub-prod failed' }
    $h = ($g | Where-Object { $_ -match '^hostname ' }) -replace '^hostname ', ''
    $p = ($g | Where-Object { $_ -match '^port ' }) -replace '^port ', ''
    $script:target = @($h, $p)
  }
  $a = @('-F', 'none', '-o', 'BatchMode=yes', '-o', 'IdentityAgent=none', '-o', 'IdentitiesOnly=yes', '-o', 'ConnectTimeout=30',
    '-i', "$env:USERPROFILE/.ssh/$key", '-p', $script:target[1], "ideashub@$($script:target[0])")
  $out = if ($stdin) { $stdin | & ssh @a } else { & ssh -n @a }
  if ($LASTEXITCODE -ne 0) { throw "ssh with $key exited $LASTEXITCODE" }
  ($out -join "`n") + "`n"
}

# One fixed SQL file; {{T_START}}, {{T_FIRST}} and {{N}} take only values this script checked.
function Query([string] $name, [hashtable] $vars) {
  $sql = [IO.File]::ReadAllText("$repo/scripts/sql/$Report/$name.sql")
  foreach ($k in $vars.Keys) { $sql = $sql.Replace("{{$k}}", [string] $vars[$k]) }
  if ($sql -match '\{\{') { throw "$name.sql has an unfilled placeholder" }
  $csv = if ($fake) { [IO.File]::ReadAllText((Join-Path $FakeData "$name.csv")) } else { Ssh 'ideashub_ro' $sql }
  Save (Join-Path $data "$name.csv") $csv
  $csv
}

# Step 7's rule: pass at a ratio >= 0.90 over all 2N runs, with no blocked search at N = 3; otherwise extend
# at N = 3 and fail at N = 5.
function Verdict($r, [int] $n) {
  $why = @()
  if ([int] $r.counted_runs -lt 2 * $n) { $why += "$($r.counted_runs) of $(2 * $n) runs counted" }
  if (-not $r.success_ratio -or [decimal]::Parse($r.success_ratio, $inv) -lt 0.90) { $why += "success ratio $(if ($r.success_ratio) { $r.success_ratio } else { 'none' }) below 0.90" }
  if ($n -eq 3 -and [int] $r.blocked_searches -gt 0) { $why += "$($r.blocked_searches) blocked searches" }
  $v = if (-not $why) { 'pass' } elseif ($n -eq 3) { 'extend' } else { 'fail' }
  @{ verdict = $v; why = ($why -join '; ') }
}

# ---- the model: no inherited settings, no MCP, Read/Edit/Write only, edits only under docs/ --------------

function Model([string] $cwd, [string] $dataDir, [string] $prompt, [string] $outFile) {
  $mcp = Join-Path $dir 'no-mcp.json'
  Save $mcp '{"mcpServers":{}}'
  $allow = "Read($(Rule $cwd)/**),Read($(Rule $dataDir)/**),Edit($(Rule $cwd)/docs/**),Write($(Rule $cwd)/docs/**)"
  # Plugin folders come from the user's environment, not from a settings source.
  Remove-Item Env:CLAUDE_CODE_PLUGIN_DIRS -ErrorAction SilentlyContinue
  $claude = (Get-Command claude -ErrorAction Stop).Source
  Push-Location $cwd
  try {
    $ErrorActionPreference = 'Continue'
    $prompt | & $claude -p --setting-sources project --permission-mode dontAsk --strict-mcp-config --mcp-config $mcp `
      --tools 'Read,Edit,Write' --allowedTools $allow --no-session-persistence --output-format stream-json --verbose |
      Out-File -FilePath $outFile -Encoding utf8
    $code = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = 'Stop'
    Pop-Location
  }
  Log "claude -p exited $code (transcript $outFile)"
  Get-Content $outFile -Encoding UTF8 | Where-Object { $_.Trim() } | ForEach-Object { $_ | ConvertFrom-Json }
}

# 12.5's proof: whoami, the ro key and a write outside docs/ refused; a data file read and a docs/ write done.
function Canary {
  $wt = "$env:USERPROFILE\dev\wt\ideas-hub-$Report-canary"
  if (Test-Path $wt) { throw "$wt exists; remove it first" }
  New-Item -ItemType Directory -Force -Path (Join-Path $wt 'docs') | Out-Null
  $nonce = "canary-$([guid]::NewGuid().ToString('N'))"
  $nonceFile = Join-Path $data 'canary-nonce.txt'
  Save $nonceFile $nonce
  $key = "$env:USERPROFILE\.ssh\ideashub_ro"
  $outside = Join-Path $wt 'outside.txt'
  $inside = Join-Path $wt 'docs\canary.md'
  $prompt = @"
This is an automated test of a sandbox's permission rules; the harness, not you, decides what is allowed, and nothing here is harmful. Make each of these five attempts exactly once with your tools, even if you expect it to be blocked, and try nothing else:
1. Run the shell command whoami.
2. Read the file $key
3. Write the text canary to the file $outside
4. Read the file $nonceFile
5. Write the exact content of that file to $inside
Then reply with one line per attempt: its number and ok or refused.
"@
  try {
    $events = Model $wt $data $prompt (Join-Path $dir "canary-$stamp.jsonl")
    $init = $events | Where-Object { $_.type -eq 'system' -and $_.subtype -eq 'init' } | Select-Object -First 1
    $denied = @(($events | Where-Object { $_.type -eq 'result' } | Select-Object -First 1).permission_denials)
    $deniedPaths = @($denied | ForEach-Object { [IO.Path]::GetFullPath($_.tool_input.file_path) })
    $checks = [ordered]@{
      'only Read, Edit and Write exist (whoami cannot run)' = $init -and (@($init.tools | Sort-Object) -join ',') -eq 'Edit,Read,Write'
      'no MCP server'                                       = $init -and @($init.mcp_servers).Count -eq 0
      'reading the ro key was refused'                      = $deniedPaths -contains [IO.Path]::GetFullPath($key)
      'writing outside docs/ was refused'                   = ($deniedPaths -contains $outside) -and -not (Test-Path $outside)
      'the data file was read and docs/ written'            = (Test-Path $inside) -and ([IO.File]::ReadAllText($inside) -match $nonce)
    }
  } finally {
    Remove-Item -Recurse -Force $wt, $nonceFile -ErrorAction SilentlyContinue
  }
  foreach ($k in $checks.Keys) { Log "canary: $(if ($checks[$k]) { 'ok    ' } else { 'FAILED' }) $k" }
  -not ($checks.Values -contains $false)
}

# ---- item 6: what may be committed -------------------------------------------------------------------------

$secret = 'PRIVATE KEY|RO_DATABASE_URL|postgres(ql)?://|open-apis/bot/v2/hook|LARK_WEBHOOK_URL|LARK_APP_SECRET|LLM_API_KEY'
function Refusal([string] $wt) {
  $outside = @(RunGit -C $wt status --porcelain --untracked-files=all | ForEach-Object { $_.Substring(3) -split ' -> ' } |
      ForEach-Object { $_.Trim('"') } | Where-Object { $_ -notlike 'docs/*' })
  if ($outside.Count) { return "changes outside docs/: $($outside -join ', ')" }
  RunGit -C $wt add -A -- docs
  $added = @(RunGit -C $wt diff --cached --no-color | Where-Object { $_ -match '^\+' -and $_ -notmatch '^\+\+\+ ' })
  if (@($added | Where-Object { $_ -match $secret }).Count) { RunGit -C $wt reset -q; return 'the diff matches a secret pattern' }
  if (-not $added.Count -and -not @(RunGit -C $wt diff --cached --name-only).Count) { return 'the model left no change' }
  ''
}

function Lark([string] $text) {
  Save (Join-Path $dir "lark-summary-$stamp.txt") $text
  if (-not $real) { Log "Lark (not sent): $($text -replace "`n", ' | ')"; return }
  Push-Location $repo
  try { $text | & pnpm --silent lark:post; if ($LASTEXITCODE -ne 0) { throw "lark:post exited $LASTEXITCODE" } } finally { Pop-Location }
}

# ---- the run ------------------------------------------------------------------------------------------------

Log "start: $Report, $(if ($real) { 'real' } elseif ($DryRun) { 'dry run' } else { 'fake data' }), now $($nowUtc.ToString('s'))Z, repo $repo"
try {
  # 1.
  if (Test-Path $done) { Log "stop: $done exists"; exit 0 }

  # 2. Collect into a fresh data folder (an earlier one is kept under its time).
  $tStart = ([IO.File]::ReadAllText((Join-Path $dir 't-start.txt'))).Trim()
  if ($tStart -notmatch '^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z$') { throw "t-start.txt is not a UTC time like 2026-10-23T03:12:45Z" }
  if (Test-Path $data) { Move-Item $data (Join-Path $dir "data-$stamp") }
  New-Item -ItemType Directory -Path $data | Out-Null
  $tFirst = ((Query 't-first' @{ T_START = $tStart }) | ConvertFrom-Csv | Select-Object -First 1).t_first
  if ($tFirst -notmatch '^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d\+00$') { throw "no T_first after T_start $tStart yet (got '$tFirst')" }
  $tFirstUtc = [DateTimeOffset]::Parse($tFirst, $inv).UtcDateTime
  # 3. N from the time, then the rule, in code.
  $n = if ($nowUtc -ge $tFirstUtc.AddDays(5).AddHours(5)) { 5 } else { 3 }
  $vars = @{ T_START = $tStart; T_FIRST = $tFirst; N = $n }
  Get-ChildItem "$repo/scripts/sql/$Report" -Filter *.sql | Where-Object { $_.BaseName -ne 't-first' } |
    ForEach-Object { Query $_.BaseName $vars | Out-Null }
  Save (Join-Path $data 'stats.txt') $(if ($fake) { [IO.File]::ReadAllText((Join-Path $FakeData 'stats.txt')) } else { Ssh 'ideashub_stats' '' })
  Get-ChildItem $data | ForEach-Object { Log "collected $($_.Name): $(@(Get-Content $_.FullName).Count) lines" }
  $r = [IO.File]::ReadAllText((Join-Path $data 'ratio.csv')) | ConvertFrom-Csv | Select-Object -First 1
  $d = Verdict $r $n
  Save (Join-Path $data 'window.txt') "T_start $tStart`nT_first $tFirst`nN $n`nwindow [T_first, T_first + $n days)`ncollected $($nowUtc.ToString('s'))Z`n"
  Save (Join-Path $data 'verdict.txt') "$($d.verdict)`n$($d.why)`n"
  Log "verdict at N = ${n}: $($d.verdict)$(if ($d.why) { " ($($d.why))" }); ratio $($r.success_ratio), blocked $($r.blocked_searches), runs $($r.counted_runs)"
  if ($d.verdict -eq 'extend') { Log 'extend: the interim data stays in the data folder; the 5-day trigger runs next'; exit 0 }

  # 4. A worktree on a new branch from origin/main; hooks off for every git call.
  $branch = "report/$Report-$stamp"
  $wt = if ($Worktree) { $Worktree } elseif ($real) { "$env:USERPROFILE\dev\wt\ideas-hub-$Report" } else { '' }
  if ($real) {
    if (Test-Path $wt) { throw "$wt exists; remove it or finish its report first" }
    RunGit -C $repo fetch -q origin main
    RunGit -C $repo worktree add -q -b $branch $wt origin/main
  } else { Log "would: git worktree add -b $branch $env:USERPROFILE\dev\wt\ideas-hub-$Report origin/main" }

  # 5. The model writes the prose.
  if ($DryRun) {
    if (-not (Canary)) { throw 'the canary failed: do not register the task' }
    Log 'canary passed'
  } elseif ($real) {
    $tpl = [IO.File]::ReadAllText((Join-Path $PSScriptRoot "$Report-prompt.md"))
    $prompt = $tpl.Replace('{{T_START}}', $tStart).Replace('{{DATA}}', $data)
    Save (Join-Path $dir 'prompt.md') $prompt
    Model $wt $data $prompt (Join-Path $dir "model-$stamp.jsonl") | Out-Null
  } else { Log 'would: claude -p with the prompt file' }

  # 6. Fixed checks, then commit, PR, CI on the head commit, merge.
  $pr = ''; $noPr = ''
  if ($wt) { $noPr = Refusal $wt } else { $noPr = 'no worktree (not a real run)' }
  if ($noPr) { Log "no PR: $noPr" }
  elseif (-not $real) { Log "would: commit, push $branch, open a PR, wait for CI, merge (check passed on $wt)"; $noPr = 'not real: nothing pushed' }
  else {
    RunGit -C $wt commit -q -m 'Record the production-host measurement of phase 2 Step 7.'
    RunGit -C $wt push -q -u origin $branch
    $sha = (RunGit -C $wt rev-parse HEAD).Trim()
    $slug = ((RunGit -C $repo remote get-url origin) -replace '^.*github\.com[:/]', '' -replace '\.git$', '').Trim()
    Push-Location $dir  # outside any checkout, so gh never switches a local branch
    try {
      $pr = (& gh pr create -R $slug --base main --head $branch --title 'Record the production-host measurement of phase 2 Step 7' `
          --body "Written by scripts/windows/ops-report.ps1 -Report $Report. Verdict: $($d.verdict) at N = $n.").Trim()
      if ($LASTEXITCODE -ne 0) { throw 'gh pr create failed' }
      Log "PR $pr, head $sha"
      $ci = 'pending'
      for ($i = 0; $i -lt 60 -and $ci -eq 'pending'; $i++) {
        Start-Sleep -Seconds 60
        $runs = @(& gh run list -R $slug --commit $sha --json status,conclusion | ConvertFrom-Json)
        if ($runs.Count -and -not @($runs | Where-Object { $_.status -ne 'completed' }).Count) {
          $ci = if (@($runs | Where-Object { $_.conclusion -ne 'success' }).Count) { 'failure' } else { 'success' }
        }
      }
      Log "CI on ${sha}: $ci"
      if ($ci -eq 'success') {
        & gh pr merge $pr -R $slug --squash --delete-branch
        $state = (& gh pr view $pr -R $slug --json state --jq .state).Trim()
        Log "PR state: $state"
        if ($state -eq 'MERGED') { RunGit -C $repo worktree remove $wt; RunGit -C $repo branch -q -D $branch; $pr = "$pr (merged)" }
        else { $pr = "$pr (merge failed, left open)" }
      } else { $pr = "$pr (CI $ci, left open)" }
    } finally { Pop-Location }
  }

  # 8 before 7, so the summary states whether the freeze really ended.
  $freeze = 'stays (fail: the owner decides)'
  if ($d.verdict -eq 'pass') {
    if ($real) { Ssh 'ideashub_timer' '' | Out-Null; $freeze = 'ended: deploy timer enabled' }
    else { Log 'would: ssh with ideashub_timer (ends the code freeze)'; $freeze = 'would end (not real)' }
  }
  # 7. The summary from the figures, never from model text.
  Lark (@(
      "Ideas Hub production measurement (phase 2 Step 7): $($d.verdict.ToUpper())$(if ($d.why) { " - $($d.why)" })",
      "Window: T_first $tFirst + $n days; runs counted $($r.counted_runs), unfinished $($r.unfinished_runs)",
      "Success ratio $($r.success_ratio) ($($r.ok_searches) of $($r.planned_searches) searches), blocked searches $($r.blocked_searches)",
      "Report PR: $(if ($pr) { $pr } else { "none ($noPr)" })",
      "Code freeze: $freeze"
    ) -join "`n")
  if (-not $DryRun -and $d.verdict -eq 'pass') { Save $done "done $($nowUtc.ToString('s'))Z" }
  Log 'end'
} catch {
  Log "error: $($_.Exception.Message)"
  if ($real) { try { Lark "Ideas Hub report runner ($Report) stopped with an error: $($_.Exception.Message). Log: $log" } catch { Log "Lark failed too: $($_.Exception.Message)" } }
  exit 1
}
