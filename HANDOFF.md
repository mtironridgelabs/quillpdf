# Quill handoff

The web app in this archive is the product. The Windows shell is not written yet.
Repository: https://github.com/mtironridgelabs/quillpdf
It is public and empty. Do not add a README, gitignore, or license from GitHub's form.
`.gitignore` and `COPYRIGHT` are already in this archive. There is no open-source license.

## What you do

1. Build the Tauri 2 Windows shell around this app and push it to `main`.
2. Do not commit an update private key. Ask Mike for it through a masked secret card, then store it as the Actions secret `TAURI_SIGNING_PRIVATE_KEY`.
3. Wait until Mike says the secret is stored. Then push the tag `v0.1.0`.

The installer is built by GitHub Actions on `windows-latest`, not on a developer machine.
Release asset: an NSIS `.exe`. Endpoint the app checks:

`https://github.com/mtironridgelabs/quillpdf/releases/latest/download/latest.json`

## Decisions already made

- Framework: Tauri 2, system WebView2. Frontend assets are embedded. The app works offline. The network is used only when Update is clicked.
- Install: per user. No administrator password. NSIS.
- Authenticode: none. Users click through SmartScreen. "Signed" means Tauri's updater key only, not a Windows certificate.
- File association: `.pdf`, so Quill appears in Open with. Do not try to seize the default silently. On first launch, a button opens Windows' default-apps page. The user confirms.
- Launch: the shell receives the PDF path and passes the bytes into the existing reader.
- One window. A second PDF focuses that window. If there are unsaved changes, ask first.
- Save a copy uses a Windows save dialog.
- Update button: home screen only, top right, beside Open. Hidden while a PDF is open.
- App id: `com.bridgetowealth.quill`. Display name: Quill.
- Version to tag first: `0.1.0`.

## Do not ship

`attachments/` was left out on purpose. It contains a private bank form. Never commit it.
