# Contributing to Dream Job

Ideas, issues and pull requests are welcome. Open an [issue](https://github.com/INNOVATIVEGAMER/dream-job/issues) first for anything big, so we can agree on it before you build it.

## Run it from source

You need macOS 12 or later with Google Chrome, Claude Code signed in with `claude auth login`, and Node.js 22 or later with pnpm.

```bash
pnpm install
node node_modules/electron/install.js   # first time only
pnpm dev                                # run from source
```

The app from source and the built app share one data folder, `~/Library/Application Support/dream-job`, so run one at a time.

## Check your change

```bash
pnpm typecheck
pnpm build
```

## Where things live

| Folder                                       | What's in it                                                                   |
| -------------------------------------------- | ------------------------------------------------------------------------------ |
| [`src/main`](src/main)                       | The Electron main process: the database, runs, flows, each board's tools, chat |
| [`src/renderer`](src/renderer)               | The screens                                                                    |
| [`src/shared`](src/shared)                   | Types and rules both sides use, such as who may be asked for a referral        |
| [`src/main/schemas.ts`](src/main/schemas.ts) | The checks every input passes, from the screens and from the chat              |

## Build a signed release

For a signed, notarized release you need a Developer ID Application certificate:

```bash
xcrun notarytool store-credentials dream-job-notary --apple-id <your Apple ID> --team-id <your team ID>
APPLE_KEYCHAIN_PROFILE=dream-job-notary pnpm dist:mac
```

For a build that only runs on your own computer, `pnpm dist:mac:local` is enough.
