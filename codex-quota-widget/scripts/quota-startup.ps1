param([switch]$Disable)
$ErrorActionPreference = 'Stop'
$quotaTaskName = 'Codex GPT Quota Widget'
if ($Disable) {
    Unregister-ScheduledTask -TaskName $quotaTaskName -Confirm:$false -ErrorAction SilentlyContinue
    Write-Output 'Automatic startup disabled. The widget can still be started manually.'
    exit 0
}
$quotaRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$quotaPowerShell = Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
$quotaUser = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$quotaArgs = '-NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + (Join-Path $PSScriptRoot 'start-quota.ps1') + '"'
$quotaExisting = Get-ScheduledTask -TaskName $quotaTaskName -ErrorAction SilentlyContinue
if ($quotaExisting -and (@($quotaExisting.Actions).Count -ne 1 -or $quotaExisting.Actions[0].Arguments -ne $quotaArgs)) { throw 'A startup task with this name belongs to a different location. Disable that installation first.' }
$quotaAction = New-ScheduledTaskAction -Execute $quotaPowerShell -Argument $quotaArgs -WorkingDirectory $quotaRoot
$quotaTrigger = New-ScheduledTaskTrigger -AtLogOn -User $quotaUser
$quotaPrincipal = New-ScheduledTaskPrincipal -UserId $quotaUser -LogonType Interactive -RunLevel Limited
$quotaSettings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew
$null = Register-ScheduledTask -TaskName $quotaTaskName -Action $quotaAction -Trigger $quotaTrigger -Principal $quotaPrincipal -Settings $quotaSettings -Force
Write-Output 'Automatic startup enabled for the current Windows user.'
