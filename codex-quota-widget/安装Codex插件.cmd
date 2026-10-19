@echo off
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0..\gpt-quota-plugin-source\scripts\install-plugin.ps1"
if errorlevel 1 goto failed
pause
exit /b 0
:failed
echo Plugin installation failed. See the error above.
pause
exit /b 1
