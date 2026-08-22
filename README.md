# TreeFrogUI Installer

Electron installer for a clean TreeFrogUI SD card setup.

The guided flow:

1. Choose the handheld (R36SX v2.6 and v2.7 are separate choices).
2. Select the mounted SD card.
3. Confirm the destructive FAT32 format.
4. Download and restore the matching stock backup, then overlay the latest TreeFrogUI release and device boot overlay.

Formatting is currently supported on Linux through `pkexec`, `mkfs.vfat`, and `udisksctl`. The app always shows the exact block device and asks for confirmation immediately before erasing it.

After installation, the app links to [Scraper Mini for TreeFrogUI](https://github.com/tzubertowski/mini-scraper-cfw/releases) for box art, screenshots, and title screens.

## Development

```sh
npm install
npm start
```

Package distributables with `npm run package` or `npm run make`.
