# LRMIS desktop app

LRMIS for staff computers. It is the same LRMIS website, in a window the computer protects: screenshots, screen
recording and screen sharing (Zoom, Meet, Teams) of the window come out black on Windows, and leave the window out on
Mac. Certificates and ID cards are shown on screen only here; in a normal browser their page asks to open them in this
app (website setting `CERTIFICATES_DESKTOP_ONLY=on`). Printing through the print program is not affected.

## Make the installer

1. Put the website address in `config.json` (`"server"`). Set `"fullScreen": true` to open full screen.
2. In this folder:

```bash
npm install
```

```bash
npm approve-scripts electron && npm rebuild electron
```

3. On a Mac, for Mac computers (the file appears in `dist/`):

```bash
npm run dist:mac
```

   On a Windows computer, for Windows computers:

```bash
npm run dist:win
```

The Mac file is not signed with an Apple certificate yet: the first time, right-click the app and choose Open. For
signed installers (no warning), add an Apple Developer ID and a Windows code-signing certificate.

## What is protected

- Every window of the app, including ones LRMIS opens (print preview, documents).
- No developer tools, no "Save page", no camera or microphone.
- Links to other sites open in the normal browser, not in the app.

## Limits

- On newer Macs, some screen-recording tools may still see the window; the normal screenshot keys and common screen
  sharing do not.
- A phone camera pointed at the screen can't be stopped.
- The website recognises the app by a mark it adds; it stops casual screenshots, not a determined expert.

## Try it without installing

```bash
npm start
```
