import path from 'node:path';

import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerDMG } from '@electron-forge/maker-dmg';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerZIP } from '@electron-forge/maker-zip';
import { MakerDeb } from '@electron-forge/maker-deb';
import { MakerRpm } from '@electron-forge/maker-rpm';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { FuseV1Options, FuseVersion } from '@electron/fuses';

// Code signing is optional: releases build unsigned when the credentials are
// absent, and sign/notarize automatically once the secrets are configured.
const appleId = process.env.APPLE_ID;
const appleIdPassword = process.env.APPLE_APP_PASSWORD;
const appleTeamId = process.env.APPLE_TEAM_ID;
const appleIdentity = process.env.APPLE_IDENTITY;
const windowsCertificateFile = process.env.WINDOWS_CERTIFICATE_FILE;
const windowsCertificatePassword = process.env.WINDOWS_CERTIFICATE_PASSWORD;

const osxNotarize =
  appleId && appleIdPassword && appleTeamId
    ? { appleId, appleIdPassword, teamId: appleTeamId }
    : undefined;

// Without a Developer ID the app still needs a valid signature: renaming and
// editing the bundled Electron.app invalidates its shipped signature, and
// macOS then reports the app as damaged. Ad-hoc signing restores a valid
// signature so the app can run (with the usual unidentified-developer prompt).
const osxSign = appleIdentity
  ? { identity: appleIdentity }
  : {
      identity: '-',
      identityValidation: false,
      // Hardened runtime turns on library validation, which rejects the nested
      // frameworks because ad-hoc signatures carry no Team ID to match.
      optionsForFile: () => ({ hardenedRuntime: false }),
    };

const cliPackageDir = process.env.WORKX_CLI_PACKAGE_DIR?.trim();
const cliResources = cliPackageDir
  ? ['bin', 'workx-resources', 'workx-path', 'workx-package.json'].map((name) =>
      path.join(cliPackageDir, name),
    )
  : [];

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    extraResource: cliResources,
    icon: path.join(__dirname, 'assets/icon'),
    appBundleId: 'com.workx.desktop',
    appCategoryType: 'public.app-category.developer-tools',
    osxSign,
    ...(osxNotarize ? { osxNotarize } : {}),
  },
  rebuildConfig: {},
  makers: [
    new MakerDMG({}, ['darwin']),
    new MakerZIP({}, ['darwin']),
    new MakerSquirrel({
      setupIcon: path.join(__dirname, 'assets/icon.ico'),
      ...(windowsCertificateFile
        ? {
            certificateFile: windowsCertificateFile,
            certificatePassword: windowsCertificatePassword,
          }
        : {}),
    }),
    new MakerRpm({}),
    new MakerDeb({}),
  ],
  plugins: [
    new VitePlugin({
      // `build` can specify multiple entry builds, which can be Main process, Preload scripts, Worker process, etc.
      // If you are familiar with Vite configuration, it will look pretty familiar.
      build: [
        {
          // `entry` is just an alias for `build.lib.entry` in the corresponding file of `config`.
          entry: 'src/main.ts',
          config: 'vite.main.config.ts',
          target: 'main',
        },
        {
          entry: 'src/preload.ts',
          config: 'vite.preload.config.ts',
          target: 'preload',
        },
      ],
      renderer: [
        {
          name: 'main_window',
          config: 'vite.renderer.config.mts',
        },
      ],
    }),
    // Fuses are used to enable/disable various Electron functionality
    // at package time, before code signing the application
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};

export default config;
