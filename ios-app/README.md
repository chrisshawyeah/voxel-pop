# Crumble Crew, the iPhone app

An Expo app whose one screen is a full-screen web view of the game at
https://chrisshawyeah.github.io/voxel-pop/ . Game changes need no new install.

Build (on a build Mac, never the MacBook): make a blank Expo app, copy `App.js`, `app.json`
and `assets/` over it, add `react-native-webview`, `npx expo prebuild -p ios`, then build
Release for `generic/platform=iOS` unsigned. Sign on the MacBook and install with
`xcrun devicectl device install app`.

Bundle id `com.everdonestudio.crumblecrew`. `install-iphone.sh` signs and installs; it reads the
team, certificate, profile and phone from `signing.env`, which is not in the repository.
