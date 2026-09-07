# Workx Desktop

A Tauri + React desktop client for Workx. It connects to the Workx app-server over the existing JSON-RPC protocol and provides a Codex-style workspace UI.

## Status

Early scaffold. The desktop shell starts the app-server, initializes the JSON-RPC connection, lists threads, starts new threads, and submits text turns. Event streaming and approval/diff/terminal surfaces are represented by the event pane and will be wired to richer UI next.

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

```bash
cd workx-app
npm run tauri build
```

The Tauri project targets macOS and Windows by default through Tauri's bundler.
