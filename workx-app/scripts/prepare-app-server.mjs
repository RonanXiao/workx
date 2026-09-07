import { execFileSync } from "node:child_process";
import { mkdirSync, copyFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const desktopDir = path.resolve(scriptDir, "..");
const repoRoot = path.resolve(desktopDir, "..");
const workxRsDir = path.join(repoRoot, "workx-rs");
const binariesDir = path.join(desktopDir, "src-tauri", "binaries");
const isWindows = process.platform === "win32";
const dryRun = process.argv.includes("--dry-run");

function run(command, args, options = {}) {
  console.log(`$ ${command} ${args.join(" ")}`);
  return execFileSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
    ...options,
  });
}

function runBuild(command, args, options = {}) {
  if (dryRun) {
    console.log(`$ ${command} ${args.join(" ")}`);
    return;
  }
  execFileSync(command, args, {
    encoding: "utf8",
    stdio: "inherit",
    ...options,
  });
}

const host = run("rustc", ["-vV"])
  .split("\n")
  .find((line) => line.startsWith("host: "))
  ?.slice("host: ".length)
  .trim();

if (!host) {
  console.error("Could not determine rustc host triple.");
  process.exit(1);
}

const target = process.env.TAURI_ENV_TARGET_TRIPLE || host;
const exeName = isWindows ? "workx-app-server.exe" : "workx-app-server";
const sidecarName = `workx-app-server-${target}${isWindows ? ".exe" : ""}`;
const manifestPath = path.join(workxRsDir, "Cargo.toml");
const metadata = run("cargo", ["metadata", "--no-deps", "--format-version", "1"], { cwd: workxRsDir });
const targetDir = JSON.parse(metadata || "{}").target_directory || path.join(workxRsDir, "target");
const source = path.join(targetDir, "release", exeName);
const destination = path.join(binariesDir, sidecarName);

console.log(`Workx app-server sidecar: ${sidecarName}`);
console.log(`Cargo manifest: ${manifestPath}`);
console.log(`Source binary: ${source}`);
console.log(`Destination: ${destination}`);

if (dryRun) {
  console.log("Dry run complete.");
  process.exit(0);
}

runBuild("cargo", [
  "build",
  "--manifest-path",
  manifestPath,
  "-p",
  "workx-app-server",
  "--release",
  ...(target === host ? [] : ["--target", target]),
]);

if (!existsSync(source)) {
  console.error(`Built app-server binary not found at ${source}`);
  process.exit(1);
}

mkdirSync(binariesDir, { recursive: true });
copyFileSync(source, destination);
console.log(`Copied app-server sidecar to ${destination}`);
