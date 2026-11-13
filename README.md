# Dream Job

Your job search, run by your own Claude Code in your own Chrome.

Dream Job finds jobs on LinkedIn, Wellfound and Instahyre, applies to them,
builds a referral path at each company, and keeps your tracker current from
your Gmail.

> Still in development. Ideas, issues and pull requests are welcome.

## What it does

- **Hunt:** searches the portals for your target roles, scores every new posting against your profile, and adds the ones that fit to your tracker.
- **Apply:** fills applications from your resume and saved answers, on LinkedIn Easy Apply, Wellfound, Instahyre and company career sites. Up to 5 at a time.
- **Referrals:** sends blank connection requests to people at companies you applied to, then your own saved message, word for word, once they accept.
- **Email check:** reads your newest emails and moves the tracker on: rejections, interviews, offers and replies.

## What always stays with you

- Anything written in your voice waits for your approval before it is sent.
- Passwords, one-time codes, CAPTCHAs, payment details and IDs: the run stops and hands Chrome to you.
- Claude never writes to anyone beyond your saved referral message.

## Read this first: the risks

- **LinkedIn, Wellfound and Instahyre don't allow automation** in their terms. Using Dream Job breaks them, and they can restrict or close accounts. Bulk connection requests are the most watched.
- **Everything goes out from your own accounts**, as you.
- **Runs use your Claude plan**, or your API credits if you signed in with a key. A long hunt uses a lot.
- **No warranty** (Apache 2.0). Not affiliated with LinkedIn, Wellfound, Instahyre, Google or Anthropic.

## Requirements

- macOS 12 or later, with Google Chrome in Applications
- Claude Code, signed in with `claude auth login` (a Claude plan or an API key)
- Node.js 22 or later, and pnpm, to build it
- Your resume as a PDF

## Install

There's no download yet, so build it once:

```
git clone https://github.com/INNOVATIVEGAMER/dream-job.git
cd dream-job
pnpm install
node node_modules/electron/install.js
pnpm dist:mac:local
```

Drag **Dream Job** from `release/mac-arm64` (Apple silicon) or `release/mac`
(Intel) into Applications, and open it. Setup takes a few minutes: it checks
Claude Code, reads your resume, asks what you're looking for, and has you sign
in to each portal in the app's own Chrome.

## Your data

Everything stays on your Mac, in `~/Library/Application Support/dream-job`:
your tracker, settings, resume, and the app's Chrome profile, kept apart from
your everyday Chrome.

## Troubleshooting

- **"Not signed in" during setup:** run `claude auth login`, then press **Check again**.
- **A site shows as signed out:** Settings, Accounts, then **Sign in**.
- **"Chrome is open for signing in":** quit that Chrome window (Cmd+Q) and start the run again.
- **macOS won't open the app:** a `dist:mac:local` build only runs on the Mac that built it.

## Contributing

```
pnpm install
node node_modules/electron/install.js   # first time only
pnpm dev                                # run from source
pnpm typecheck
pnpm build
```

`CLAUDE.md` explains how the app is put together. For a signed, notarized
release you need a Developer ID Application certificate:

```
xcrun notarytool store-credentials dream-job-notary --apple-id <your Apple ID> --team-id <your team ID>
APPLE_KEYCHAIN_PROFILE=dream-job-notary pnpm dist:mac
```

The app from source and the built app share one data folder, so run one at a time.

## License

[Apache 2.0](LICENSE). Every build includes `THIRD_PARTY_NOTICES.txt` for the
open-source packages bundled into it.
