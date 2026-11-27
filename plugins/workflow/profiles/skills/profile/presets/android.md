# Preset: android

**Signals:** `build.gradle.kts`, `settings.gradle.kts`, `AndroidManifest.xml`, `gradlew`.

**Relevant skills:** Android and Kotlin, Jetpack Compose, Material 3, Play release, UI review, RTL and localization, performance, SQL (Room), testing.

**Commands to look for:** `./gradlew assembleDebug`, `testDebugUnitTest`, `lint`, `connectedAndroidTest`; `adb` install and logcat.

**Permissions:** allow Gradle build, unit tests and lint; ask before `adb install` on a physical device, Play uploads and signing steps; never read keystores or `local.properties` secrets.

**Extras:** keep an emulator or device running in the background and stop it at the end.
