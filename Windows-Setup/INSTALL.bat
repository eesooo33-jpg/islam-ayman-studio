@echo off
cd /d "%~dp0"
echo Preparing Islam Ayman Studio setup...
copy /b setup00.part + setup01.part "Islam-Ayman-Studio-Setup-1.3.0.exe" >nul
if errorlevel 1 (
  echo Could not build the setup file. Make sure setup00.part and setup01.part are in this folder.
  pause
  exit /b 1
)
start "" "Islam-Ayman-Studio-Setup-1.3.0.exe"
