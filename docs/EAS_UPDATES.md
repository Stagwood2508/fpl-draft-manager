# App update workflow

The Android app has two EAS Update channels:

- `preview` for internal APK and beta testing builds.
- `production` for Google Play production builds.

## First build after enabling updates

EAS Update adds native code to the app. Create and install a fresh build before
publishing an over-the-air update:

```powershell
eas build --platform android --profile preview
```

For Google Play, build the production Android App Bundle:

```powershell
eas build --platform android --profile production
```

## Publish a preview update

Use preview first for JavaScript, TypeScript, styling and bundled asset changes:

```powershell
npm run update:preview -- --message "Describe the change"
```

After publishing, close and reopen the preview app. It downloads a compatible
update at launch and applies it after a subsequent restart.

## Publish a production update

After verifying the same change on preview:

```powershell
npm run update:production -- --message "Describe the change"
```

## When a new build is required

Create a new APK or Play Store build whenever a change affects native code,
including:

- Adding or updating a native Expo or React Native package.
- Changing Android permissions, Firebase configuration or notification setup.
- Changing the app icon or native splash screen.
- Upgrading Expo or React Native.

The project uses the `appVersion` runtime policy. Increase `expo.version` in
`app.json` before a public native release so incompatible updates cannot be sent
to an older build.
