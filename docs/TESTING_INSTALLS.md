# Install testing checklist

One-page checklist for manually verifying a Statly installer on a clean
machine. Run this for each target after a CI build: macOS Apple Silicon
(`aarch64-apple-darwin`), macOS Intel (`x86_64-apple-darwin`), and
Windows 10/11 (`x86_64-pc-windows-msvc`).

Record results in the table at the bottom.

## 1. Download

- Get the artifact from the GitHub Actions run (Summary page → Artifacts):
  `statly-aarch64-apple-darwin.dmg`, `statly-x86_64-apple-darwin.dmg`, or
  `statly-x86_64-pc-windows-msvc-setup`.
- Note the download start time (used for time-to-ready below).

## 2. Install

**macOS:** open the `.dmg`, drag `Statly.app` to `/Applications`.

**Windows:** run the `*-setup.exe`, accept defaults.

## 3. First launch

**macOS — Gatekeeper:**
- Double-click the app. If macOS blocks it ("cannot be opened because
  the developer cannot be verified"):
  - Right-click (or Control-click) the app → **Open** → **Open Anyway**, or
  - Terminal fallback: `xattr -dr com.apple.quarantine /Applications/Statly.app`
    then relaunch.

**Windows — SmartScreen:**
- If SmartScreen blocks the installer or app ("Windows protected your PC"):
  click **More info** → **Run anyway**.

## 4. Confirm engine ready

- Wait for the "engine ready" card in the app.
- Confirm it shows version numbers (app version + engine version).
- Record wall-clock time from download start (step 1) to this card
  appearing — this is "time-to-ready."

## 5. Theme switching

- Switch **Light → Dark → System** in settings.
- Confirm the UI updates immediately and matches OS theme when set to
  System (toggle OS appearance to verify).

## 6. Quit — confirm no orphan engine process

- Quit the app normally (Cmd+Q / Alt+F4 or close button).
- **macOS:** open Activity Monitor, search "statly-engine" — confirm no
  process remains after quit (check a few seconds after, not instantly).
- **Windows:** open Task Manager → Details tab, search "statly-engine" —
  confirm no process remains after quit.

## 7. Relaunch

- Reopen the app from Applications / Start Menu.
- Confirm it starts cleanly (no leftover state issues, engine reaches
  ready again).

## 8. Uninstall

**macOS:** drag `Statly.app` from `/Applications` to Trash, empty Trash.
Confirm no `statly-engine` process lingers afterward (Activity Monitor).

**Windows:** Settings → Apps → Installed apps → Statly → Uninstall (or
Control Panel → Programs and Features). Confirm no `statly-engine`
process lingers afterward (Task Manager).

## Results log

| Target | OS version | Tester | Date | Time-to-ready | Pass/Fail | Notes |
|---|---|---|---|---|---|---|
| macOS Apple Silicon | | | | | | |
| macOS Intel | | | | | | |
| Windows 10/11 | | | | | | |
