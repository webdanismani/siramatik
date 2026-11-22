@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Siramatik Sunucusu

where python >nul 2>nul
if %errorlevel%==0 (
  python sunucu.py %*
  goto son
)
where py >nul 2>nul
if %errorlevel%==0 (
  py -3 sunucu.py %*
  goto son
)
echo.
echo  Python bulunamadi.
echo  https://www.python.org/downloads/ adresinden kurun
echo  (kurulumda "Add python.exe to PATH" kutusunu isaretleyin).
echo.

:son
pause
