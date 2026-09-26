@echo off
setlocal
rem Spread Helper 0.3.2 kurulumu - kullanici klasorune kopyalar (yonetici izni gerekmez).
rem Hedef: %APPDATA%\Adobe\CEP\extensions\com.badideagency.spread.helper
rem Bu klasordeki eklenti IMZASIZDIR: CEP 12'nin gelistirici kipi (PlayerDebugMode=1) gerekir -> PlayerDebugMode_CSXS12.reg
rem Bu betik kayit defterine YAZMAZ; yalniz PlayerDebugMode'u OKUR ve yoksa uyarir.
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
xcopy /e /i /q /y /h "%SRC%" "%DEST%" >nul
if errorlevel 1 (
  echo HATA: kopyalanamadi.
  pause
  exit /b 1
)
echo.
reg query "HKCU\Software\Adobe\CSXS.12" /v PlayerDebugMode 2>nul | findstr /r /c:"PlayerDebugMode *REG_SZ *1" >nul
if errorlevel 1 (
  echo DIKKAT: PlayerDebugMode ayarli DEGIL. Yardimci imzasiz oldugu icin Premiere onu YUKLEMEZ.
  echo   Cozum: PlayerDebugMode_CSXS12.reg dosyasina cift tikla, Evet de.
) else (
  echo PlayerDebugMode = "1" - tamam.
)
echo.
echo Simdi: Premiere Pro'yu KAPATIP yeniden ac.
echo Sonra: Window ^> Extensions (Legacy) ^> Spread Helper  - paneli ac ve acik birak (calisma alaninda hatirlanir).
echo Panelde "dinliyor: localhost:47731" yazmali. Yazmazsa BENIOKU.txt - adim 4.
pause
