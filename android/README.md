# TreeFrogUI Android Installer

This is a separate native Android app. It does not change the Electron installer.

## Build

Open this `android/` directory in Android Studio with Android SDK Platform 35 installed, then build the `app` debug variant. Or use a local Gradle installation:

```sh
gradle assembleDebug
```

The APK is written to `app/build/outputs/apk/debug/app-debug.apk`. Install that APK on the handheld or an Android device with removable SD card support. The app needs internet access and the Android **All files access** setting to write the selected card's root. It is intended for sideloading; it is not configured for Google Play distribution.

## Install

1. Format the target SD card as FAT32 using a separate trusted tool before inserting it. Android cannot format the card from this app; the app never formats or erases a card.
2. Open the app and grant its All files access request in Android Settings.
3. Select the exact mounted removable card, device profile, and stable or prerelease TreeFrogUI channel.
4. Confirm the card path and device before starting.

The app downloads the matching stock archive and full TreeFrogUI release from GitHub, stages and validates the archives, then copies the stock files, release tree, and selected `install_first` device overlay to the card root. Matching paths are replaced; unrelated card files are preserved. Keep the card connected until the app reports completion, then eject it safely.

All profiles from the desktop installer are available, including **SF3000HD without HDMI**. The installer requires network access to GitHub and enough free space in Android app storage to temporarily hold and extract both archives.
