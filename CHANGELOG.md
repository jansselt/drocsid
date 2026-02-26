# Changelog

## [0.9.0](https://github.com/jansselt/drocsid/compare/drocsid-v0.8.4...drocsid-v0.9.0) (2026-02-26)


### Features

* add camera and screen share to Tauri native voice panel ([f05a42d](https://github.com/jansselt/drocsid/commit/f05a42d7083f0c843fb8e6ac8bd4b42f408cd406))
* native screen capture via XDG portal + GStreamer for Tauri ([9c3cc5c](https://github.com/jansselt/drocsid/commit/9c3cc5c5e4da596a3ff32537b040495878ccad29))
* pop-out window for voice video and screen share ([58faeea](https://github.com/jansselt/drocsid/commit/58faeeaae481732b384d5f74260fd8c37194618d))
* private voice calls from DMs ([31f1198](https://github.com/jansselt/drocsid/commit/31f11987d7b3befb60f7f8db78c4ec11ce8164a0))
* share application/system audio in voice channels ([9e0f71c](https://github.com/jansselt/drocsid/commit/9e0f71ca30a6123d801b3549d5d24b5d205f6ab4))


### Bug Fixes

* camera preview ref timing and compact video grid layout ([0726a4b](https://github.com/jansselt/drocsid/commit/0726a4bac0a8155af9adb65e4608cb2274ae637a))
* pop-out window URL construction — PathBuf can't carry query strings ([076ffe8](https://github.com/jansselt/drocsid/commit/076ffe83707af7a5c2cf6d01e38999ce1d8daa3e))
* popout killed by StrictMode double-invoke cleanup ([5fb8595](https://github.com/jansselt/drocsid/commit/5fb8595772a17cde06b82789606f4dd4e1815af8))
* popout left open when disconnecting from main window ([27ad36d](https://github.com/jansselt/drocsid/commit/27ad36d8f70d1acfb16ebf46914b32f8b6edea4b))
* proactive token refresh prevents session expiry during dev ([cd9fa54](https://github.com/jansselt/drocsid/commit/cd9fa54471e37a61012db6dd09a41d4914a0385c))
* PWA update button does nothing — add SKIP_WAITING handler to service worker ([257fac4](https://github.com/jansselt/drocsid/commit/257fac4ca291dc24935f0681cfea13a739a126c9))
* PWA update button stuck on "Updating..." — add fallback reload + clients.claim ([b711ecf](https://github.com/jansselt/drocsid/commit/b711ecf61754966029c90429f4b1c70e5daf4c69))
* use distinct broadcast icon for Share Audio button ([cb73de0](https://github.com/jansselt/drocsid/commit/cb73de0d588d0fc8ead621676644ff3f0e00b4d5))
* voice panel bugs — audio mixer leak, ghost users, false idle, hidden participants ([a8f37c1](https://github.com/jansselt/drocsid/commit/a8f37c1ff8c54986294515ec8ed35049f2f66a56))

## [0.8.4](https://github.com/jansselt/drocsid/compare/drocsid-v0.8.3...drocsid-v0.8.4) (2026-02-24)


### Bug Fixes

* reset repository with clean git history ([6e16b67](https://github.com/jansselt/drocsid/commit/6e16b67a81056ac373276258f3d1bc8025c744f5))

## [0.8.3](https://github.com/jansselt/drocsid/compare/drocsid-v0.8.2...drocsid-v0.8.3) (2026-02-24)


### Bug Fixes

* reset repository with clean git history ([4f4c024](https://github.com/jansselt/drocsid/commit/4f4c02465123f97af5033de980efe091f8b2d7cf))

## [0.8.2](https://github.com/jansselt/drocsid/compare/drocsid-v0.8.1...drocsid-v0.8.2) (2026-02-23)


### Bug Fixes

* prevent forced scroll-to-bottom when loading message history ([2630239](https://github.com/jansselt/drocsid/commit/263023913b35eca74b5e42c0166b4a3f2aca6c7c))
* scroll-to-bottom on initial channel load with async media ([955e1d8](https://github.com/jansselt/drocsid/commit/955e1d8907d1dc5d5a57c1a6baef79eee75688a8))
* scroll-to-bottom race with async image loads ([bda6410](https://github.com/jansselt/drocsid/commit/bda64103e318befabd002fe69a1ddb9afad84f85))
* scroll-to-bottom race with async image loads ([d9c9c82](https://github.com/jansselt/drocsid/commit/d9c9c82fe0052ade75b5d6c60424e301b81223c0))
* use fixed port for localhost plugin to persist auth across restarts ([62d5fed](https://github.com/jansselt/drocsid/commit/62d5fedf2aa01b011778bd3196011e1a6e86bd79))
* use rAF polling for scroll-to-bottom on app start ([6e66498](https://github.com/jansselt/drocsid/commit/6e6649867f51b695988d1af3aee29de999e0ff4f))

## [0.8.1](https://github.com/jansselt/drocsid/compare/drocsid-v0.8.0...drocsid-v0.8.1) (2026-02-22)


### Bug Fixes

* grant full ACL permissions to localhost origin in production ([6e2a740](https://github.com/jansselt/drocsid/commit/6e2a7401d7ed8d915b98dba16763b27c4a6a8cb3))
* set GStreamer plugin path in AppImage for Web Audio support ([130bf65](https://github.com/jansselt/drocsid/commit/130bf655ca0bde1157e9673ae71ea45eb0d7b1f9))
* use localhost plugin to fix YouTube embeds and Web Audio in Tauri production ([aefb6ce](https://github.com/jansselt/drocsid/commit/aefb6ceef174fc7bd990758127065fbde7794570))

## [0.8.0](https://github.com/jansselt/drocsid/compare/drocsid-v0.7.1...drocsid-v0.8.0) (2026-02-22)


### Features

* add noise suppression for voice chat with pluggable backend ([3e41db6](https://github.com/jansselt/drocsid/commit/3e41db6f0839780aa1a87642dd4eaaa2e76b0a27))
* use youtube.com embed domain to support Premium ad-free playback ([af949f4](https://github.com/jansselt/drocsid/commit/af949f43bb3506e1c7e97f4bea382eb3fe10c3c2))


### Bug Fixes

* enable WebAudio in webkit2gtk for notification sounds in Tauri ([c9bc7f0](https://github.com/jansselt/drocsid/commit/c9bc7f09cadc719fc9bf0b905087b49df7e3a915))
* Tauri drag-drop via native event handler + Rust file reader ([37d9e02](https://github.com/jansselt/drocsid/commit/37d9e02e5ab171c0701072e44a1d537e1225695c))
* Tauri drag-drop, image paste, scroll-to-bottom, and YouTube embed ([e63c9a8](https://github.com/jansselt/drocsid/commit/e63c9a8a8a93b7b5a6b52a4a613ec9f4aa42480e))

## [0.7.1](https://github.com/jansselt/drocsid/compare/drocsid-v0.7.0...drocsid-v0.7.1) (2026-02-22)


### Bug Fixes

* use Image::new_owned instead of removed new_raw in tray icon code ([186775c](https://github.com/jansselt/drocsid/commit/186775c95eed59f14c492bd9e33a3c11bf068c31))

## [0.7.0](https://github.com/jansselt/drocsid/compare/drocsid-v0.6.0...drocsid-v0.7.0) (2026-02-22)


### Features

* add personal message bookmarks with tags (drocsid-mw3) ([e7cd562](https://github.com/jansselt/drocsid/commit/e7cd562dd1fe5725c2a47da37f62e50bcd2445f7))
* add scheduled messages, shared link collections, and inline polls ([2d5236b](https://github.com/jansselt/drocsid/commit/2d5236b025c94d658701e702359590774afbc396))
* add timezone-aware member list (drocsid-62d) ([94a0098](https://github.com/jansselt/drocsid/commit/94a0098c90ba3617e6520b58cc60f8c60b714710))
* custom notification sound themes — classic, soft, pop, bell, none ([3067875](https://github.com/jansselt/drocsid/commit/3067875a242d5fa8572114a041416045fd4a3692))
* PWA push notifications for web users ([e823142](https://github.com/jansselt/drocsid/commit/e8231423febcd28944a1dbc2c6ce4b47cbe46522))
* rate limit webhook execution — 30 req/min per webhook via Redis ([09fcd88](https://github.com/jansselt/drocsid/commit/09fcd88321e809277507879730f7408959ee9167))
* webhook management UI in server settings ([f8d4e24](https://github.com/jansselt/drocsid/commit/f8d4e245fa809b8c76d6d07d60ab8f9b376094ec))


### Bug Fixes

* add timezone field to test User fixture ([2a6a41f](https://github.com/jansselt/drocsid/commit/2a6a41fed26aa19dfaad6062e3d464c98dc4b02c))
* add timezone field to test User fixture ([652ee0f](https://github.com/jansselt/drocsid/commit/652ee0f52a796cfee37f5d2af6e7a87cd1e4da77))
* collapsed channel sidebar traps user in DM view ([0ee3668](https://github.com/jansselt/drocsid/commit/0ee36681eff7f55a3d0982cd84b8e24d41515ef2))
* idle status gets stuck — add 30s presence heartbeat on activity ([7d28698](https://github.com/jansselt/drocsid/commit/7d2869878416058cc28f6905834b2320a9db4985))
* notification system overhaul — permissions, unread dots, sounds, batching, tray badge ([1f999bf](https://github.com/jansselt/drocsid/commit/1f999bffcff9eac5ff332a765bb10e688b91222b))
* poll not visible after creation until refresh ([5d830bb](https://github.com/jansselt/drocsid/commit/5d830bb9896845bd0ad3d90e8cdeeffac5b00ec5))
* TypeScript type errors in push notification code ([6596697](https://github.com/jansselt/drocsid/commit/65966973eaabea7499fbe4598a1215e6e99e3099))
* use channel_type instead of type in webhook UI channel filter ([bce8c52](https://github.com/jansselt/drocsid/commit/bce8c5259876c063b4a61f65aa1fa31108fb3616))
* wrap-around keyboard nav for slash/mention menus, add @everyone/[@here](https://github.com/here) ([983ac0e](https://github.com/jansselt/drocsid/commit/983ac0ef6391bd977bedaf49ba8cc0e22852cd7e))

## [0.6.0](https://github.com/jansselt/drocsid/compare/drocsid-v0.5.0...drocsid-v0.6.0) (2026-02-21)


### Features

* add custom CSS color themes (drocsid-c1b) ([682079a](https://github.com/jansselt/drocsid/commit/682079a293affc5f0688765ef7fea977743e2ce3))


### Bug Fixes

* use bundled CHANGELOG.md for release notes instead of GitHub API (drocsid-lgy) ([e70fa82](https://github.com/jansselt/drocsid/commit/e70fa8247954c8746693a69150e6095ba582f4f5))

## [0.5.0](https://github.com/jansselt/drocsid/compare/drocsid-v0.4.0...drocsid-v0.5.0) (2026-02-20)


### Features

* add manual check-for-updates button (drocsid-d5k) ([a43f8a6](https://github.com/jansselt/drocsid/commit/a43f8a68e2b07225cb85c882667997c7778e78ce))
* show release notes from GitHub when clicking version ([e25d8ff](https://github.com/jansselt/drocsid/commit/e25d8fffe44294c320f7869ed46c9168da6b996a))


### Bug Fixes

* add soundboard to sidebar voice controls, fix popup positioning ([fbb0d97](https://github.com/jansselt/drocsid/commit/fbb0d972970f1cb75cda101dd29211f7b3245e92))
* remove unused useCallback import in ServerSidebar ([1770a4c](https://github.com/jansselt/drocsid/commit/1770a4cdbe2080b306a8da966de98cc72303f50f))

## [0.4.0](https://github.com/jansselt/drocsid/compare/drocsid-v0.3.0...drocsid-v0.4.0) (2026-02-20)


### Features

* add CodeRabbit AI code review configuration ([ae7128c](https://github.com/jansselt/drocsid/commit/ae7128ce73f4e9ed0cf1b5dc4c056cd9c1d2737c))
* add persistent update indicator in server sidebar ([411512b](https://github.com/jansselt/drocsid/commit/411512bfe6f710f846cb893410a80fafdbd2cf1a))
* add soundboard for voice channels ([0f8eab5](https://github.com/jansselt/drocsid/commit/0f8eab5c9972093613e5376f71ccad219609dd11))


### Bug Fixes

* inject version into PKGBUILD from release tag ([e2d45a9](https://github.com/jansselt/drocsid/commit/e2d45a9d595551008f4a64f66a35fecf54c2b103))

## [0.3.0](https://github.com/jansselt/drocsid/compare/drocsid-v0.2.2...drocsid-v0.3.0) (2026-02-20)


### Features

* show distro-specific install command for manual updates ([f8c0d1d](https://github.com/jansselt/drocsid/commit/f8c0d1db041e2fa8502cdc5827b5b8b0c974620e))
* show manual update link for non-AppImage Linux installs ([be3848d](https://github.com/jansselt/drocsid/commit/be3848dc99e4842c83f69ecb4a6cf0bfdf68e6ba))

## [0.2.2](https://github.com/jansselt/drocsid/compare/drocsid-v0.2.1...drocsid-v0.2.2) (2026-02-19)


### Bug Fixes

* regenerate Tauri signing key with proper password ([dc34737](https://github.com/jansselt/drocsid/commit/dc3473744aba54387245e842110e396217e9102a))

## [0.2.1](https://github.com/jansselt/drocsid/compare/drocsid-v0.2.0...drocsid-v0.2.1) (2026-02-19)


### Bug Fixes

* use empty password for Tauri signing key ([a0abd91](https://github.com/jansselt/drocsid/commit/a0abd911565f051003eec63fb6be878c59fb9605))

## [0.2.0](https://github.com/jansselt/drocsid/compare/drocsid-v0.1.0...drocsid-v0.2.0) (2026-02-19)


### Features

* add automated versioning and auto-update system (drocsid-vzi) ([2f09dcf](https://github.com/jansselt/drocsid/commit/2f09dcf3914045969177147947318fd235bf47b6))


### Bug Fixes

* add vite-plugin-pwa type declarations to tsconfig ([52311d2](https://github.com/jansselt/drocsid/commit/52311d200421a792ddbe3822162f0fd8eec41ff0))
* move release-please package root to repo root ([7f1fb05](https://github.com/jansselt/drocsid/commit/7f1fb05f985f7d922d784fda76eb4595c48ad2bc))
