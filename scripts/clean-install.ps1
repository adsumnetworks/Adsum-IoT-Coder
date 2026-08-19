# Adsum IoT Coder - wipe this machine back to "never installed", after backing everything up.
#
# ONE COMMAND, from anywhere:
#   powershell -ExecutionPolicy Bypass -File "E:\debugger-loop-project\cline-debugger-loop\cline\scripts\clean-install.ps1"
#
# It closes VS Code for you, backs up your tasks and API keys, deletes everything, and tells you what it
# did. No admin rights needed - every path lives under your own user folder.
#
# Add -DryRun to look without touching anything.
# Add -Restore "<backup folder>" to put it all back.
#
# WHY A SCRIPT. Deleting the extension folder looks complete and is not: VS Code keeps extension state,
# including your API KEYS, in a SQLite file called state.vscdb. Wipe only the folders and the extension
# greets you as a returning user with your keys already filled in - hiding the exact thing a fresh-install
# test is meant to reveal.

param(
    [switch]$DryRun,
    [string]$Restore
)

$ErrorActionPreference = "Stop"

$ExtId      = "adsumnetwork.nrf-ai-debugger"
$GlobalStg  = Join-Path $env:APPDATA "Code\User\globalStorage\$ExtId"
$StateDb    = Join-Path $env:APPDATA "Code\User\globalStorage\state.vscdb"
$ExtDir     = Join-Path $env:USERPROFILE ".vscode\extensions"
$WsStorage  = Join-Path $env:APPDATA "Code\User\workspaceStorage"
$BackupRoot = Join-Path $env:USERPROFILE "adsum-dev-backups"
$RepoRoot   = Split-Path -Parent $PSScriptRoot

function Say([string]$m = "") { Write-Host $m }
function SizeMB($p) {
    if (-not (Test-Path $p)) { return 0 }
    $b = (Get-ChildItem $p -Recurse -File -ErrorAction SilentlyContinue | Measure-Object Length -Sum).Sum
    if (-not $b) { $b = 0 }
    return [math]::Round($b / 1MB, 1)
}

# -- the database half: run node with the repo's better-sqlite3 ---------------------
# Returns $true on success. The keys live here and nowhere else, so a failure here means the clean is
# incomplete - it is reported loudly rather than swallowed.
function Invoke-DbStep([string]$Mode, [string]$JsonPath) {
    $js = @"
const path = require('path');
const fs = require('fs');
const Database = require(path.join('$($RepoRoot -replace '\\','\\\\')', 'node_modules', 'better-sqlite3'));
const db = new Database('$($StateDb -replace '\\','\\\\')');
const PATTERNS = ['AdsumNetwork.nrf-ai-debugger', 'secret://{"extensionId":"$ExtId"', 'workbench.view.extension.adsum-iot-coder-ActivityBar'];
const mine = r => PATTERNS.some(p => r.key.startsWith(p));
if ('$Mode' === 'backup') {
  const rows = db.prepare('SELECT key, value FROM ItemTable').all().filter(mine);
  fs.writeFileSync('$($JsonPath -replace '\\','\\\\')', JSON.stringify(rows, null, 2));
  console.log(rows.length);
} else if ('$Mode' === 'delete') {
  const rows = db.prepare('SELECT key FROM ItemTable').all().filter(mine);
  const del = db.prepare('DELETE FROM ItemTable WHERE key = ?');
  for (const r of rows) del.run(r.key);
  console.log(rows.length);
} else if ('$Mode' === 'restore') {
  const rows = JSON.parse(fs.readFileSync('$($JsonPath -replace '\\','\\\\')', 'utf8'));
  const ins = db.prepare('INSERT OR REPLACE INTO ItemTable (key, value) VALUES (?, ?)');
  for (const r of rows) ins.run(r.key, r.value);
  console.log(rows.length);
}
db.close();
"@
    $tmp = Join-Path $env:TEMP "adsum-db-step.cjs"
    Set-Content -Path $tmp -Value $js -Encoding utf8
    try {
        $out = & node $tmp 2>&1
        if ($LASTEXITCODE -ne 0) { throw ($out | Out-String) }
        return [int]($out | Select-Object -Last 1)
    } finally {
        Remove-Item $tmp -ErrorAction SilentlyContinue
    }
}

# -- restore ------------------------------------------------------------------------

if ($Restore) {
    if (-not (Test-Path $Restore)) { Say "No backup at $Restore"; exit 1 }
    Say "Restoring from $Restore"
    $stg = Join-Path $Restore "globalStorage"
    if (Test-Path $stg) {
        New-Item -ItemType Directory -Force -Path $GlobalStg | Out-Null
        Copy-Item "$stg\*" $GlobalStg -Recurse -Force
        Say "  tasks, memory and settings restored"
    }
    $rowsFile = Join-Path $Restore "state-rows.json"
    if (Test-Path $rowsFile) {
        $n = Invoke-DbStep -Mode "restore" -JsonPath $rowsFile
        Say "  $n database row(s) restored, API keys included"
    }
    Say ""
    Say "Done. Start VS Code."
    exit 0
}

# -- survey -------------------------------------------------------------------------

Say ""
Say "Adsum IoT Coder - clean install"
Say ("=" * 60)

$installed = @()
if (Test-Path $ExtDir) {
    $installed = Get-ChildItem $ExtDir -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -like "$ExtId*" }
}
$wsHits = @()
if (Test-Path $WsStorage) {
    $wsHits = Get-ChildItem $WsStorage -Directory -ErrorAction SilentlyContinue |
              ForEach-Object { Join-Path $_.FullName $ExtId } | Where-Object { Test-Path $_ }
}

Say ""
foreach ($e in $installed) { Say ("  extension   {0}  ({1} MB)" -f $e.Name, (SizeMB $e.FullName)) }
if (Test-Path $GlobalStg) {
    foreach ($d in Get-ChildItem $GlobalStg -ErrorAction SilentlyContinue) {
        $note = if ($d.Name -eq "tasks") { "   <- your conversations" } elseif ($d.Name -eq "iot-memory") { "   <- project memory" } else { "" }
        Say ("  storage     {0,-14} {1,7} MB{2}" -f $d.Name, (SizeMB $d.FullName), $note)
    }
}
foreach ($w in $wsHits) { Say ("  workspace   {0}" -f (Split-Path (Split-Path $w -Parent) -Leaf)) }
Say "  database    extension state + your API keys (zai, openai, deepseek)"

if (-not $installed -and -not (Test-Path $GlobalStg)) {
    Say ""
    Say "Nothing found. This machine is already clean."
    exit 0
}

if ($DryRun) {
    Say ""
    Say "DRY RUN - nothing was touched."
    Say "Run again without -DryRun to do it."
    exit 0
}

# -- close VS Code, because it owns state.vscdb -------------------------------------

$code = Get-Process -Name "Code" -ErrorAction SilentlyContinue
if ($code) {
    Say ""
    Say "VS Code is running. It holds the database and rewrites it on exit,"
    Say "so it must close or your API keys will survive this clean."
    $answer = Read-Host "Close VS Code now? (y/n)"
    if ($answer -ne "y") { Say "Stopped. Nothing was changed."; exit 1 }
    $code | Stop-Process -Force
    Start-Sleep -Seconds 3
    Say "  closed."
}

# -- back up ------------------------------------------------------------------------

$stamp  = Get-Date -Format "yyyy-MM-dd_HH-mm-ss"
$backup = Join-Path $BackupRoot $stamp
New-Item -ItemType Directory -Force -Path $backup | Out-Null

Say ""
Say "Backing up..."
if (Test-Path $GlobalStg) {
    Copy-Item $GlobalStg (Join-Path $backup "globalStorage") -Recurse -Force
    Say ("  tasks and memory  ->  {0}" -f (Join-Path $backup "globalStorage"))
}

$dbBackedUp = $false
try {
    $n = Invoke-DbStep -Mode "backup" -JsonPath (Join-Path $backup "state-rows.json")
    Say "  $n database row(s), API keys included"
    $dbBackedUp = $true
} catch {
    Say "  ! could not read the database: $_"
    Say "    Your API keys are NOT backed up. Stopping so nothing is lost."
    exit 1
}

@"
Restore everything here with:

  powershell -ExecutionPolicy Bypass -File "$PSCommandPath" -Restore "$backup"

Close VS Code first.
"@ | Set-Content (Join-Path $backup "RESTORE.txt") -Encoding utf8

# -- delete -------------------------------------------------------------------------

Say ""
Say "Removing..."
foreach ($e in $installed) {
    Remove-Item $e.FullName -Recurse -Force -ErrorAction SilentlyContinue
    Say ("  {0}" -f $e.Name)
}
if (Test-Path $GlobalStg) {
    Remove-Item $GlobalStg -Recurse -Force -ErrorAction SilentlyContinue
    Say "  globalStorage (tasks, memory, caches, checkpoints)"
}
foreach ($w in $wsHits) { Remove-Item $w -Recurse -Force -ErrorAction SilentlyContinue }

if ($dbBackedUp) {
    try {
        $n = Invoke-DbStep -Mode "delete" -JsonPath ""
        Say "  $n database row(s), API keys included"
    } catch {
        Say "  ! could not write the database: $_"
        Say "    The folders are gone but your keys survived. Close VS Code fully and run again."
        exit 1
    }
}

# -- verify -------------------------------------------------------------------------

Say ""
Say ("=" * 60)
$stillExt = (Test-Path $ExtDir) -and (Get-ChildItem $ExtDir -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -like "$ExtId*" })
$stillStg = Test-Path $GlobalStg
if ($stillExt -or $stillStg) {
    Say "NOT FULLY CLEAN - something survived:"
    if ($stillExt) { Say "  extension folder still present" }
    if ($stillStg) { Say "  globalStorage still present" }
    Say "Usually means VS Code was still running. Close it and run again."
    exit 1
}

Say "CLEAN. This machine looks like Adsum IoT Coder was never installed."
Say ""
Say "Backup:  $backup"
Say "Restore: powershell -ExecutionPolicy Bypass -File `"$PSCommandPath`" -Restore `"$backup`""
Say ""
Say "Now open VS Code and install the VSIX for a true first-run test."
