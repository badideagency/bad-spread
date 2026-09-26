@echo off
setlocal EnableExtensions
title Spread 1.0.0 kurulumu
rem ---------------------------------------------------------------------------------------------------------------
rem Spread 1.0.0 - tek tik kurulum (Windows). Yonetici izni ISTEMEZ; yalniz kullanicinin kendi alanina yazar:
rem   a) HKCU\Software\Adobe\CSXS.12 ve CSXS.11: PlayerDebugMode = "1" (imzasiz Spread Helper icin; onceki degerler saklanir)
rem   b) %APPDATA%\Adobe\CEP\extensions\com.badideagency.spread.helper  (Spread Helper, eskisinin ustune)
rem   c) spread.ccx -> Adobe UnifiedPluginInstallerAgent /install (Adobe belgesi: developer.adobe.com/premiere-pro/uxp/plugins/
rem      distribution/install/ ; UPIA yonetici modunda CALISMAZ). Bulunamazsa: spread.ccx'e cift tikla.
rem   Onceki PlayerDebugMode degerleri: %APPDATA%\BadIdeaAgency\SpreadKurulum\onceki.txt (KALDIR.cmd geri yukler)
rem ---------------------------------------------------------------------------------------------------------------
set "HERE=%~dp0"
set "SRC=%HERE%SpreadHelper"
set "CCX=%HERE%spread.ccx"
set "DEST=%APPDATA%\Adobe\CEP\extensions\com.badideagency.spread.helper"
set "STATE=%APPDATA%\BadIdeaAgency\SpreadKurulum"
set "UPIA_DIR=Adobe\Adobe Desktop Common\RemoteComponents\UPI\UnifiedPluginInstallerAgent\UnifiedPluginInstallerAgent.exe"
set "UPIA="
if defined CommonProgramW6432 if exist "%CommonProgramW6432%\%UPIA_DIR%" set "UPIA=%CommonProgramW6432%\%UPIA_DIR%"
if not defined UPIA if exist "%CommonProgramFiles%\%UPIA_DIR%" set "UPIA=%CommonProgramFiles%\%UPIA_DIR%"
if not defined UPIA if exist "C:\Program Files\Common Files\%UPIA_DIR%" set "UPIA=C:\Program Files\Common Files\%UPIA_DIR%"

rem yonetici olarak calisiyorsa DUR (HKCU baska kullanicinin olabilir; UPIA yonetici modunda calismaz)
net session >nul 2>&1
if not errorlevel 1 (
  echo.
  echo  Bu betigi YONETICI OLARAK calistirma.
  echo  KUR.cmd'ye normal cift tikla. Hicbir sey degismedi.
  echo.
  pause
  exit /b 1
)
if not exist "%SRC%\CSXS\manifest.xml" goto :nozip
if not exist "%CCX%" goto :nozip

echo Spread 1.0.0 kuruluyor...
echo.

rem a) onceki PlayerDebugMode degerlerini (yalniz ILK kurulumda) sakla, sonra "1" yap
if not exist "%STATE%" mkdir "%STATE%" >nul 2>&1
if not exist "%STATE%\onceki.txt" call :saveprev 11
if not exist "%STATE%\onceki.txt" goto :nostate
call :has12
if errorlevel 1 call :saveprev 12
call :has12
if errorlevel 1 goto :nostate
reg add "HKCU\Software\Adobe\CSXS.12" /v PlayerDebugMode /t REG_SZ /d 1 /f >nul 2>&1
reg add "HKCU\Software\Adobe\CSXS.11" /v PlayerDebugMode /t REG_SZ /d 1 /f >nul 2>&1
rem sonuc cikis koduna degil, okunan degere gore
set "R_DEBUG=OK"
call :isone 12
if errorlevel 1 set "R_DEBUG=HATA"
call :isone 11
if errorlevel 1 set "R_DEBUG=HATA"

rem b) Spread Helper (eskisinin ustune)
if exist "%DEST%" rmdir /s /q "%DEST%" >nul 2>&1
xcopy /e /i /q /y /h "%SRC%" "%DEST%" >nul 2>&1
rem sonuc cikis koduna degil, kopyalanan dosyalara gore
set "R_HELPER=OK"
for %%F in ("CSXS\manifest.xml" ".debug" "index.html" "js\helper.js" "js\panel.js" "js\spread-core.js" "jsx\host.jsx") do if not exist "%DEST%\%%~F" set "R_HELPER=HATA"

rem c) Spread paneli (spread.ccx) - Adobe'nin kurucusu; ciktisi ekranda kalir (cls yok)
set "R_PANEL=YOK"
if not defined UPIA goto :summary
echo Spread paneli kuruluyor - Adobe UnifiedPluginInstallerAgent:
"%UPIA%" /install "%CCX%"
if errorlevel 1 (set "R_PANEL=HATA") else (set "R_PANEL=OK")

:summary
echo.
echo ================================================================
echo   Spread 1.0.0 kurulumu
echo ================================================================
if "%R_DEBUG%"=="OK" echo   [tamam] Gelistirici kipi PlayerDebugMode = 1 - CSXS.11 ve CSXS.12
if not "%R_DEBUG%"=="OK" echo   [HATA ] PlayerDebugMode yazilamadi
if "%R_HELPER%"=="OK" echo   [tamam] Spread Helper kopyalandi
if not "%R_HELPER%"=="OK" echo   [HATA ] Spread Helper kopyalanamadi - hedef: "%DEST%"
if "%R_PANEL%"=="OK" echo   [tamam] Adobe kurucusu Spread panelini kurdugunu bildirdi ^(ciktisi yukarida^)
if "%R_PANEL%"=="HATA" echo   [ !!  ] Spread paneli kurulamadi - spread.ccx dosyasina cift tikla ^(Creative Cloud kurar^)
if "%R_PANEL%"=="YOK" echo   [ !!  ] Adobe kurucusu bulunamadi - spread.ccx dosyasina cift tikla ^(Creative Cloud kurar^)
echo.
echo   Simdi:
echo     1. Premiere Pro'yu KAPATIP yeniden ac.
echo     2. Window ^> Extensions (Legacy) ^> Spread Helper   - kucuk paneli ac, acik birak.
echo     3. Window ^> UXP Plugins ^> Spread                  - ana paneli ac.
echo        Menude Spread yoksa: spread.ccx dosyasina cift tikla.
echo.
echo   Kaldirmak icin: KALDIR.cmd  -  Kullanim: OKU_BENI.txt
echo ================================================================
pause
exit /b 0

:isone
rem PlayerDebugMode REG_SZ "1" mi (cikis 0 = evet) - regex yok, reg query ciktisi alanlara bolunur
set "ONE=1"
for /f "tokens=2,*" %%A in ('reg query "HKCU\Software\Adobe\CSXS.%1" /v PlayerDebugMode 2^>nul ^| findstr "PlayerDebugMode"') do if /i "%%A"=="REG_SZ" if "%%B"=="1" set "ONE=0"
exit /b %ONE%

:has12
rem onceki.txt'te CSXS.12 satiri var mi (cikis 0 = evet) - findstr yok, satirlar "=" ile bolunur
set "HAS=1"
for /f "usebackq tokens=1 delims==" %%K in ("%STATE%\onceki.txt") do if /i "%%K"=="CSXS.12" set "HAS=0"
exit /b %HAS%

:saveprev
reg query "HKCU\Software\Adobe\CSXS.%1" /v PlayerDebugMode >nul 2>&1
if errorlevel 1 (
  >>"%STATE%\onceki.txt" echo CSXS.%1=YOK
  goto :eof
)
set "PREVT=REG_SZ"
set "PREV="
for /f "tokens=2,*" %%A in ('reg query "HKCU\Software\Adobe\CSXS.%1" /v PlayerDebugMode ^| findstr "PlayerDebugMode"') do (
  set "PREVT=%%A"
  set "PREV=%%B"
)
>>"%STATE%\onceki.txt" echo CSXS.%1=%PREVT%;%PREV%
goto :eof

:nostate
echo.
echo  HATA: onceki ayarlar saklanamadi ^(%%APPDATA%%\BadIdeaAgency\SpreadKurulum^).
echo  Kayit defterine dokunulmadi, hicbir sey kurulmadi.
echo.
pause
exit /b 1

:nozip
echo.
echo  HATA: kurulum dosyalari bulunamadi: "%HERE%"
echo  Zip'i once bir klasore CIKART (sag tik ^> Tumunu ayikla), sonra KUR.cmd'yi o klasorden calistir.
echo.
pause
exit /b 1
