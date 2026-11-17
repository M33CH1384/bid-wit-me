# Bid Wit Me — iPhone app (SPM build)

Native iOS shell (Capacitor 8, Swift Package Manager — no CocoaPods) that opens
the live game at https://bid-wit-me.pages.dev full-screen. Always the current
build; nothing about the game is bundled stale.

- Bundle id: com.demetriusrobinson.bidwitme
- Icon/splash: the game's spade emblem on #0c0712
- Camera/mic usage strings declared (seat video + Eye zoom use getUserMedia)

## TestFlight
Signed with the paid Apple Developer team (8Q3A2QW437), not the Personal
Team: Personal Team builds cannot be uploaded.

One-time, in App Store Connect (appstoreconnect.apple.com): Apps -> + ->
New App, platform iOS, bundle ID `com.demetriusrobinson.bidwitme`, name
"Bid Wit Me", SKU anything (e.g. `bidwitme`).

Each upload:
1. Open `native/ios/ios/App/App.xcodeproj` in Xcode.
2. Bump the build number (target App -> General -> Build) — every upload
   needs a new one; the version (1.0) changes only for a new release.
3. Destination "Any iOS Device (arm64)", then Product -> Archive.
4. Organizer -> Distribute App -> App Store Connect -> Upload.
5. After processing (~10-30 min) the build shows in TestFlight. Internal
   testers (up to 100 people on the team) can install right away; external
   testers need a one-time Beta App Review.

Export compliance is answered in Info.plist (ITSAppUsesNonExemptEncryption
= NO: HTTPS only), so uploads skip that question.

## Install on your own iPhone (development)
Open the project, plug in the iPhone, choose it as the run destination,
press Run.

Known limit: web push (story call-backs) rides a service worker that iOS
webviews don't support, so pushes don't arrive inside this shell.
