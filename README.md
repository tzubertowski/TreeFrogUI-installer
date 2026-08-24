# TreeFrogUI Installer

Electron installer for a clean TreeFrogUI SD card setup.

The guided flow:

1. Choose the handheld (R36SX v2.6 and v2.7 are separate choices).
2. Select the mounted SD card.
3. Confirm the destructive FAT32 format.
4. Download and restore the matching stock backup, then overlay the latest TreeFrogUI release and device boot overlay.

Formatting is supported on Linux through `pkexec`, `mkfs.vfat`, and `udisksctl`, and on Windows through the built-in Storage PowerShell module. Windows fresh installs must be run as Administrator. The app only accepts removable USB/SD volumes on Windows, always shows the exact device, and asks for confirmation immediately before erasing it. Archive extraction uses a bundled 7-Zip executable; users do not need to install it separately.

After installation, the app links to [Scraper Mini for TreeFrogUI](https://github.com/tzubertowski/mini-scraper-cfw/releases) for box art, screenshots, and title screens.

## Development

```sh
npm install
npm start
```

Package distributables with `npm run package` or `npm run make`.

## Automated builds

GitHub Actions runs syntax checks on every push. Pushing a tag such as `v0.1.0`
builds Linux, Windows, and macOS Electron ZIPs and attaches them to a GitHub
release. You can also open **Actions → release → Run workflow** and leave the
tag empty for build-only artifacts, or enter an existing tag to rebuild its
release assets.
