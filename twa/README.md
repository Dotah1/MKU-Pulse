# MKU Pulse Android TWA

This is a Bubblewrap-generated Trusted Web Activity for:

- Package: `com.mku.pulse`
- Origin: `https://mku-pulse.vercel.app`
- Launch route: `/feed`
- Display: standalone
- Notifications: enabled because the web app uses push messaging
- Native geolocation and Play Billing: disabled

## Build locally

Use JDK 17 and Bubblewrap:

```bash
export JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64
export BUBBLEWRAP_KEYSTORE_PASSWORD="$(cat keystore/keystore-password.txt)"
export BUBBLEWRAP_KEY_PASSWORD="$BUBBLEWRAP_KEYSTORE_PASSWORD"
bubblewrap build
```

Outputs include a signed APK for device testing and a signed Android App Bundle for Play Console upload.

## Digital Asset Links

Deploy `../public/.well-known/assetlinks.json` with the website so this URL returns HTTP 200:

`https://mku-pulse.vercel.app/.well-known/assetlinks.json`

The JSON is tied to the package name and certificate generated for this project. If Google Play App Signing is enabled, add the Play app-signing certificate fingerprint as an additional entry in the same JSON after Play Console provides it.

## Key handling

The release keystore and password file are local signing secrets and are intentionally ignored by Git. Back them up securely. Do not commit them or upload them to a public repository.
