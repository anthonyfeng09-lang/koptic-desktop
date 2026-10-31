@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Koptic Desktop needs Node.js. Installing it now, this takes a minute...
  where winget >nul 2>nul
  if errorlevel 1 goto nonode
  winget install --id OpenJS.NodeJS.LTS -e --silent --accept-package-agreements --accept-source-agreements
  rem winget doesn't refresh this window's PATH, so add Node's usual folder by hand.
  set "PATH=%PATH%;%ProgramFiles%\nodejs"
  where node >nul 2>nul
  if errorlevel 1 goto nonode
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
exit /b 0

:nonode
echo Couldn't install Node.js by itself. Get the LTS version from https://nodejs.org, install it, then run this again.
pause
exit /b 1
