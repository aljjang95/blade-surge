@echo off
setlocal
if not defined ProgramData set "ProgramData=C:\ProgramData"
if not defined ALLUSERSPROFILE set "ALLUSERSPROFILE=%ProgramData%"
if not defined TMP set "TMP=%TEMP%"
cd /d "%~dp0"
if not "%~1"=="" goto run
echo TLL - Blender Studio
echo 1. Open editable Blender master
echo 2. Export saved selection and verify GLB
echo 3. Check local connection
set "ACTION="
choice /c 123 /n /m "Select 1, 2 or 3: "
set "PICK=%ERRORLEVEL%"
if "%PICK%"=="1" set "ACTION=open"
if "%PICK%"=="2" set "ACTION=export"
if "%PICK%"=="3" set "ACTION=doctor"
if not defined ACTION exit /b 2
"C:\Program Files\nodejs\node.exe" "%~dp0tools\studio\blender-pipeline.mjs" %ACTION%
set "CODE=%ERRORLEVEL%"
pause
exit /b %CODE%
:run
"C:\Program Files\nodejs\node.exe" "%~dp0tools\studio\blender-pipeline.mjs" %*
exit /b %ERRORLEVEL%
