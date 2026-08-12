!include "StrFunc.nsh"
${StrStr}
${StrRep}

!macro customInstall
  ; Install a stable command shim beside the application. The shim delegates to
  ; the exact installed executable so `openwaggle mcp ...` uses the same build.
  FileOpen $0 "$INSTDIR\openwaggle.cmd" w
  FileWrite $0 '@"%~dp0OpenWaggle.exe" %*$\r$\n'
  FileClose $0

  ; Add the per-user install directory once and notify existing shells that the
  ; environment changed. Machine installs still use a user-scoped CLI entry.
  ReadRegStr $0 HKCU "Environment" "Path"
  ${StrStr} $1 ";$0;" ";$INSTDIR;"
  StrCmp $1 "" 0 openwaggle_cli_path_done
  StrCmp $0 "" 0 openwaggle_cli_path_append
  WriteRegExpandStr HKCU "Environment" "Path" "$INSTDIR"
  Goto openwaggle_cli_path_notify
openwaggle_cli_path_append:
  WriteRegExpandStr HKCU "Environment" "Path" "$0;$INSTDIR"
openwaggle_cli_path_notify:
  SendMessage ${HWND_BROADCAST} ${WM_SETTINGCHANGE} 0 "STR:Environment" /TIMEOUT=5000
openwaggle_cli_path_done:
!macroend

!macro customUnInstall
  Delete "$INSTDIR\openwaggle.cmd"

  ; Remove only this exact install directory from the user PATH.
  ReadRegStr $0 HKCU "Environment" "Path"
  StrCpy $1 ";$0;"
  ${StrRep} $1 "$1" ";$INSTDIR;" ";"
  StrCpy $2 $1 1
  StrCmp $2 ";" 0 openwaggle_cli_path_trim_end
  StrCpy $1 $1 "" 1
openwaggle_cli_path_trim_end:
  StrCmp $1 "" openwaggle_cli_path_write
  StrLen $2 $1
  IntOp $2 $2 - 1
  StrCpy $3 $1 1 $2
  StrCmp $3 ";" 0 openwaggle_cli_path_write
  StrCpy $1 $1 $2
openwaggle_cli_path_write:
  WriteRegExpandStr HKCU "Environment" "Path" "$1"
  SendMessage ${HWND_BROADCAST} ${WM_SETTINGCHANGE} 0 "STR:Environment" /TIMEOUT=5000
!macroend
