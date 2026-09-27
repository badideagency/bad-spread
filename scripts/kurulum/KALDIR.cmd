@echo off
setlocal EnableExtensions
title Spread 1.1.0 kaldirma
rem ---------------------------------------------------------------------------------------------------------------
rem Spread 1.1.0 - KUR.cmd'nin yaptigi her seyi geri alir. Yonetici izni ISTEMEZ; yalniz kullanicinin kendi alanina dokunur:
rem   1) Spread paneli: Adobe UnifiedPluginInstallerAgent /remove "Spread" (bulunamazsa: Creative Cloud > Eklentiler)
rem   2) Spread Helper klasoru: %APPDATA%\Adobe\CEP\extensions\com.badideagency.spread.helper
rem   3) PlayerDebugMode (HKCU\Software\Adobe\CSXS.11 / CSXS.12): KUR.cmd ONCESI degerlerine (onceki.txt) - yoksa silinir
rem   4) Spread verileri: %APPDATA%\BadIdeaAgency\Spread, \SpreadHelper, \SpreadKurulum ve %TEMP%\spread-helper.log
rem   Masaustundeki SpreadRapor_*.txt dosyalarina dokunulmaz (masaustune yazilamayip veri klasorune dusenler silinir).
rem ---------------------------------------------------------------------------------------------------------------
set "DEST=%APPDATA%\Adobe\CEP\extensions\com.badideagency.spread.helper"
set "BASE=%APPDATA%\BadIdeaAgency"
set "STATE=%BASE%\SpreadKurulum"
set "UPIA_DIR=Adobe\Adobe Desktop Common\RemoteComponents\UPI\UnifiedPluginInstallerAgent\UnifiedPluginInstallerAgent.exe"
set "UPIA="
if defined CommonProgramW6432 if exist "%CommonProgramW6432%\%UPIA_DIR%" set "UPIA=%CommonProgramW6432%\%UPIA_DIR%"
if not defined UPIA if exist "%CommonProgramFiles%\%UPIA_DIR%" set "UPIA=%CommonProgramFiles%\%UPIA_DIR%"
if not defined UPIA if exist "C:\Program Files\Common Files\%UPIA_DIR%" set "UPIA=C:\Program Files\Common Files\%UPIA_DIR%"

net session >nul 2>&1
if not errorlevel 1 (
  echo.
  echo  Bu betigi YONETICI OLARAK calistirma.
  echo  KALDIR.cmd'ye normal cift tikla. Hicbir sey degismedi.
  echo.
  pause
  exit /b 1
)

echo Spread kaldiriliyor...
echo.

rem 1) Spread paneli (Adobe kurucusunun ciktisi ekranda kalir)
set "R_PANEL=YOK"
if not defined UPIA goto :helper
"%UPIA%" /remove "Spread"
if errorlevel 1 (set "R_PANEL=HATA") else (set "R_PANEL=OK")

:helper

rem 2) Spread Helper
set "R_HELPER=OK"
if exist "%DEST%" rmdir /s /q "%DEST%" >nul 2>&1
if exist "%DEST%" set "R_HELPER=HATA"

rem 3) PlayerDebugMode: KUR.cmd oncesi hale
set "R_DEBUG=BILINMIYOR"
if exist "%STATE%\onceki.txt" set "R_DEBUG=OK"
if "%R_DEBUG%"=="OK" for /f "usebackq tokens=1,2,3 delims==;" %%K in ("%STATE%\onceki.txt") do call :restore %%K "%%L" "%%M"

rem 4) Spread verileri
if exist "%BASE%\Spread" rmdir /s /q "%BASE%\Spread" >nul 2>&1
if exist "%BASE%\SpreadHelper" rmdir /s /q "%BASE%\SpreadHelper" >nul 2>&1
if exist "%TEMP%\spread-helper.log" del /q "%TEMP%\spread-helper.log" >nul 2>&1
if "%R_DEBUG%"=="OK" if exist "%STATE%" rmdir /s /q "%STATE%" >nul 2>&1
rmdir "%BASE%" >nul 2>&1

echo.
echo ================================================================
echo   Spread 1.1.0 kaldirma
echo ================================================================
if "%R_PANEL%"=="OK" echo   [tamam] Adobe kurucusu Spread panelini kaldirdigini bildirdi ^(ciktisi yukarida^)
if "%R_PANEL%"=="HATA" echo   [ !!  ] Spread paneli kaldirilamadi - Creative Cloud ^> Eklentiler'den kaldir
if "%R_PANEL%"=="YOK" echo   [ !!  ] Adobe kurucusu bulunamadi - Creative Cloud ^> Eklentiler'den kaldir
if "%R_HELPER%"=="OK" echo   [tamam] Spread Helper silindi
if not "%R_HELPER%"=="OK" echo   [HATA ] Spread Helper silinemedi - Premiere acik mi? Kapat, tekrar calistir
if "%R_DEBUG%"=="OK" echo   [tamam] PlayerDebugMode kurulum oncesi haline dondu
if "%R_DEBUG%"=="HATA" echo   [HATA ] PlayerDebugMode geri yuklenemedi - "%STATE%\onceki.txt" dosyasina bak
if "%R_DEBUG%"=="BILINMIYOR" echo   [ !!  ] Kurulum oncesi PlayerDebugMode bilinmiyor ^(onceki.txt yok^) - degistirilmedi
echo   [tamam] Spread verileri silindi - masaustundeki SpreadRapor dosyalari duruyor
echo.
echo   Premiere Pro'yu yeniden baslat.
echo ================================================================
pause
exit /b 0

:restore
rem %1 = CSXS.11 / CSXS.12 ; %2 = tur ya da YOK ; %3 = deger
set "K=%~1"
set "T=%~2"
set "V=%~3"
if /i not "%T%"=="YOK" goto :restoreval
rem kurulumdan once yoktu -> degeri sil (zaten yoksa bir sey yapma)
reg query "HKCU\Software\Adobe\%K%" /v PlayerDebugMode >nul 2>&1
if errorlevel 1 goto :eof
reg delete "HKCU\Software\Adobe\%K%" /v PlayerDebugMode /f >nul 2>&1
rem sonuc cikis koduna degil, okunan duruma gore
reg query "HKCU\Software\Adobe\%K%" /v PlayerDebugMode >nul 2>&1
if not errorlevel 1 set "R_DEBUG=HATA"
goto :eof
:restoreval
reg add "HKCU\Software\Adobe\%K%" /v PlayerDebugMode /t %T% /d "%V%" /f >nul 2>&1
rem sonuc okunan degere gore (regex yok)
set "BACK="
for /f "tokens=2,*" %%A in ('reg query "HKCU\Software\Adobe\%K%" /v PlayerDebugMode 2^>nul ^| findstr "PlayerDebugMode"') do if /i "%%A"=="%T%" set "BACK=%%B"
if not "%BACK%"=="%V%" set "R_DEBUG=HATA"
goto :eof
