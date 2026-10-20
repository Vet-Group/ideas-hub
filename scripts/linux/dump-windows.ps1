# Windows side of the Linux trial (docs/ops/linux-trial.md, steps 1–2). Run on the Windows dev PC from
# the checkout, ONLY after the owner's go-ahead. In order:
#   1. disables and stops the IdeasHub-Worker and IdeasHub-Watchdog tasks, so no run, briefing or Lark
#      post (the worker's lark.send and the watchdog's Alerts) happens after the dump;
#   2. refuses to go on while a crawl run is `running` or a pg-boss job is active (-Force skips this);
#   3. pg_dump (custom format) of the ideashub database and a tar of the MinIO volume into -OutDir,
#      with a manifest of sizes, SHA-256 sums and row counts for restore.sh.
# The tasks are disabled, not unregistered, so rollback is Enable-ScheduledTask. Nothing is deleted.
# -DryRun prints every step and runs nothing.
param(
  [string] $RepoRoot = (Resolve-Path "$PSScriptRoot\..\..").Path,
  [string] $OutDir = (Join-Path (Resolve-Path "$PSScriptRoot\..\..").Path 'transfer'),
  [switch] $DryRun,
  [switch] $Force
)
$ErrorActionPreference = 'Stop'
Set-Location $RepoRoot
$tasks = @('IdeasHub-Worker', 'IdeasHub-Watchdog')

function Step([string] $What, [scriptblock] $Do) {
  if ($DryRun) { Write-Output "[dry-run] $What"; return }
  Write-Output "==> $What"
  & $Do
}
function Psql([string] $Sql) {
  docker compose exec -T postgres psql -U ideashub -d ideashub -At -v ON_ERROR_STOP=1 -c $Sql
  if ($LASTEXITCODE -ne 0) { throw "psql failed: $Sql" }
}

Step "disable and stop the tasks $($tasks -join ', ')" {
  foreach ($t in $tasks) {
    if (Get-ScheduledTask -TaskName $t -ErrorAction SilentlyContinue) {
      Disable-ScheduledTask -TaskName $t | Out-Null
      Stop-ScheduledTask -TaskName $t
      Write-Output "    $t disabled and stopped"
    } else {
      Write-Output "    $t not registered"
    }
  }
  Start-Sleep -Seconds 10
  # Processes are found by command line: pnpm's Git Bash processes lose their parent links (ADR 0003).
  # Only the worker, watchdog, CLI and web server of this checkout, not editors that have it open.
  $left = Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" | Where-Object { $_.CommandLine -and $_.CommandLine.Contains($RepoRoot) -and $_.CommandLine -match 'src[\\/](main|watchdog|cli)\.ts|next[\\/]dist' }
  if ($left) {
    $left | ForEach-Object { Write-Output "    still running: $($_.Name)#$($_.ProcessId)" }
    throw 'Ideas Hub processes are still running (a web dev server too?); stop them, then run this again'
  }
}

Step 'check that no crawl run is running and no pg-boss job is active' {
  $running = [int](Psql "select count(*) from crawl_runs where status = 'running'")
  $active = [int](Psql "select count(*) from pgboss.job where state = 'active'")
  Write-Output "    running runs: $running, active jobs: $active"
  if (($running -gt 0 -or $active -gt 0) -and -not $Force) {
    throw 'a run or job is still active; wait for it (or re-run with -Force: the Linux worker closes it at startup as "worker restarted")'
  }
}

Step "pg_dump ideashub to $OutDir\ideashub.dump" {
  New-Item -ItemType Directory -Force $OutDir | Out-Null
  # Dumped inside the container and copied out: PowerShell redirection would re-encode the binary file.
  docker compose exec -T postgres pg_dump -U ideashub -d ideashub -Fc -f /tmp/ideashub.dump
  if ($LASTEXITCODE -ne 0) { throw 'pg_dump failed' }
  docker compose cp postgres:/tmp/ideashub.dump (Join-Path $OutDir 'ideashub.dump')
  docker compose exec -T postgres rm -f /tmp/ideashub.dump
}

Step "tar the MinIO volume to $OutDir\minio-data.tgz (MinIO stopped while it runs)" {
  $volume = docker volume ls -q --filter label=com.docker.compose.project=ideas-hub --filter label=com.docker.compose.volume=minio-data
  if (-not $volume) { throw 'MinIO volume of the ideas-hub compose project not found' }
  docker compose stop minio
  try {
    # The postgres image is already pulled and has tar; no new image is needed.
    docker run --rm -v "${volume}:/data:ro" -v "${OutDir}:/backup" postgres:16-alpine tar czf /backup/minio-data.tgz -C /data .
    if ($LASTEXITCODE -ne 0) { throw 'tar of the MinIO volume failed' }
  } finally {
    docker compose start minio
  }
}

Step "write $OutDir\manifest.txt (SHA-256, sizes, row counts)" {
  $lines = @("created $(Get-Date -Format o)", "git $(git rev-parse HEAD)")
  foreach ($f in 'ideashub.dump', 'minio-data.tgz') {
    $p = Join-Path $OutDir $f
    $lines += "sha256 $((Get-FileHash -Algorithm SHA256 $p).Hash.ToLower()) $f $((Get-Item $p).Length)"
  }
  foreach ($t in 'users', 'stores', 'keywords', 'crawl_runs', 'crawl_searches', 'ads', 'saved_ideas', 'briefings', 'alerts') {
    $lines += "rows $t $(Psql "select count(*) from $t")"
  }
  # The objects in the tar: one xl.meta per object under the bucket directory.
  $objects = docker run --rm -v "${OutDir}:/backup:ro" postgres:16-alpine sh -c 'tar tzf /backup/minio-data.tgz | grep -c "/xl.meta$" || true'
  $lines += "objects $objects"
  $lines | Out-File -Encoding utf8 (Join-Path $OutDir 'manifest.txt')
  $lines | ForEach-Object { Write-Output "    $_" }
}

Write-Output ''
Write-Output "Next: copy $OutDir (ideashub.dump, minio-data.tgz, manifest.txt) to the Linux desktop, for example"
Write-Output "  scp -r `"$OutDir`" <linux-user>@<linux-host>:<repo-dir>/transfer"
Write-Output 'and run scripts/linux/restore.sh there. Copy .env separately (it holds secrets; never commit or print it).'
Write-Output 'Rollback before Linux crawls: Enable-ScheduledTask IdeasHub-Worker; Enable-ScheduledTask IdeasHub-Watchdog'
