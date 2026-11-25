# Crumble Crew, the iPhone app

An Expo app whose one screen is a full-screen web view of the game at
https://chrisshawyeah.github.io/voxel-pop/ . Game changes need no new install. The page decides
when a new version loads: at a level boundary (a level with nothing sent yet, the next level after
a win, the ending), or, when the app is opened or comes back after a minute or more away, before
the first touch, even in the middle of a level, which comes back as it was left. The app asks it
to check each time it comes back to the front (`checkForUpdate` in `js/main.js`). When iOS has stopped the page
in the background, the app loads it again and the page puts the level back where it was.

Build (on a build Mac, never the MacBook): make a blank Expo app, copy `App.js`, `app.json`
and `assets/` over it, add `react-native-webview`, `npx expo prebuild -p ios`, then build
Release for `generic/platform=iOS` unsigned. Sign on the MacBook and install with
`xcrun devicectl device install app`.

Bundle id `com.everdonestudio.crumblecrew`. `install-iphone.sh` signs and installs; it reads the
team, certificate, profile and phone from `signing.env`, which is not in the repository.
