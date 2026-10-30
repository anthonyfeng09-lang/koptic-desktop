@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Koptic Desktop needs Node.js. Get the LTS version from https://nodejs.org, install it, then run this again.
  pause
  exit /b 1
)
echo Installing Koptic Desktop (about 100 MB, one time)...
call npm install --no-fund --no-audit
if errorlevel 1 (
  echo Install failed. Check your internet connection and try again.
  pause
  exit /b 1
)
powershell -NoProfile -Command "$s=(New-Object -ComObject WScript.Shell).CreateShortcut([Environment]::GetFolderPath(Desktop)+\Koptic.lnk); $s.TargetPath=wscript.exe; $s.Arguments=\"%~dp0Koptic.vbs\"; $s.IconLocation=%~dp0icon.ico; $s.WorkingDirectory=%~dp0; $s.Save()"
echo Done. Open Koptic from the shortcut on your desktop.
start "" wscript.exe "%~dp0Koptic.vbs"
