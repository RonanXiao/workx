#!/usr/bin/env python3
"""Write or update the Homebrew cask for the Workx desktop app.

The cask installs the desktop app and depends on the `workx` formula so a
single `brew install --cask workx` provides both the app and the CLI. The file
is created from the bundled template when the tap does not have it yet.

The cask intentionally declares `sha256 :no_check`. Desktop installers are
republished under an existing release tag whenever the desktop client changes,
which changes the DMG bytes without changing the version, so a pinned checksum
would go stale and break `brew install --cask workx` until the tap caught up.
"""

import argparse
import re
from pathlib import Path

VERSION_LINE = re.compile(r'(?m)^(\s*version\s+")[^"]+(")$')
# Matches both `sha256 "<64 hex chars>"` and `sha256 :no_check` so an older
# cask that pinned a checksum is rewritten to the unpinned form.
SHA256_LINE = re.compile(r'(?m)^(\s*sha256\s+)(?:"[^"]*"|:[a-z_]+)$')
NO_CHECK = ":no_check"

TEMPLATE = """cask "workx" do
  version "{version}"
  sha256 :no_check

  url "https://github.com/RonanXiao/workx/releases/download/rust-v#{{version}}/Workx-#{{version}}-arm64.dmg"
  name "Workx"
  desc "Independent coding agent derived from OpenAI Codex"
  homepage "https://github.com/RonanXiao/workx"

  depends_on formula: "workx"
  depends_on macos: :monterey

  app "Workx.app"

  # The app is ad-hoc signed until a Developer ID is configured, and macOS
  # reports quarantined ad-hoc apps as damaged. Strip the quarantine flag so
  # the installed app opens.
  postflight_steps do
    run "/usr/bin/xattr", args: ["-dr", "com.apple.quarantine", "{{{{appdir}}}}/Workx.app"]
  end
end
"""


def update_cask(cask: Path, version: str) -> bool:
    if not cask.is_file():
        cask.parent.mkdir(parents=True, exist_ok=True)
        cask.write_text(TEMPLATE.format(version=version), encoding="utf-8")
        return True

    original = cask.read_text(encoding="utf-8")
    text, version_count = VERSION_LINE.subn(rf"\g<1>{version}\g<2>", original, count=1)
    if version_count != 1:
        raise RuntimeError("Could not find exactly one version line in cask.")
    text, sha_count = SHA256_LINE.subn(rf"\g<1>{NO_CHECK}", text, count=1)
    if sha_count != 1:
        raise RuntimeError("Could not find exactly one sha256 line in cask.")
    if text == original:
        return False
    cask.write_text(text, encoding="utf-8")
    return True


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--cask", type=Path, required=True, help="Path to Casks/workx.rb."
    )
    parser.add_argument("--version", required=True, help="Release version, e.g. 0.1.0.")
    args = parser.parse_args()

    changed = update_cask(args.cask.resolve(), args.version)
    print("cask already up to date" if not changed else f"updated {args.cask}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
