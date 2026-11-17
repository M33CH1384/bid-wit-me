# Build notes
- 2026-11-10: rebuilt SPM-flavoured after the CocoaPods package failed on the
  owner's Mac: no `pod`, no `brew`, and system Ruby 2.6.10 cannot install
  modern CocoaPods (nap >= latest requires Ruby >= 3.3; CP 1.17 fetched but
  errored; CP 1.11.3 attempt reported same error by owner).
- Generated with Capacitor CLI 8.6.0 (cap add ios), config carried over 1:1
  from the Pods package (server URL, allowNavigation, limitsNavigations,
  contentInset, backgroundColor). Assets.xcassets copied verbatim from the
  Pods package. Info.plist patched with the same camera/mic strings.
- Package.swift depends only on capacitor-swift-pm 8.6.0. iOS target 15.0.
- Xcode build on the owner's Mac is the compile proof (same route as Recall,
  which compiled clean 2026-11-10).
