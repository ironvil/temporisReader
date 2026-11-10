# Temporis Reader

Capacitor 8 hello world for Android, with file reading:

- **Choose file…**: opens the system file picker and shows the chosen file's contents (no storage permission needed).
- **Write / Read hello.txt**: round-trips a file in the app's Documents directory via `@capacitor/filesystem`.

## Toolchain

Installed user-locally under `~/.local/opt` (Node, Temurin JDK 21, Android SDK). Add to your shell profile:

```sh
export JAVA_HOME=~/.local/opt/jdk21
export ANDROID_HOME=~/.local/opt/android-sdk
export PATH=~/.local/opt/node/bin:$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$PATH
```

## Commands

```sh
npm run dev     # web dev server (file picker works; Filesystem uses a web fallback)
npm run sync    # build web assets and copy them into the Android project
npm run apk     # sync + build debug APK -> android/app/build/outputs/apk/debug/app-debug.apk
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
```
