@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul 2>&1
title Sla sammen agentens arbeid og rull ut

rem ---------------------------------------------------------------------------
rem Ett trykk i stedet for fem kommandoer: finner grenen agenten bygget paa,
rem slaar den inn i master, ruller ut til produksjon og pusher.
rem
rem Stopper heller enn aa gjette. Hvert steg som kan feile sjekkes, og skriptet
rem avslutter med en forklaring i stedet for aa fortsette paa halvt arbeid.
rem ---------------------------------------------------------------------------

cd /d "%~dp0.."
echo.
echo   SLA SAMMEN OG RULL UT
echo   =====================
echo   Repo: %CD%
echo.

rem --- 1. Er arbeidstreet rent? -----------------------------------------------
rem Bare SPORTE filer teller. Usporede filer (scratch, .wrangler-cache) roeres
rem ikke av en sammenslaaing, og skal ikke staa i veien for den.
for /f "delims=" %%A in ('git status --porcelain --untracked-files^=no') do (
  echo   STOPP: du har ulagrede endringer i filer som er sporet.
  echo          Commit eller forkast dem foerst - ellers blir de blandet inn.
  echo.
  git status --short --untracked-files=no
  goto :slutt
)

rem --- 2. Finn agentgrenene ----------------------------------------------------
set ANTALL=0
for /f "delims=" %%B in ('git branch --list "agent/*" --format="%%(refname:short)"') do (
  set /a ANTALL+=1
  set "GREN[!ANTALL!]=%%B"
)

if %ANTALL%==0 (
  echo   Ingen agentgrener aa slaa sammen.
  echo.
  echo   Agentene bygger paa grener som heter agent/... Naar noe staar som
  echo   "ferdig" i /admin, dukker grenen opp her.
  goto :slutt
)

if %ANTALL%==1 (
  set "VALGT=!GREN[1]!"
  echo   Fant en gren: !VALGT!
) else (
  echo   Fant %ANTALL% grener:
  echo.
  for /l %%I in (1,1,%ANTALL%) do echo     %%I^) !GREN[%%I]!
  echo.
  set /p NR="  Hvilken vil du slaa sammen? (1-%ANTALL%, eller Enter for aa avbryte): "
  if "!NR!"=="" goto :slutt
  set "VALGT=!GREN[%NR%]!"
  if "!VALGT!"=="" (
    echo   Ugyldig valg.
    goto :slutt
  )
)

echo.
echo   Endringer som kommer inn:
echo.
git diff master..!VALGT! --stat
echo.
set /p JA="  Slaa sammen og rull ut til produksjon? (j/N): "
if /i not "!JA!"=="j" (
  echo   Avbrutt. Ingenting er endret.
  goto :slutt
)

rem --- 3. Sla sammen -----------------------------------------------------------
echo.
echo   [1/4] Slaar sammen...
git checkout master >nul 2>&1
git merge --no-ff "!VALGT!" -m "Sla sammen !VALGT!"
if errorlevel 1 (
  echo.
  echo   STOPP: sammenslaaingen gikk ikke rent - det er en konflikt.
  echo          Ingenting er rullet ut. Loes konflikten, eller kjoer:
  echo            git merge --abort
  goto :slutt
)

rem --- 4. Rull ut --------------------------------------------------------------
echo.
echo   [2/4] Ruller ut til produksjon...
call npx wrangler pages deploy . --project-name oppdragsoversikt --branch master --commit-dirty=true
if errorlevel 1 (
  echo.
  echo   STOPP: utrullingen feilet. Sammenslaaingen ligger lokalt, men er
  echo          IKKE ute og IKKE pushet. Proev igjen, eller kjoer:
  echo            git reset --hard origin/master
  goto :slutt
)

rem --- 5. Push -----------------------------------------------------------------
echo.
echo   [3/4] Pusher til GitHub...
git push origin master
if errorlevel 1 (
  echo   Advarsel: pushen feilet, men utrullingen er ute. Proev: git push origin master
)

rem --- 6. Rydd -----------------------------------------------------------------
echo.
echo   [4/4] Rydder bort grenen...
git branch -d "!VALGT!"

echo.
echo   FERDIG. !VALGT! er slaatt sammen, rullet ut og pushet.
echo   Sjekk resultatet: https://oppdragsoversikt.pages.dev/admin/
echo.

:slutt
echo.
pause
endlocal
