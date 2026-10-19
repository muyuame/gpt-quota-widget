param([switch]$Stop, [switch]$Desktop)
$ErrorActionPreference = 'Stop'
$quotaRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$quotaData = Join-Path $quotaRoot 'data'
$quotaPowerShell = Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
if ($Stop) {
    & $quotaPowerShell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $quotaRoot 'desktop\supervisor.ps1') -DataDir $quotaData -Stop
    exit $LASTEXITCODE
}
$quotaNode = (Get-Command node.exe -ErrorAction SilentlyContinue).Source
if (!$quotaNode) { throw 'Node.js 24+ is required. Please install Node.js and try again.' }
$quotaElectron = Join-Path $quotaData 'desktop-runtime\node_modules\electron\dist\electron.exe'
$env:WHALE_HOME = $quotaData
if (!(Test-Path -LiteralPath $quotaElectron)) {
    & $quotaNode (Join-Path $PSScriptRoot 'install-desktop.mjs')
    if ($LASTEXITCODE -ne 0) { throw 'Electron install failed. Check your network and try again.' }
}
function Write-QuotaJson($file, $value) {
    [IO.File]::WriteAllText($file, ($value | ConvertTo-Json -Depth 6), [Text.UTF8Encoding]::new($false))
}
if (!(Test-Path -LiteralPath $quotaData)) { New-Item -ItemType Directory -Path $quotaData | Out-Null }
if (!(Test-Path -LiteralPath (Join-Path $quotaData 'display-mode.json'))) {
    Write-QuotaJson (Join-Path $quotaData 'display-mode.json') @{version=1;mode='subscription'}
}
if (!(Test-Path -LiteralPath (Join-Path $quotaData 'ui-state.json'))) {
    Write-QuotaJson (Join-Path $quotaData 'ui-state.json') @{'dshw-account-view'='subscription'}
}
if (!(Test-Path -LiteralPath (Join-Path $quotaData '.dshw-size.json'))) {
    Write-QuotaJson (Join-Path $quotaData '.dshw-size.json') @{scale=1.2;sound=$true;vol=0.35;bubbleOn=$true;turnCostOn=$true}
}
$quotaMode = 'follow-codex'
if (Test-Path -LiteralPath (Join-Path $quotaData 'follow-config.json')) {
    try { $quotaSaved = Get-Content -LiteralPath (Join-Path $quotaData 'follow-config.json') -Raw | ConvertFrom-Json; if ($quotaSaved.mode -eq 'standalone') { $quotaMode = 'standalone' } } catch {}
}
if ($Desktop) { $quotaMode = 'standalone' }
Write-QuotaJson (Join-Path $quotaData 'follow-config.json') @{version=1;mode=$quotaMode;enabled=$true;pluginRoot=$quotaRoot;electronPath=$quotaElectron;powerShellPath=$quotaPowerShell}
# The monitor is a per-user hidden process; it follows Codex using the upstream native follower.
# Its mutex is keyed by this data directory, so repeated launches do not create duplicates.
Start-Process -FilePath $quotaPowerShell -ArgumentList @('-NoLogo','-NoProfile','-NonInteractive','-WindowStyle','Hidden','-ExecutionPolicy','Bypass','-File',('"' + (Join-Path $quotaRoot 'desktop\supervisor.ps1') + '"'),'-DataDir',('"' + $quotaData + '"')) -WindowStyle Hidden -WorkingDirectory $quotaRoot
# Clear a previous pause and restore the companion if it is already running.
$quotaPause = Join-Path $quotaData 'pause-until-host-exit.json'
if (Test-Path -LiteralPath $quotaPause) { Remove-Item -LiteralPath $quotaPause }
for ($quotaAttempt=0; $quotaAttempt -lt 25; $quotaAttempt++) {
    $ErrorActionPreference = 'Continue'
    & $quotaNode (Join-Path $PSScriptRoot 'control.mjs') status 2>$null | Out-Null
    $ErrorActionPreference = 'Stop'
    if ($LASTEXITCODE -eq 0) {
        $quotaModeCommand = if ($quotaMode -eq 'standalone') { 'mode-desktop' } else { 'mode-follow' }
        & $quotaNode (Join-Path $PSScriptRoot 'control.mjs') $quotaModeCommand | Out-Null
        & $quotaNode (Join-Path $PSScriptRoot 'control.mjs') restore | Out-Null
        Write-Output 'Codex quota widget started.'
        exit 0
    }
    Start-Sleep -Milliseconds 300
}
Write-Output 'Monitor started. The widget will appear when a Codex window is available.'
