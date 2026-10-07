# The Ground Up for Android

An installable Android app (`.apk`) that runs the same dashboard as the website, from files stored inside the app.
It is a thin shell: one full-screen WebView, the website's `index.html`, `css/` and `js/` copied in at build time,
and a small bridge for the things a WebView cannot do alone (saving files to Downloads, the share sheet).
The website's own files are never changed.

```
android/
  build.sh                 one command: SDK -> signing key -> bundle web files -> Gradle -> dist/TheGroundUp-<version>.apk
  version.properties       versionCode (bump this for every update you install)
  shim/android-shim.js     injected as the FIRST script of the bundled index.html (no effect outside the app)
  tools/prepare_assets.py  copies index.html, css/, js/ + shim + offline fonts into app/src/main/assets/www
  app/                     the Android project (Java, no Kotlin; androidx.webkit is the only library)
  tests/boot-check.js      boots the bundle in Chromium with a stubbed bridge and checks pages, downloads, share, back, fonts, hosts
  tests/FileNamesCheck.java  plain-Java check of the file-name helpers
  dist/                    the finished APK (git-ignored)
  .sdk/  .cache/           the Android SDK and the downloaded fonts (git-ignored)
```

## Build it

You need a JDK (17 or newer), `python3`, `curl` and `unzip`. Nothing else: the script downloads the Android SDK
(command-line tools, `platforms;android-34`, `build-tools;34.0.0`, about 450 MB on disk) into `android/.sdk` the first time.

```
./android/build.sh
```

It prints the APK path, size and SHA-256 at the end. The file is `android/dist/TheGroundUp-<versionName>.apk`, where
`versionName` is the build date (`YYYY.MM.DD`).

What the script does, in order:

1. Makes sure the SDK is in `android/.sdk` (and accepts its licences).
2. Makes sure the **signing key** exists. If it does not, it creates one (RSA 2048, valid 30 years, random password).
   The key and its `keystore.properties` live outside the repository; the location is `GU_KEYSTORE_PROPS`
   (default is set at the top of `build.sh` and in `app/build.gradle`). They are git-ignored (`*.jks`,
   `keystore.properties`) and the password is never printed.
3. Copies `index.html`, `css/` and `js/` from the repository root into `app/src/main/assets/www/`, adds
   `android-shim.js` as the first script tag, and (first time only, then cached in `.cache/fonts`) downloads the
   Google Fonts the page uses (IBM Plex Sans and Mono, Schibsted Grotesk, Fraunces) so they work offline.
   If the download fails the page keeps its online font link and the build says so.
4. Runs `gradle assembleRelease` (release build, not minified, signed with APK signature scheme v2 and v3), checks the
   signature, copies the APK into `android/dist/`.

Options (environment variables): `GU_KEYSTORE_PROPS`, `GU_VERSION_NAME`, `GU_ANDROID_SDK`, `GU_FONTS=off`,
`GU_REFRESH_FONTS=1`, `GU_GRADLE_ARGS`.

The bundle is exactly the repository's web files plus `android-shim.js` plus `fonts/`. `prepare_assets.py` checks this
on every build (byte-for-byte copies, shim first) and stops if anything else would be included. Nothing personal is
ever bundled: your data lives on the phone, inside the app, once you use it.

## Install it on your phone

1. Get the `.apk` onto the phone (download it from where you keep it, or send it to yourself; Drive, email, a USB cable all work).
2. Open it from the phone's file manager or the app you downloaded it with. Android will ask you to **allow
   "Install unknown apps" for that app** (Files, Chrome, Drive...). Turn it on for that one app, go back, and tap Install.
3. If Play Protect says it does not recognise the app, choose "Install anyway" (it is your own build, signed with your own key).
4. Open **The Ground Up**. You can turn "Install unknown apps" off for that app again afterwards.

## Move your data in

The app starts empty (with the example data, like the website). Your real data lives in the browser where you use
the website, so move it once:

1. On the website: **Settings > Backup and restore > Export backup** (the backup includes your uploaded files). Save the JSON file.
2. Get that file onto the phone (it is saved to the Downloads folder if you export on the phone).
3. In the app: **Settings > Backup and restore > Restore from backup**, pick the file, confirm.

From then on the app's data is separate from the website's. Export a backup from the app now and then
(**Settings > Backup and restore > Export backup** saves a file in your phone's **Downloads** folder), because nothing else backs it up.

## What is different from the website

- **No sync.** Sync needs the claude.ai runtime, which is not there (`window.claude` does not exist in the app and
  nothing pretends it does). Settings shows "Sync across your devices: Off" and "Saved in this browser only"; read
  "browser" as "this app". Use Export backup and Restore to move data between devices. To use the real, synced
  dashboard on the phone, install the companion app in `android-live/` (it opens the online dashboard).
- **Ask Claude and the Sorting hub need your own Anthropic API key** (Settings > How your assistant reads things > Anthropic API key). Without a key they
  say so; everything else works without one. The key stays on the phone, in the app.
- **Downloads** (claim packs, CSV, backups, PDFs) are saved into the phone's **Downloads** folder, with a
  "Saved to Downloads" message. **Share** opens the Android share sheet.
- **Links** to other websites open in your phone's browser. The app itself never leaves its own pages.
- **Back button**: closes an open dialog, menu or the Claude panel first; then goes back through the pages you visited
  (the app's pages are `#` routes); leaves the app only when there is nowhere to go back to.
- **Permissions**: internet and network state only (plus storage on Android 9 and older, only to save into Downloads).
  No camera, no location, no microphone. "Take a photo" inputs open the file picker instead (use your Camera app or the
  picker's camera/photos entries). "Add a folder" is not supported by Android's picker; choose several files instead.
- **Previewing a PDF inside the file viewer** does not work in an Android WebView; use **Open** (hands the file to your
  PDF app) or **Download**.
- **No Android backup**: `allowBackup` is off on purpose (your data is private). Uninstalling the app or clearing its
  storage erases its data, so export a backup first.

## Update it

Android only installs an update over an installed copy if it is signed with **the same key** and has a **higher
`versionCode`**.

1. Change the web app as usual in the repository root.
2. Raise `versionCode` in `android/version.properties` by 1 (1, 2, 3, ...). `versionName` is the date and changes by itself.
3. `./android/build.sh`, then install the new APK over the old one. Your data stays.

Keep the keystore and `keystore.properties` somewhere safe and backed up (outside the repository). Without the same key
you cannot update; you would have to uninstall first, which erases the app's data (export a backup before that).

## Checks

- `NODE_PATH=/opt/node-tools/node_modules node android/tests/boot-check.js` serves the bundle at
  `https://appassets.androidplatform.net/assets/www/` in Chromium (phone size, no `window.claude`, a stub `GUAndroid`
  that records calls) and checks every page, downloads and sharing through the bridge (including a 7 MB file sent in
  pieces), Back, status/navigation bar colours, local fonts, and that nothing but the app's own origin is requested.
  Screenshots land in `android/.cache/shots/`.
- `javac -d <dir> android/app/src/main/java/com/groundup/dashboard/FileNames.java android/tests/FileNamesCheck.java && java -cp <dir> com.groundup.dashboard.FileNamesCheck`
- The Android side itself (file chooser, saving to Downloads, share sheet, back button, system bar colours) can only be
  confirmed on a real device or emulator.
