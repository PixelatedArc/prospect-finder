# Prospect Finder

A Windows desktop app that finds local businesses with weak websites and helps you reach them.

You type a niche and a city (for example *dentist* in *Kansas City MO*). The app searches Google Maps, skips the top results, opens the next 5 to 10 business websites and checks each one:

- a separate page for each service
- FAQ content
- real business schema (the code that tells Google and AI assistants what the business is)
- whether the site works on a phone
- tap-to-call on phones
- whether the phone number on the site matches the Google listing

Results go to your Google Sheet, one tab per day, with a serial number for every business. From there the app writes a personal email for each weak site, tracks replies in Gmail, prepares one follow-up, and builds a full audit report for anyone who asks.

Nothing is stored on the PC except one small settings file. Everything else lives in your Google Sheet.

---

## Install on a new PC (no coding needed)

1. Go to this repository's **Releases** page (right-hand side on GitHub) and download **Prospect-Finder-Windows.zip** from the latest release.
2. Right-click the zip, choose **Extract All**, and pick a permanent place such as `Documents\Prospect Finder`. Do not run it from inside the zip.
3. Open the extracted folder and double-click **Create Desktop Shortcut.bat**. A **Prospect Finder** icon appears on your desktop.
4. Open the app from that icon.

If Windows shows "Windows protected your PC", click **More info**, then **Run anyway**. The app is not code-signed, which is why Windows asks.

**Requirements:** Windows 10 or 11, an internet connection, and Google Chrome is *not* needed (the app has its own browser).

## Connect it to your Google Sheet

### If you already use the app on another PC

1. On the PC that is already connected, open **Google Sheet and Gmail connection** and press **Copy connection code**.
2. Send that code to yourself (it is private: it is the key to your sheet and Gmail connection).
3. On the new PC, paste it into the same box and press **Connect**.

That is all. Both PCs now use the same sheet and the same Gmail.

### First time ever (about 2 minutes)

1. In a browser signed in **only** as the Google account you send outreach from (a private window is easiest), go to **sheets.new** and name the sheet.
2. In the sheet: **Extensions > Apps Script**. Delete any code there.
3. In the app, press **Copy the connector code**, paste it into Apps Script, and press **Save**.
4. **Deploy > New deployment > Web app**. Execute as: **Me**. Who has access: **Anyone**. Press **Deploy** and allow access (choose **Advanced > Go to project** if Google warns that it is unverified: it is your own script).
5. Copy the **Web app URL**, paste it into the app and press **Connect**.

Then fill in **Email settings and template**: your name and a real postal address (required by anti-spam law), and your offers. Replies show "[YOUR OFFER GOES HERE]" until you tick **Use these offers in replies**.

## Updating to a new version

1. Download the new **Prospect-Finder-Windows.zip** from Releases.
2. Close the app, then replace the old **App** folder with the new one. Your settings are kept (they live in `%APPDATA%\Prospect Finder`, not in the app folder).
3. If the release notes say the connector changed: in the app press **Copy the connector code**, paste it over the code in Apps Script, then **Deploy > Manage deployments > pencil > Version: New version > Deploy**. The web app link stays the same, so the app needs no change.

---

## How the process works

1. **Find:** run a niche and city. Weak sites (failing 2 of the 3 AI checks) get a priority: High, Medium or Low.
2. **Email:** each weak site gets a personal email built from what was found: their Google rating, up to three problems (phone and mobile first), a competitor from the same search that is already doing it right, and an offer of a free breakdown. Create Gmail drafts, or send from the app.
3. **Replies:** every time the app opens it checks Gmail. Real replies (also from a colleague) are marked and a reply with the full breakdown is drafted for you. "No thanks" and bounces go to Do Not Contact. Out-of-office replies are ignored.
4. **Follow up once:** after 4 days without an answer, one short follow-up in the same thread.
5. **Audit report:** type a serial number, email or website into the Audit report box to get the full breakdown plus your two offers.
6. **Scorecard:** reply rate, calls and wins per niche and city.

## Built-in limits and safeguards

- 10 emails a day by default, never more than 40, with 1.5 to 4 minutes between sends
- nobody gets a first email twice or more than one follow-up; Do Not Contact is always respected
- emails only go to addresses that belong to the business (never a web agency or a placeholder address)
- placeholder prices never reach a client until you confirm your offers
- text from websites and replies can never become a formula in your sheet
- websites are visited like a normal visitor, a few pages each; "I'm not a robot" checks are left for you to complete and are never bypassed

Google's terms do not allow automated use of Maps, so keep to a few runs a day. Read **Sending limits and how to stay out of spam** inside the app before your first send.

---

## For developers: run or build from source

Needs [Node.js](https://nodejs.org) 20 or newer (LTS) on Windows.

```powershell
git clone <this repository's URL>
cd prospect-finder
npm install
npm start          # run the app
npm run build      # build it into dist\win-unpacked
```

To make a release zip: copy `dist\win-unpacked` into a folder named `App`, add `Create Desktop Shortcut.bat` and `READ ME.txt` next to it (see the `release-extras` folder), and zip the whole folder.

If the app quits straight away when started from VS Code's terminal, run `Remove-Item Env:ELECTRON_RUN_AS_NODE` first.

### Project layout

| Path | What it is |
|---|---|
| `main.js` | App window, the browsing window, settings, and everything that talks to the sheet |
| `preload.js` | The bridge between the screen and `main.js` |
| `src/` | The screen: `index.html`, `app.js`, `style.css`, and `cities.js` (city lists from GeoNames, CC BY 4.0) |
| `engine/runner.js` | One run: Google Maps, then each website |
| `engine/page-lib.js` | Reads a page: schema, FAQ, links, emails, phones, the phone-size check |
| `engine/judge.js`, `engine/extras.js` | Turn what was read into verdicts and a priority |
| `engine/email.js`, `engine/report.js` | The emails, the follow-up, the reply, and the audit report |
| `engine/sheet.js`, `engine/periods.js` | Calls to the connector; date ranges for loading earlier runs |
| `apps-script/Code.gs` | The connector pasted into the Google Sheet (the app fills in the private key when you copy it) |
| `release-extras/` | Files that go next to the `App` folder in the release zip |
