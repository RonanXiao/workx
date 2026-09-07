# Workx Desktop

A Tauri + React desktop client for Workx. It connects to the Workx app-server over the existing JSON-RPC protocol and provides a Codex-style workspace UI.

## Status

Early desktop client. The Tauri shell starts and supervises `workx-app-server`, initializes the JSON-RPC connection, lists/resumes threads with history, starts threads in a selected folder, submits text turns, renders streamed agent/tool/diff/plan output, handles command and file-change approvals, provides a `command/exec`-backed integrated terminal, and exposes the model picker from `model/list`.

## Prerequisites

- Node.js 22+ and npm
- Rust stable
- The `workx-app-server` binary available in `PATH` or via `WORKX_APP_SERVER_BIN`

Build the app-server from the repository root:

```bash
cargo build -p workx-app-server
export WORKX_APP_SERVER_BIN="$PWD/workx-rs/target/debug/workx-app-server"
```

## Develop

```bash
cd workx-app
npm install
npm run tauri dev
```

## Build

Prepare the app-server sidecar first, then bundle the desktop app:

```bash
cd workx-app
npm run prepare:app-server
npm run tauri build
```

For development, set `WORKX_APP_SERVER_BIN` to a locally built debug binary:

```bash
export WORKX_APP_SERVER_BIN="$PWD/workx-rs/target/debug/workx-app-server"
npm run tauri dev
```

The Tauri project targets macOS and Windows by default through Tauri's bundler. Cross-compilation targets can be prepared by setting `TAURI_ENV_TARGET_TRIPLE` before `prepare:app-server`.
