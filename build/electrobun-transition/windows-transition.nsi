; Electrobun transition installer for Windows (docs/electrobun-transition.md).
;
; Existing OpenWaggle installs are Electron NSIS installs updated by electron-updater. When the
; newest release offers this file as `openwaggle-<version>-x64.exe`, electron-updater downloads it,
; checks its sha512, and runs it as `<file> --updated /S --force-run` after the app quits.
; It then:
;   1. runs the Electrobun setup (embedded) and waits for it. The setup installs the app into
;      %LOCALAPPDATA%\<identifier>\<channel>\app, creates its shortcuts and starts the app;
;   2. only when the new launcher exists, runs the old Electron uninstaller silently, which removes
;      the old files, Start menu and desktop shortcuts, uninstall entry, PATH entry and CLI shim.
;      It is run without --delete-app-data, so %APPDATA%\openwaggle (all user data) stays;
;   3. writes the `openwaggle` CLI shim back into the old install directory, which is the one on
;      the user's PATH, pointing at the new launcher, and registers the openwaggle: link scheme;
;   4. on any failure leaves the Electron install untouched, restarts it, and says so.
;
; Defines (scripts/electrobun-transition/windows-transition-installer.ts): OUTFILE, VERSION,
; VERSION_QUAD, PRODUCT_NAME, APP_GUID, SETUP_DIR, SETUP_EXE, EB_IDENTIFIER, EB_CHANNEL, ICON.

Unicode true
!include "LogicLib.nsh"
!include "FileFunc.nsh"
!include "StrFunc.nsh"
!include "WinMessages.nsh"
${StrStr}

Name "${PRODUCT_NAME}"
OutFile "${OUTFILE}"
Icon "${ICON}"
RequestExecutionLevel user
SetCompressor /SOLID lzma
ShowInstDetails nevershow
AutoCloseWindow true
VIProductVersion "${VERSION_QUAD}"
VIAddVersionKey "ProductName" "${PRODUCT_NAME}"
VIAddVersionKey "FileDescription" "${PRODUCT_NAME} Setup"
VIAddVersionKey "ProductVersion" "${VERSION}"
VIAddVersionKey "FileVersion" "${VERSION}"

!define DOWNLOAD_URL "https://github.com/OpenWaggle/OpenWaggle/releases/latest"
!define TRANSITION_LOG "$LOCALAPPDATA\openwaggle-updater\electrobun-transition.log"

; Every channel installs the same executable name; only the display name (and so the
; uninstaller's name, "Uninstall OpenWaggle Beta.exe") differs (ADR 0032).
!define OLD_EXE "OpenWaggle.exe"

Var NewLauncher
Var OldInstallDir
Var OldUninstaller
Var LogHandle

!macro Log TEXT
  FileWrite $LogHandle "${TEXT}$\r$\n"
!macroend

Function RestartOldApp
  ${If} ${FileExists} "$OldInstallDir\${OLD_EXE}"
    Exec '"$OldInstallDir\${OLD_EXE}"'
  ${EndIf}
FunctionEnd

Function Fail
  Pop $0
  !insertmacro Log "failed: $0"
  FileClose $LogHandle
  Call RestartOldApp
  ; Shown even for an update (/S): the app quit for an install that did not happen.
  MessageBox MB_YESNO|MB_ICONEXCLAMATION "${PRODUCT_NAME} could not finish updating ($0).$\r$\n$\r$\nYour sessions and settings are unchanged, and the version you had is running again. Open the download page to install the new version yourself?" IDNO done
  ExecShell "open" "${DOWNLOAD_URL}"
done:
  SetErrorLevel 2
  Quit
FunctionEnd

Section "Install"
  CreateDirectory "$LOCALAPPDATA\openwaggle-updater"
  FileOpen $LogHandle "${TRANSITION_LOG}" a
  ${GetParameters} $R0
  !insertmacro Log "transition to ${VERSION} started: $R0"

  ReadRegStr $OldInstallDir HKCU "Software\${APP_GUID}" InstallLocation
  !insertmacro Log "Electron install: $OldInstallDir"
  StrCpy $NewLauncher "$LOCALAPPDATA\${EB_IDENTIFIER}\${EB_CHANNEL}\app\bin\launcher.exe"

  InitPluginsDir
  SetOutPath "$PLUGINSDIR\electrobun-setup"
  File /r "${SETUP_DIR}\*.*"
  ClearErrors
  ExecWait '"$PLUGINSDIR\electrobun-setup\${SETUP_EXE}"' $0
  ${If} ${Errors}
    Push "the setup did not start"
    Call Fail
  ${EndIf}
  !insertmacro Log "Electrobun setup exited with $0"
  ${IfNot} ${FileExists} "$NewLauncher"
    Push "the new app was not installed, setup exit code $0"
    Call Fail
  ${EndIf}
  SetOutPath "$TEMP"

  StrCpy $OldUninstaller ""
  ${If} $OldInstallDir != ""
    FindFirst $5 $6 "$OldInstallDir\Uninstall *.exe"
    FindClose $5
    ${If} $6 != ""
      StrCpy $OldUninstaller "$OldInstallDir\$6"
    ${EndIf}
  ${EndIf}
  ${If} $OldUninstaller != ""
    ; _?= runs the uninstaller in place, so ExecWait waits for it. Without --delete-app-data it
    ; keeps %APPDATA%\openwaggle; without --updated it also removes the old shortcuts.
    ExecWait '"$OldUninstaller" /S /currentuser _?=$OldInstallDir' $1
    !insertmacro Log "Electron uninstaller $OldUninstaller exited with $1"
    Delete "$OldUninstaller"
  ${Else}
    StrCpy $OldInstallDir "$LOCALAPPDATA\Programs\openwaggle"
  ${EndIf}

  ; The CLI shim keeps the directory existing installs put on PATH.
  CreateDirectory "$OldInstallDir"
  FileOpen $2 "$OldInstallDir\openwaggle.cmd" w
  FileWrite $2 '@"$NewLauncher" %*$\r$\n'
  FileClose $2
  ReadRegStr $3 HKCU "Environment" "Path"
  ${StrStr} $4 ";$3;" ";$OldInstallDir;"
  ${If} $4 == ""
    ${If} $3 == ""
      WriteRegExpandStr HKCU "Environment" "Path" "$OldInstallDir"
    ${Else}
      WriteRegExpandStr HKCU "Environment" "Path" "$3;$OldInstallDir"
    ${EndIf}
    SendMessage ${HWND_BROADCAST} ${WM_SETTINGCHANGE} 0 "STR:Environment" /TIMEOUT=5000
  ${EndIf}

  ; Session links (ADR 0056): the uninstaller removed the registration that launched the old exe.
  WriteRegStr HKCU "Software\Classes\openwaggle" "" "URL:OpenWaggle"
  WriteRegStr HKCU "Software\Classes\openwaggle" "URL Protocol" ""
  WriteRegStr HKCU "Software\Classes\openwaggle\shell\open\command" "" '"$NewLauncher" "%1"'

  !insertmacro Log "transition to ${VERSION} finished"
  FileClose $LogHandle
SectionEnd
