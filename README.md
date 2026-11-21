# Quill

Quill is a Windows app for reading and editing PDFs. Files stay on this computer. The original file is never overwritten. Save a copy writes a new one.

The current installer is the [latest release](https://github.com/mtironridgelabs/quillpdf/releases/latest).

## Install

Download `Quill_*_x64-setup.exe` from that release and run it.

The install is per user and does not ask for an administrator password. Quill appears in Open with. It does not change the default PDF app. On first launch, a button opens the Windows default-apps page if you want to choose Quill yourself.

To update, open Quill with no file open and choose Update.

## What it does

- Open a PDF, including from Explorer
- Reorder, rotate, insert, extract, and remove pages
- Fit the page or the width, and zoom
- Present a page and mark it up
- Fill existing form fields, and add a text box
- Print
- Save a copy

A password-protected PDF is refused.

A PDF that is locked with restrictions, but has no password, can still have its existing fields filled. Save an unlocked copy to keep those fields editable, or a flattened copy to paint the answers onto the pages. A new text box on a locked PDF can only be saved as a picture.

Leaving forms mode keeps the answers on the page. They are written into a file only when you save a copy.

## Build

Releases are built by GitHub Actions on `windows-latest` when a `v*` tag is pushed. The workflow needs the Actions secret `TAURI_SIGNING_PRIVATE_KEY`. Do not commit that key.

Local checks that do not need Windows:

```sh
npm ci
npm test
npm run typecheck
```

## Copyright

Copyright (c) 2026 Mike Hixson. All rights reserved.

This source is published so the installer can be downloaded. No license is granted to copy, modify, or redistribute it. See [COPYRIGHT](COPYRIGHT).
