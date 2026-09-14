# Workx Desktop

A Workx desktop client whose UI follows the Codex desktop app: a 275px sidebar,
a 46px toolbar, a 42rem transcript column, and the same light/dark palette.

The app is a fresh Electron application and is intentionally independent from the
pnpm workspace at the repository root. It has its own `package-lock.json` and is
installed with npm.

## Stack

- Electron Forge + Vite for build, packaging, and dev server
- React 19 + TypeScript
- Tailwind CSS 4
- `react-markdown` + `remark-gfm` for transcript rendering
- `lucide-react` for icons

## Design tokens

Colors, radii, spacing, and layout constants were extracted from the installed
Codex app bundle (`/Applications/ChatGPT.app/Contents/Resources/app.asar`) rather
than approximated. The notable values:

| Token             | Value                                                              |
| ----------------- | ------------------------------------------------------------------ |
| Sidebar width     | `275px` (`clamp(240px, 275px, min(520px, 100vw - 320px))`)         |
| Toolbar height    | `46px`                                                             |
| Transcript column | `42rem`                                                            |
| Light surface     | `#ffffff`, sidebar `#f9f9f9`, foreground `#1a1c1f`                 |
| Dark surface      | `#181818`, sidebar `#212121`, foreground `#dfdfdf`                 |
| Borders           | foreground at 5% / 8% / 12% (light), white at 4% / 8% / 16% (dark) |

The proprietary OpenAI Sans font is not bundled. Workx uses the system UI font
stack instead.

## Run

```sh
npm install
npm start
```

The main process spawns `workx app-server --stdio` and speaks JSON-RPC over
stdin/stdout. The protocol types are imported from the checked-in TypeScript
schema at `../workx-rs/app-server-protocol/schema/typescript` (aliased as
`@protocol/*`), so the client stays in sync with the server.

Set `WORKX_BIN` to point at a different Workx binary, and `WORKX_CWD` to change
the directory used for new threads (defaults to the user's home directory).
Custom models (`custom_models`) require a Workx CLI of 0.0.4 or newer; older
CLIs ignore the field, and the provider dialog reports that when it happens. Each
entry can be a bare model ID or a table with per-model metadata:

```toml
custom_models = [
  "deepseek-chat",
  { id = "deepseek-reasoner", context_window = 128000, max_context_window = 128000, input_modalities = ["text"] },
]
```

`input_modalities` defaults to `["text", "image"]` and accepts `text`, `image`,
and `audio`.

## Wiring

The client negotiates the experimental app-server API and uses these methods:

- `initialize` / `initialized` — handshake with `clientInfo` and experimental
  capabilities
- `thread/list`, `thread/start`, `thread/resume` — chat history and new chats
- `thread/name/set`, `thread/archive`, `thread/delete` — sidebar actions
- `thread/search` — sidebar search
- `turn/start`, `turn/interrupt` — sending prompts and stopping a run
- `model/list` — model and reasoning-effort pickers
- `config/read`, `config/batchWrite` — model/provider selection and the provider
  manager (add, edit, and delete custom providers)
- `plugin/list`, `skills/list`, `mcpServerStatus/list` — Plugins / Skills / MCP
  panels
- `item/commandExecution/requestApproval`,
  `item/fileChange/requestApproval` — inline approval cards

Streaming notifications (`turn/started`, `item/started`, `item/completed`,
`item/agentMessage/delta`, `thread/tokenUsage/updated`, `turn/completed`,
`warning`, `error`, thread lifecycle events) update the transcript incrementally.

Server requests for surfaces the desktop does not implement are answered with a
JSON-RPC `-32601` error instead of hanging.

## Scripts

- `npm start` — launch the app with the Forge dev server
- `npm run package` — build an unpacked app
- `npm run make` — build distributables
- `npm run typecheck` — `tsc --noEmit`
- `npm run lint` — ESLint

Use Node 22 for packaging. Node 26 currently crashes `extract-zip` while
unpacking the Electron template, which aborts `electron-forge package` without
an error.

## Packaging

Installers are built with Electron Forge:

- macOS arm64: `npm run make -- --platform=darwin --arch=arm64` produces
  `out/make/Workx-<version>-arm64.dmg` and a `.zip`.
- Windows x64: `npm run make -- --platform=win32 --arch=x64` produces
  `out/make/squirrel.windows/x64/Workx-<version> Setup.exe`.

The app icon lives in `assets/` (`icon.icns`, `icon.ico`, `icon.png`) and is
applied through `packagerConfig.icon`.

### Bundled CLI

The Windows installer ships the Workx CLI, so installing the app is enough — no
separate `install.ps1` run and no PATH dependency. Point `npm run make` at a
canonical package directory built by `scripts/build_workx_package.py`:

```sh
WORKX_CLI_PACKAGE_DIR=<workx-package directory> \
  npm run make -- --platform=win32 --arch=x64
```

`packagerConfig.extraResource` copies that directory into the app's `Resources`
folder, which is where the client looks for the CLI. The whole package layout is
bundled, not just the entrypoint: the CLI resolves `workx-resources/`,
`workx-path/`, and `workx-package.json` relative to its own executable, so
`bin/workx.exe` only finds `rg`, the code-mode host, and the Windows sandbox
helpers when those stay next to it. Leave the variable unset to package an app
without a bundled CLI; packaging fails if it points at a directory that is not a
Workx package.

The release workflows download `workx-package-x86_64-pc-windows-msvc.tar.gz`
from the release and set the variable. macOS builds never set it, because the
cask depends on the `workx` Homebrew formula instead.

Packaged apps resolve the Workx CLI from `WORKX_BIN`, the bundled
`Resources/bin/workx`, then the per-platform install locations — the Homebrew
paths (`/opt/homebrew/bin/workx`, `/usr/local/bin/workx`) on macOS and
`%LOCALAPPDATA%\Programs\OpenAI\Workx\bin` plus `%LOCALAPPDATA%\Workx\bin`
on Windows — and finally `PATH`. macOS GUI apps do not inherit the shell `PATH`,
so the explicit Homebrew paths are required for `brew install --cask workx`.

Code signing is optional. Set `APPLE_IDENTITY`, `APPLE_ID`,
`APPLE_APP_PASSWORD`, and `APPLE_TEAM_ID` for macOS signing/notarization, or
`WINDOWS_CERTIFICATE_FILE` and `WINDOWS_CERTIFICATE_PASSWORD` for Windows.

Without a Developer ID the macOS build is ad-hoc signed. That is required:
renaming and editing the bundled `Electron.app` invalidates its shipped
signature, and macOS reports a broken signature as "damaged". An ad-hoc
signature makes the app launchable, but users still see the unidentified
developer prompt until the app is signed with a Developer ID and notarized.

## Scope

OpenAI-exclusive product surfaces (ChatGPT account, plans, the pull-request
inbox, and cloud scheduled runs) are deliberately omitted. Workx-owned surfaces
that Codex also has — threads, projects, plugins, skills, MCP servers,
approvals, terminal activity, file changes, and permission modes — are kept.
