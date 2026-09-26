@echo off
setlocal
rem Spread Helper kurulumu - kullanici klasorune kopyalar (yonetici izni gerekmez).
rem Hedef: %APPDATA%\Adobe\CEP\extensions\com.badideagency.spread.helper
rem Bu klasordeki eklenti Adobe ZXPSignCmd ile imzali (self-signed). Kayit defterine DOKUNMAZ.
set "SRC=%~dp0com.badideagency.spread.helper"
set "DEST=%APPDATA%\Adobe\CEP\extensions\com.badideagency.spread.helper"
if not exist "%SRC%\CSXS\manifest.xml" (
  echo HATA: "%SRC%" bulunamadi. Zip'i once bir klasore cikart, sonra KUR.cmd'yi o klasorden calistir.
  pause
  exit /b 1
)
echo Spread Helper kuruluyor:
echo   %DEST%
if exist "%DEST%" rmdir /s /q "%DEST%"
xcopy /e /i /q /y "%SRC%" "%DEST%" >nul
if errorlevel 1 (
  echo HATA: kopyalanamadi.
  pause
  exit /b 1
)
echo.
echo Tamam. Premiere Pro'yu KAPATIP yeniden ac.
echo Spread panelinde "Yardimci: bagli" yazmali. Yazmazsa BENIOKU.txt - adim 3.
pause
