; PDF Open with registration that does not become the default.
;
; Tauri's fileAssociations path runs APP_ASSOCIATE, which writes the default
; value of HKCU\Software\Classes\.pdf and makes Quill the user's PDF app.
; Do not set bundle.fileAssociations. This hook only adds Quill to Open with.
; The first-launch button in the app opens ms-settings:defaultapps so the
; user can choose the default themselves.

!macro NSIS_HOOK_POSTINSTALL
  WriteRegStr HKCU "Software\Classes\Quill.PDF" "" "PDF Document"
  WriteRegStr HKCU "Software\Classes\Quill.PDF\DefaultIcon" "" "$\"$INSTDIR\${MAINBINARYNAME}.exe$\",0"
  WriteRegStr HKCU "Software\Classes\Quill.PDF\shell\open" "" "Open with ${PRODUCTNAME}"
  WriteRegStr HKCU "Software\Classes\Quill.PDF\shell\open\command" "" "$\"$INSTDIR\${MAINBINARYNAME}.exe$\" $\"%1$\""

  ; The value's name is the ProgID. The data stays empty.
  ; This does not write Software\Classes\.pdf's default value.
  WriteRegStr HKCU "Software\Classes\.pdf\OpenWithProgids" "Quill.PDF" ""

  WriteRegStr HKCU "Software\Classes\Applications\${MAINBINARYNAME}.exe" "FriendlyAppName" "${PRODUCTNAME}"
  WriteRegStr HKCU "Software\Classes\Applications\${MAINBINARYNAME}.exe\shell\open\command" "" "$\"$INSTDIR\${MAINBINARYNAME}.exe$\" $\"%1$\""
  WriteRegStr HKCU "Software\Classes\Applications\${MAINBINARYNAME}.exe\SupportedTypes" ".pdf" ""

  WriteRegStr HKCU "Software\${PRODUCTNAME}\Capabilities" "ApplicationName" "${PRODUCTNAME}"
  WriteRegStr HKCU "Software\${PRODUCTNAME}\Capabilities" "ApplicationDescription" "Quill PDF reader"
  WriteRegStr HKCU "Software\${PRODUCTNAME}\Capabilities\FileAssociations" ".pdf" "Quill.PDF"
  WriteRegStr HKCU "Software\RegisteredApplications" "${PRODUCTNAME}" "Software\${PRODUCTNAME}\Capabilities"

  !insertmacro UPDATEFILEASSOC
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  DeleteRegValue HKCU "Software\Classes\.pdf\OpenWithProgids" "Quill.PDF"
  DeleteRegKey HKCU "Software\Classes\Quill.PDF"
  DeleteRegKey HKCU "Software\Classes\Applications\${MAINBINARYNAME}.exe"
  DeleteRegValue HKCU "Software\RegisteredApplications" "${PRODUCTNAME}"
  DeleteRegKey HKCU "Software\${PRODUCTNAME}"
  !insertmacro UPDATEFILEASSOC
!macroend
