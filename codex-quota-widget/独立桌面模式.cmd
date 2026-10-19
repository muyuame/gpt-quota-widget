@echo off
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-quota.ps1" -Desktop
if errorlevel 1 pause
