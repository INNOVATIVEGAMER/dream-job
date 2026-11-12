# job-app

A local Electron app for the job search, driven by Claude on your own Claude
subscription. Proof of concept, built step by step against the Job App POC
Scope doc.

## Run

```
pnpm install
node node_modules/electron/install.js   # first time only: downloads Electron
pnpm dev
```

## Step 1 (current)

The app's panel, and a real Google Chrome window beside it that the app opens
with its own profile and controls through a private pipe. Google refuses
sign-in inside an embedded Electron browser, so the browser is Chrome itself.
"Open to sign in" opens the same profile with no control link, in case Google
refuses while the app is connected. The panel follows Chrome's page and has
back, forward, reload and an address field.

The check: sign in to LinkedIn with Continue with Google in that Chrome, quit
the app, start it again, open Chrome, and confirm you are still signed in.

## Checks

```
pnpm typecheck
pnpm build
```
