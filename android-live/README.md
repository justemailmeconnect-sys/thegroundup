# The Ground Up (live) for Android

A tiny Android app (about 30 KB) whose only job is to open the **real, online** dashboard. Tap the icon and the
dashboard opens in a Chrome Custom Tab (Chrome's in-app browser view, with a slim address bar that hides when you
scroll); press Back and you are on the home screen again.

Because it is the website itself, running at claude.ai, your data, **sync across devices** and the **Claude features**
work exactly as on the website. That is the difference from the standalone app in `../android/`, which carries its own copy
of the dashboard and its own separate data, and cannot sync or talk to Claude (those only exist inside claude.ai).

| | Ground Up Live (`android-live/`) | The Ground Up (`android/`) |
|---|---|---|
| Package | `com.groundup.live` | `com.groundup.dashboard` |
| What it is | a launcher that opens the online dashboard | the dashboard bundled inside the app |
| Data | your account's data, same as the website | its own, on the phone only |
| Sync, Ask Claude | yes (it is the website) | no |
| Works offline | no | yes |
| Permissions | none | internet, network state |

Both can be installed together (different package names; both are labelled "The Ground Up"). This app wears the new icon (a G rising out of layered ground, see `../brand/README.md`); the standalone app keeps its original G icon.

## Build it

```
./android-live/build.sh
```

It needs the Android SDK and signing key that `./android/build.sh` sets up (run that once first if you have never built
the standalone app). `android-live/build.sh` reuses `android/.sdk` and the **same signing key**; it never creates a key.
It prints the APK path, size and SHA-256 at the end. The file is `android-live/dist/TheGroundUp-live-<versionName>.apk`,
where `versionName` is the build date (`YYYY.MM.DD`).

Options (environment variables): `GU_KEYSTORE_PROPS`, `GU_VERSION_NAME`, `GU_ANDROID_SDK`, `GU_GRADLE_ARGS`.

## Install it

1. Get the `.apk` onto the phone, open it, allow "Install unknown apps" for the app you opened it from, tap Install.
2. If Play Protect says it does not recognise the app, choose "Install anyway" (it is your own build, signed with your own key).
3. Open **Ground Up Live**. The first time, Chrome shows the claude.ai sign-in page: sign in with the account that owns the
   dashboard. **An email code works if Google sign-in is blocked.** Chrome remembers you afterwards, so the next opens go
   straight to the dashboard (you will be asked again when claude.ai's login expires).

## Update it / the versionCode rule

Android installs an update over an installed copy only if it is signed with **the same key** and has a **higher
`versionCode`**.

- Raise `versionCode` in `android-live/version.properties` by 1 (1, 2, 3, ...) for every build you want to install over the
  previous one. `versionName` is the date and changes by itself.
- This app has no web files inside, so changes to the dashboard do **not** need a new build: the website updates by itself.
  Rebuild only if the app itself changes (for example, the dashboard's address).
- The address lives in one place: `app/src/main/res/values/strings.xml`, string `live_url`.

## How it works

`OpenActivity` is the only screen and has no UI (a "no display" theme). On launch it:

1. asks `CustomTabsClient.getPackageName` for a browser that supports Custom Tabs (the phone's default browser if it does,
   else Chrome and a few others) and opens the link in a Custom Tab there (white toolbar, dark toolbar in dark mode,
   address bar hides on scroll, the browser's normal share menu);
2. if no browser supports Custom Tabs, opens the link with a plain "view this link" intent;
3. if nothing can open links at all, shows a short message;

then finishes itself, which is why Back goes to the home screen. It never touches the network itself, so the app has **no
INTERNET permission** (its manifest has no permissions at all). The only intent filter is the launcher one; it does not
claim any links. `allowBackup` is off.

## Limitations

- **Needs the internet.** There is no offline copy; use the standalone app (or Chrome's own offline behaviour) if you need that.
- It opens **in the browser**, not in a window of its own: Chrome's bar is above the page, and the page comes from your
  claude.ai account. The dashboard's link is private; only the signed-in owner can open it.
- Sign-in belongs to Chrome (Custom Tabs share Chrome's cookies). Clearing Chrome's site data or signing out of claude.ai
  means signing in again.
- If the dashboard is ever re-published at a different address, change `live_url` and raise `versionCode`.
- Downloads and sharing behave like they do in Chrome, not like in the standalone app.
- The two apps' data is separate: backups made in the standalone app are not the live data.
- Not tested on a real device or emulator (none is available where this was built): see "Checks" below.

## Checks

Done at build time: the APK builds and is signed (v2 and v3, same certificate as the standalone app), `aapt2 dump badging`
and the manifest show the package, SDK levels, no permissions and only the launcher intent filter, and `./gradlew lintRelease`
reports no errors.

Only a real phone can confirm: that the icon opens the dashboard in a Custom Tab, that Back returns to the home screen,
the sign-in flow, the dark-mode toolbar colour, and the fallbacks (a phone with no Custom Tabs browser, or none at all).
