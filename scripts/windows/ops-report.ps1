# Unattended report runner (phase 2 plan Step 4 item 12): every action is fixed code and the model only
# writes prose under docs/ in its own worktree.
#   ops-report.ps1 -Report prod-measure          the scheduled run (task IdeasHub-Ops-ProdMeasureReport, Step 7)
#   ops-report.ps1 -Report pilot-verdict         day 14 of the pilot (task IdeasHub-Pilot-Verdict, Step 8): the
#                                                verdict SQL with <OpsDir>\pilot-verdict\run-start.txt (UTC), AC 4/5/7
#                                                tests at the deployed commit, the grade in code, a docs PR, #55,
#                                                Lark; with -DryRun collection and tests are real, nothing is published
#   ops-report.ps1 -Report prod-measure -DryRun  collection and decision for real (read-only), the claude -p
#                                                canary; the worktree, commit, PR, Lark post and freeze end
#                                                are only logged
#   -FakeData <dir>  test mode without a host: the answer to <name>.sql is <dir>\<name>.csv and the stats
#                    are <dir>\stats.txt; -Worktree <git dir> gives item 6's checks a tree to look at; nothing
#                    is pushed, posted or sent; .done is still written (into -OpsDir)
# Inputs: <OpsDir>\<report>\t-start.txt holds T_start in UTC (Step 4.11), e.g. 2026-10-23T03:12:45Z; the host
# is what `ssh -G vet-linux` resolves to (user root, ADR 0005); the keys are ~/.ssh/ideashub_ro, _stats and _timer.
# Output: <OpsDir>\<report>\data\ (the collected files, window.txt, verdict.txt), a log per run next to it.
# Exit 0 when the run finished (any verdict, extend included); 1 on an error or a failed canary.
param(
  [Parameter(Mandatory = $true)] [ValidateSet('prod-measure', 'pilot-verdict')] [string] $Report,
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
  # The program, not this function: PowerShell names are case-insensitive, so `& ssh` would call Ssh again.
  $exe = (Get-Command ssh -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
  if (-not $script:target) {
    $g = & $exe -G vet-linux
    if ($LASTEXITCODE -ne 0) { throw 'ssh -G vet-linux failed' }
    $h = ($g | Where-Object { $_ -match '^hostname ' }) -replace '^hostname ', ''
    $p = ($g | Where-Object { $_ -match '^port ' }) -replace '^port ', ''
    $script:target = @($h, $p)
  }
  $a = @('-F', 'none', '-o', 'BatchMode=yes', '-o', 'IdentityAgent=none', '-o', 'IdentitiesOnly=yes', '-o', 'ConnectTimeout=30',
    '-i', "$env:USERPROFILE/.ssh/$key", '-p', $script:target[1], "root@$($script:target[0])")
  $out = if ($stdin) { $stdin | & $exe @a } else { & $exe -n @a }
  if ($LASTEXITCODE -ne 0) { throw "ssh with $key exited $LASTEXITCODE" }
  ($out -join "`n") + "`n"
}

# One fixed SQL file; {{T_START}}, {{T_FIRST}} and {{N}} take only values this script checked.
function Query([string] $name, [hashtable] $vars, [string] $prefix = '') {
  $sql = $prefix + [IO.File]::ReadAllText("$repo/scripts/sql/$Report/$name.sql")
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

# Item 6's checks, then commit, PR, CI on the head commit, merge. Returns the PR (with its outcome) and why none.
function Publish([string] $wt, [string] $branch, [string] $title, [string] $note) {
  $pr = ''; $noPr = ''
  if ($wt) { $noPr = Refusal $wt } else { $noPr = 'no worktree (not a real run)' }
  if ($noPr) { Log "no PR: $noPr" }
  elseif (-not $real) { Log "would: commit, push $branch, open a PR, wait for CI, merge (check passed on $wt)"; $noPr = 'not real: nothing pushed' }
  else {
    RunGit -C $wt commit -q -m "$title."
    RunGit -C $wt push -q -u origin $branch
    $sha = (RunGit -C $wt rev-parse HEAD).Trim()
    $slug = ((RunGit -C $repo remote get-url origin) -replace '^.*github\.com[:/]', '' -replace '\.git$', '').Trim()
    Push-Location $dir  # outside any checkout, so gh never switches a local branch
    try {
      $pr = (& gh pr create -R $slug --base main --head $branch --title $title `
          --body "Written by scripts/windows/ops-report.ps1 -Report $Report. $note").Trim()
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
        & gh pr merge $pr -R $slug --squash --delete-branch --match-head-commit $sha | Out-Host
        $state = (& gh pr view $pr -R $slug --json state --jq .state).Trim()
        Log "PR state: $state"
        if ($state -eq 'MERGED') { RunGit -C $repo worktree remove $wt; RunGit -C $repo branch -q -D $branch; $pr = "$pr (merged)" }
        else { $pr = "$pr (merge failed, left open)" }
      } else { $pr = "$pr (CI $ci, left open)" }
    } finally { Pop-Location }
  }
  $pr, $noPr
}

function Lark([string] $text) {
  Save (Join-Path $dir "lark-summary-$stamp.txt") $text
  if (-not $real) { Log "Lark (not sent): $($text -replace "`n", ' | ')"; return }
  Push-Location $repo
  try { $text | & pnpm --silent lark:post; if ($LASTEXITCODE -ne 0) { throw "lark:post exited $LASTEXITCODE" } } finally { Pop-Location }
}

# ---- pilot-verdict (phase 2 Step 8, day 14): collect, grade in code, publish, #55, Lark ---------------------

# The pass rules of docs/ops/acceptance-run.md. pass is $null when not graded: AC 6 in an owner-only pilot.
function PilotGrade($f, $t) {
  $r = $f.ac1_success_ratio; $a = $f.ac1_alerts; $v = $f.ac2_violations; $b = $f.ac3_briefings; $i = $f.ac6_ideas
  [ordered]@{
    'AC 1' = @{ figures = "success_ratio $($r.success_ratio) ($($r.ok_searches)/$($r.planned_searches)); blocked_unsent $($a.blocked_unsent), parse_error_unsent $($a.parse_error_unsent), network_mismatch $($a.network_mismatch)"
      rule = 'success_ratio >= 0.9000; the three Alert counts 0'
      pass = [bool] $r.success_ratio -and [decimal]::Parse($r.success_ratio, $inv) -ge 0.9 -and ([int] $a.blocked_unsent + [int] $a.parse_error_unsent + [int] $a.network_mismatch) -eq 0 }
    'AC 2' = @{ figures = "ok_without_embedded $($v.ok_without_embedded), has_next_without_page $($v.has_next_without_page), silent_stops $($v.silent_stops)"
      rule = 'all three 0'
      pass = ([int] $v.ok_without_embedded + [int] $v.has_next_without_page + [int] $v.silent_stops) -eq 0 }
    'AC 3' = @{ figures = "days_ok $($b.days_ok)/$($b.days)$(if ($b.late_days) { " (not on time: $($b.late_days))" }); unresolved_refs $($b.unresolved_refs); days_over_cap $($b.days_over_cap)"
      rule = 'days_ok >= 13 of 14; unresolved_refs 0; days_over_cap 0'
      pass = [int] $b.days_ok -ge 13 -and [int] $b.unresolved_refs -eq 0 -and [int] $b.days_over_cap -eq 0 }
    'AC 4' = @{ figures = "pnpm -r test exit $($t.test)"; rule = 'exit 0'; pass = $t.test -eq '0' }
    'AC 5' = @{ figures = "pnpm --filter @ideas-hub/web e2e exit $($t.e2e)"; rule = 'exit 0'; pass = $t.e2e -eq '0' }
    'AC 6' = @{ figures = "ideas $($i.ideas); stores_with_10 $($i.stores_with_10); per store $($i.per_store)"
      rule = 'ideas >= 30 and stores_with_10 >= 2 (not measured: owner-only pilot)'; pass = $null }
    'AC 7' = @{ figures = "the same e2e run exit $($t.e2e); LCP checked before day 1 (#55)"; rule = 'e2e exit 0; LCP median < 2500 ms'; pass = $t.e2e -eq '0' }
  }
}

# What the owner can choose from when an AC fails (owner decision 2026-10-22: nothing changes mid-pilot).
$pilotFixes = @{
  'AC 1' = 'look at blocked slots and cool-downs; fewer searches per slot or a longer gap; a second IP or a proxy (after-pilot list); then a new 14-day run'
  'AC 2' = 'fix the parser for the failing page shape (crawl_searches rows of the window), re-run the Ad Library probe, then a new run'
  'AC 3' = 'try gpt-6-sol for the briefing (the daily comments carry the rule), start the briefing earlier, or move Lark to the bot app'
  'AC 4' = 'fix the failing tests at the deployed commit (test.txt in the data folder)'
  'AC 5' = 'fix the failing e2e cases at the deployed commit (e2e.txt in the data folder)'
  'AC 7' = 'fix the failing e2e cases (e2e.txt); re-run the LCP check through the hostname'
}

# AC 4, 5 and 7 on this PC at the commit the host runs; never against the host's database.
function PilotTests([string] $sha) {
  if ($fake) { $text = [IO.File]::ReadAllText((Join-Path $FakeData 'tests.txt')) }
  else {
    $wt = "$env:USERPROFILE\dev\wt\ideas-hub-pilot-tests"
    if (Test-Path $wt) { RunGit -C $repo worktree remove --force $wt | Out-Null }
    RunGit -C $repo fetch -q origin main
    RunGit -C $repo worktree add -q --detach $wt $sha | Out-Null
    Copy-Item (Join-Path $repo '.env') (Join-Path $wt '.env')
    Push-Location $wt
    try {
      $ErrorActionPreference = 'Continue'
      & pnpm install --frozen-lockfile *>&1 | Out-File -Encoding utf8 (Join-Path $data 'install.txt'); $in = $LASTEXITCODE
      & pnpm -r test *>&1 | Out-File -Encoding utf8 (Join-Path $data 'test.txt'); $te = $LASTEXITCODE
      & pnpm --filter '@ideas-hub/web' e2e *>&1 | Out-File -Encoding utf8 (Join-Path $data 'e2e.txt'); $e2 = $LASTEXITCODE
    } finally { $ErrorActionPreference = 'Stop'; Pop-Location }
    RunGit -C $repo worktree remove --force $wt | Out-Null
    $text = "install $in`ntest $te`ne2e $e2`n"
  }
  Save (Join-Path $data 'tests.txt') $text
  $h = @{}; foreach ($l in $text -split "`n" | Where-Object { $_.Trim() }) { $k, $v = $l.Trim() -split ' ', 2; $h[$k] = $v }
  $h
}

function PilotVerdict {
  $rs = ([IO.File]::ReadAllText((Join-Path $dir 'run-start.txt'))).Trim()
  if ($rs -notmatch '^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$') { throw 'run-start.txt is not a UTC time like 2026-10-22T17:00:00Z' }
  $end = [DateTimeOffset]::Parse($rs, $inv).UtcDateTime.AddDays(14)
  if ($real -and $nowUtc -lt $end) { throw "the run ends at $($end.ToString('s'))Z; too early for the verdict" }
  if (Test-Path $data) { Move-Item $data (Join-Path $dir "data-$stamp") }
  New-Item -ItemType Directory -Path $data | Out-Null

  $f = @{}
  foreach ($name in 'ac1_success_ratio', 'ac1_alerts', 'ac2_violations', 'ac3_briefings', 'ac6_ideas') {
    $f[$name] = Query $name @{} "set pilot.run_start = '$rs';`n" | ConvertFrom-Csv | Select-Object -First 1
    if (-not $f[$name]) { throw "$name.sql returned no row" }
  }
  if (-not $fake) { Save (Join-Path $data 'acceptance.csv') (Ssh 'ideashub_ro' ([IO.File]::ReadAllText("$repo/scripts/acceptance.sql"))) }
  $stats = if ($fake) { [IO.File]::ReadAllText((Join-Path $FakeData 'stats.txt')) } else { Ssh 'ideashub_stats' '' }
  Save (Join-Path $data 'stats.txt') $stats
  $sha = $stats -split "`n" | ForEach-Object { $_.Trim() } | Where-Object { $_ -match '^[0-9a-f]{40}$' } | Select-Object -Last 1
  if (-not $sha) { throw 'no deployed-sha in the stats output' }
  Log "deployed $sha; running the tests (AC 4, 5, 7)"
  $t = PilotTests $sha
  # Commits on main during the run outside docs/ (the code freeze), listed for the owner, not graded.
  $commits = if ($fake) { '' } else {
    RunGit -C $repo fetch -q origin main
    (RunGit -C $repo log --since=$rs --until="$($end.ToString('s'))Z" --format='%h %s' origin/main -- . ':(exclude)docs') -join "`n"
  }

  $g = PilotGrade $f $t
  $failed = @($g.Keys | Where-Object { $g[$_].pass -eq $false })
  $verdict = if ($failed.Count) { 'FAIL' } else { 'PASS' }
  Save (Join-Path $data 'verdict.txt') "$verdict`n$($failed -join ', ')`n"
  Log "verdict: $verdict$(if ($failed) { " ($($failed -join ', '))" })"

  $report = @(
    '# 14-day pilot verdict (phase 2 Step 8)', '',
    "Written by ``scripts/windows/ops-report.ps1 -Report pilot-verdict`` from the collected figures; no model text. Tracking issue #55.", '',
    "- Run: $rs to $($end.ToString('s'))Z (UTC), 14 days",
    "- Commit under test: ``$sha``",
    "- Verdict: **$verdict**$(if ($failed) { " ($($failed -join ', ') failed)" })", '',
    '| AC | Figures | Pass rule | Result |', '|---|---|---|---|'
  ) + @($g.Keys | ForEach-Object { "| $_ | $($g[$_].figures) | $($g[$_].rule) | $(if ($null -eq $g[$_].pass) { 'not measured' } elseif ($g[$_].pass) { 'pass' } else { '**fail**' }) |" }) + @(
    '', '## Commits on main during the run (outside docs/)', '',
    $(if ($commits) { ($commits -split "`n" | ForEach-Object { "- $_" }) -join "`n" } else { 'None.' })
  )
  if ($failed) { $report += @('', '## Fix options for the owner', '') + @($failed | ForEach-Object { "- ${_}: $($pilotFixes[$_])" }) }
  $report += @('', 'Not covered: no off-host backup during the pilot (ADR 0007, D3); a host loss loses the data.')
  $text = ($report -join "`n") + "`n"
  Save (Join-Path $data 'report.md') $text

  $branch = "report/pilot-verdict-$stamp"
  $wt = if ($Worktree) { $Worktree } elseif ($real) { "$env:USERPROFILE\dev\wt\ideas-hub-pilot-verdict-report" } else { '' }
  if ($real) {
    if (Test-Path $wt) { throw "$wt exists; remove it first" }
    RunGit -C $repo fetch -q origin main
    RunGit -C $repo worktree add -q -b $branch $wt origin/main
  }
  if ($wt) {
    Save (Join-Path $wt 'docs/ops/pilot-verdict.md') $text
    $plan = Join-Path $wt 'docs/plans/ideas-hub-phase-2.md'
    if (Test-Path $plan) {
      $p = [IO.File]::ReadAllText($plan)
      Save $plan ($p -replace '(?m)^(### Step 8\. 14-day pilot\r?\n)', "`$1`n**Verdict $($nowUtc.ToString('yyyy-MM-dd')): $verdict** ([docs/ops/pilot-verdict.md](../ops/pilot-verdict.md)).`n")
    }
  } else { Log "would: write docs/ops/pilot-verdict.md and the Step 8 verdict line in a worktree of origin/main" }
  $pr, $noPr = Publish $wt $branch 'Record the 14-day pilot verdict' "Verdict: $verdict."

  $slug = 'Vet-Group/ideas-hub'
  # The first line is what IdeasHub-Conductor matches (Documents\ops\ideas-hub-plan.json).
  $comment = "Pilot verdict ($($nowUtc.ToString('yyyy-MM-dd'))): $verdict`n`n$text`nReport PR: $(if ($pr) { $pr } else { "none ($noPr)" })"
  Save (Join-Path $data 'issue-comment.md') $comment
  if ($real) {
    $comment | & gh issue comment 55 -R $slug --body-file - | Out-Host
    if ($LASTEXITCODE -ne 0) { throw 'posting the verdict on #55 failed' }
    if ($verdict -eq 'PASS') { & gh issue close 55 -R $slug --reason completed | Out-Host }
  } else { Log "would: comment on #55$(if ($verdict -eq 'PASS') { ' and close it' })" }
  Lark (@(
      "Ideas Hub 14-day pilot: $verdict$(if ($failed) { " - failed $($failed -join ', ')" })",
      "Commit $($sha.Substring(0, 8)); AC 1 $($g['AC 1'].figures)",
      "AC 3 $($g['AC 3'].figures)",
      "Report PR: $(if ($pr) { $pr } else { "none ($noPr)" }); issue #55 $(if ($verdict -eq 'PASS') { 'closed' } else { 'stays open' })"
    ) -join "`n")
  if ($real) { Save $done "done $($nowUtc.ToString('s'))Z $verdict" }
}

# ---- the run ------------------------------------------------------------------------------------------------

Log "start: $Report, $(if ($real) { 'real' } elseif ($DryRun) { 'dry run' } else { 'fake data' }), now $($nowUtc.ToString('s'))Z, repo $repo"
try {
  # 1.
  if (Test-Path $done) { Log "stop: $done exists"; exit 0 }
  if ($Report -eq 'pilot-verdict') { PilotVerdict; Log 'end'; exit 0 }

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
  $pr, $noPr = Publish $wt $branch 'Record the production-host measurement of phase 2 Step 7' "Verdict: $($d.verdict) at N = $n."

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
