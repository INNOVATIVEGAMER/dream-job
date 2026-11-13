# Job App

A macOS app that runs your job search on **LinkedIn**, **Wellfound** and
**Instahyre**. It finds postings that fit you, applies to them, and builds a
referral path at every company you apply to.

It works through two things you already have:

- **Your own Claude Code**, signed in with your own Claude plan. Every run uses
  your plan. There is no API key and no account with this app.
- **Your own Google Chrome**, opened with a separate profile that belongs to
  the app. You sign in to each site once, yourself.

Everything stays on your Mac.

---

## What it does

| Flow | What happens |
| --- | --- |
| **Hunt** | Searches the portals for your target roles, reads each new posting, scores it 1 to 10, and adds the good ones to your tracker. The rest go to Discarded, with the posting's own words that ruled them out. |
| **Apply** | Opens a posting and fills the form from your profile and saved answers, then submits. Works with LinkedIn Easy Apply, Wellfound, Instahyre and companies' own career sites. |
| **Connection requests** | At companies you applied to, sends blank LinkedIn connection requests (never with a note) to people in your field and the hiring team. |
| **Referral messages** | When enough people at a company accept, sends them your own saved message word for word, with your resume attached. |
| **Email check** | Reads your newest emails in Gmail and moves the tracker on: rejections, next rounds, offers and replies, each linked to its email. |

### What always waits for you

- **Anything Claude wrote in your voice.** Before a written answer (a cover note, "why this role") is sent, you see it and can edit it or say no.
- **Passwords, sign-ins and one-time codes.** Claude never types them.
- **CAPTCHAs, payment details, government IDs and the camera.** The run stops and hands Chrome to you.
- **A posting that pays below your floor.** The run asks you before it goes on.
- **Any message beyond your saved referral message.** Claude never writes to anyone.

---

## Before you start

You need:

1. **A Mac** running macOS 12 or later.
2. **Google Chrome**, installed in Applications.
3. **Claude Code**, installed and signed in with a paid Claude plan:

   ```
   claude auth login
   ```

   Sign in with your Claude account, not an API key.

4. **Accounts** on the portals you want to use: LinkedIn, Wellfound, Instahyre.
5. **Your resume as a PDF.**

---

## Install

There is no downloadable release yet, so build the app on your Mac. It takes a
few minutes, once.

1. Install **Node.js 22 or later** (from [nodejs.org](https://nodejs.org)) and
   **pnpm**:

   ```
   npm install -g pnpm
   ```

2. Get the code and build the app:

   ```
   git clone https://github.com/INNOVATIVEGAMER/job-app.git
   cd job-app
   pnpm install
   node node_modules/electron/install.js
   pnpm dist:mac:local
   ```

3. Open the `release` folder in Finder and drag **Job App** into
   **Applications**. It is in `release/mac-arm64` on Apple silicon, or
   `release/mac` on an Intel Mac.

4. Open Job App from Applications.

---

## First run: setup

The app walks you through five steps.

1. **Claude Code.** The app checks that Claude Code is installed, signed in, and on a Claude plan. If a check fails, follow the steps it shows, then press **Check again**.
2. **Your resume.** Choose your PDF. Claude reads it (about a minute) and pulls out your roles, skills, projects, links and a few starter form answers.
3. **Review your profile.** Fix anything Claude got wrong. Everything written for you is drawn from this profile and nothing else.
4. **What you're looking for.** Set the roles you want, roles you skip, the most years a posting may ask for, your country and cities, work modes, and your pay floor.
5. **Portals and sign-in.** Turn on the portals you use, and press **Sign in** for each. Chrome opens; you type your password yourself. The sign-ins stay.

---

## Daily use

### 1. Hunt

1. Go to **Hunt**.
2. Pick the portals and how recent the postings should be (the past day, week or month).
3. Press **Start hunt**.

Each portal gets its own Claude session in its own Chrome tab, and they all run
at once. The run screen shows a tile per portal with its progress: postings
decided out of postings found. A LinkedIn hunt with several roles and cities can
take 20 minutes or more. New finds appear in **Tracker** as *found*, each with
its score and the reasons for it. A role found on two portals is added once.

What each portal searches:

- **LinkedIn:** each of your target roles, remote in your country, and hybrid and on-site in each of your cities.
- **Wellfound:** the job search saved on your Wellfound account. Set your roles, places and pay there, on wellfound.com.
- **Instahyre:** the jobs Instahyre recommends for your Instahyre profile.

### 2. Apply

- From **Home**, press **Apply to next** to work the best-scored found row, or
- Open any row in **Tracker** and press **Apply**, or
- In **Tracker**, tick several found rows and press **Apply to** (the number picked).

Several rows run 5 at a time, each in its own Claude session and Chrome tab; the
rest start as those finish. A session that needs you waits on its own card while
the others keep going. Pick a session's tile on the run screen to see its card.

When a form asks something your saved answers don't cover, the run asks you
once, for all of it, and can save your answers for next time. When it wrote an
answer in your voice, it shows you the text first. After it submits, the row
moves to *applied*.

### 3. Connection requests

1. Go to **Contacts** and press **Send connection requests**.
2. Pick companies you applied to, and how many people at each.
3. Start it.

Requests go out blank, with no note. People already connected to you are
recorded as ready for your message. Each company gets its own session, 5 at a
time. If LinkedIn says the invitation limit is reached, every session stops
sending and the companies not yet started are left for later.

### 4. Referral messages

1. **Write your message once** in **Settings, Referral message**. Use these slots: `{name}`, `{role}`, `{company}`, `{job link}`. The app fills them for each person. Whatever you save is what gets sent, word for word.
2. Go to **Contacts**, press **Message accepted**, then **Check now** to see who accepted.
3. Pick the companies marked **Ready**: 3 people there have accepted, or nobody there is still pending.
4. Press **Send messages**.

The app types your message itself, checks that it matches your saved wording
exactly, attaches your resume, and sends it. If anything doesn't match, nothing
is sent. Each company gets its own session, 5 at a time.

### 5. Update the tracker from Gmail

1. From **Home**, press **Check email**; or from **Tracker**, press **Update from Gmail** to pick how many emails to read first.
2. Claude reads the sender and subject of your newest emails (50 by default), opens only the ones about your job search, and moves the matching rows on.
3. When it ends, **See what changed** lists every change with the email it came from. **Undo** puts a row back as it was.
4. An email about a job that isn't in your tracker waits for you: **Add to tracker** or **Ignore**.

It only reads. It never replies, sends, deletes, archives or labels mail, it leaves read and unread as they were, and it never follows a link in an email. It uses the Google account signed in to the app's Chrome. To run it every time the app opens (at most once a day), turn that on in **Settings, Portals, Gmail**.

### Keep the tracker current

Open a row in **Tracker** to change its status (replied, screen, onsite, offer,
rejected) and add notes. **Add a row** records a job found outside the app,
such as a recruiter who called you.

---

## Settings

| Tab | What it holds |
| --- | --- |
| **Preferences** | Target roles, roles you skip, experience ceiling, places, work modes, visa, pay floor. |
| **Profile** | Your roles, projects, skills and links. The only source for anything written about you. Includes a "never mention or link" list. |
| **Form answers** | Facts forms ask for, such as notice period or expected pay. Learned once, reused everywhere. |
| **Resume** | The PDF uploaded with applications and attached to referral messages. |
| **Referral message** | Your approved wording, and whether to attach your resume. |
| **Portals** | Per portal, and for Gmail: turn each of its tools on or off. A tool that's off hands that step to you in Chrome. Also shows the notes Claude gets there. Gmail's panel sets how many emails a check reads, and whether it runs when the app opens. |
| **Accounts** | Claude Code status, Chrome, and sign-in for each site. |

---

## Your data

- Everything lives in `~/Library/Application Support/job-app`: your tracker, settings, resume, and the app's own Chrome profile.
- The app's Chrome profile is separate from your everyday Chrome.
- Nothing is sent anywhere except through the portals you use and your own Claude Code.

---

## Troubleshooting

**"Not on a Claude plan" or "Not signed in" during setup**
Run `claude auth login` in Terminal, sign in with your Claude account, then press **Check again**.

**"Google Chrome is not installed"**
Install Chrome into the main Applications folder.

**A site shows as signed out**
Go to **Settings, Accounts** and press **Sign in** for that site.

**"Chrome is open for signing in"**
Quit that Chrome window (Cmd+Q), then start the run again.

**A run is waiting**
Check the run screen. A card there says what it needs from you. When a run has
several sessions, each one waiting has its own card: pick its tile. If a site
signs out, one sign-in card covers every session on that site.

**macOS says the app can't be opened**
A build made with `pnpm dist:mac:local` runs only on the Mac that built it. Build it on each Mac, or use a signed release (see below).

---

## Good to know

- Job App is not affiliated with LinkedIn, Wellfound, Instahyre, Google or Anthropic.
- It acts on your own accounts, as you. You are responsible for what it sends and for following each site's terms.
- Runs use your Claude plan's usage. A long hunt uses a lot of it, and five sessions at once use it about five times as fast as one.
- Each session is its own Claude Code process and Chrome tab, so a run of five uses a few GB of memory while it lasts.

---

## For developers

### Run from source

```
pnpm install
node node_modules/electron/install.js   # first time only: downloads Electron
pnpm dev
```

### Checks

```
pnpm typecheck
pnpm build
```

### Packaging

Every process is bundled with what it uses, so the app ships no
`node_modules`, and no copy of Claude Code: it runs the user's own.

- `pnpm dist:mac:local` builds an ad-hoc signed app for the Mac that builds it.
- `pnpm dist:mac` builds a release: a dmg and a zip for Apple silicon and Intel, signed with a Developer ID certificate. It stops if no certificate is found.

To sign and notarize a release:

1. Join the Apple Developer Program and create a **Developer ID Application** certificate (Xcode, Settings, Accounts, Manage Certificates).
2. Store notarization credentials in your keychain, once:

   ```
   xcrun notarytool store-credentials job-app-notary --apple-id <your Apple ID> --team-id <your team ID>
   ```

3. Build:

   ```
   APPLE_KEYCHAIN_PROFILE=job-app-notary pnpm dist:mac
   ```

4. Check: `spctl -a -vv "release/mac-arm64/Job App.app"` should say `source=Notarized Developer ID`.

The app from source and the packaged app share one data folder, so run one at a time.

---

## License

[Apache License 2.0](LICENSE)
