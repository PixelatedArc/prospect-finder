const { app, BrowserWindow, ipcMain, shell, session, clipboard, screen } = require('electron');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const runner = require('./engine/runner');
const sheet = require('./engine/sheet');
const mail = require('./engine/email');
const periods = require('./engine/periods');
const report = require('./engine/report');

const LIB = fs.readFileSync(path.join(__dirname, 'engine', 'page-lib.js'), 'utf8');
const APPS_SCRIPT = fs.readFileSync(path.join(__dirname, 'apps-script', 'Code.gs'), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Keep nothing on disk: no browser cache, and the browsing session lives in memory only.
app.commandLine.appendSwitch('disk-cache-size', '1');
app.commandLine.appendSwitch('media-cache-size', '1');

const HARD_DAILY_CAP = 40;
const SEND_GAP_SECONDS = [90, 240]; // random pause between two sent emails

const DEFAULTS = {
  connUrl: '',
  connKey: '',
  sheetUrl: '',
  count: 8,
  skipTop: 3,
  showBrowser: true,
  niche: '',
  country: 'US',
  city: '',
  skipNames: 'Aspen Dental, Heartland Dental, Western Dental, Gentle Dental, Pacific Dental, Roto-Rooter, Mr. Rooter, Mr. Electric, One Hour Heating, Aire Serv, ServiceMaster, Servpro, Terminix, Orkin, Midas, Jiffy Lube, Firestone, Pep Boys, Morgan & Morgan',
  senderName: '',
  senderAddress: '',
  dailyCap: 10,
  offersReady: false, // replies carry "[YOUR OFFER GOES HERE]" until you confirm your real offers
  subject: mail.DEFAULT_SUBJECT,
  body: mail.DEFAULT_BODY,
  followUpBody: mail.DEFAULT_FOLLOWUP,
  replyBody: mail.DEFAULT_REPLY,
  ...mail.DEFAULT_OFFER,
};
const OLD_CONNECTOR = 'Your sheet has an older connector. Press "Copy the connector code" in the app, paste it over the code in Apps Script, then Deploy > Manage deployments > Edit > Version: New version.';

let mainWin = null;
let browseWin = null;
let running = false;
let stopFlag = false;
let emailing = false;
let emailStop = false;

// The only file this app keeps: a few settings (sheet link, your name, the email template).
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
function readSaved() {
  try {
    return JSON.parse(fs.readFileSync(settingsFile(), 'utf8')) || {};
  } catch (e) {
    return {};
  }
}
function loadSettings() {
  return { ...DEFAULTS, ...readSaved() };
}
// Only the values you actually changed are written, so built-in defaults can improve with app updates.
function saveSettings(patch) {
  const saved = { ...readSaved(), ...patch };
  fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
  fs.writeFileSync(settingsFile(), JSON.stringify(saved, null, 2));
  return { ...DEFAULTS, ...saved };
}
function ensureKey() {
  const s = loadSettings();
  return s.connKey ? s : saveSettings({ connKey: crypto.randomBytes(16).toString('hex') });
}
const connOf = (s) => (s.connUrl ? { url: s.connUrl, key: s.connKey } : null);

/** Removes everything Chromium left behind from earlier sessions, except the settings file. */
function wipeLeftovers() {
  const dir = app.getPath('userData');
  let entries = [];
  try {
    entries = fs.readdirSync(dir);
  } catch (e) {
    return;
  }
  for (const name of entries) {
    if (name === 'settings.json' || /^(lockfile|Singleton)/i.test(name)) continue;
    try {
      fs.rmSync(path.join(dir, name), { recursive: true, force: true });
    } catch (e) {}
  }
}

function createMain() {
  mainWin = new BrowserWindow({
    width: 1060,
    height: process.env.PROSPECT_SHOT ? 1900 : 840,
    minWidth: 760,
    minHeight: 560,
    title: 'Prospect Finder',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    autoHideMenuBar: true,
    backgroundColor: '#eef2ff',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  mainWin.removeMenu();
  // The app window only ever shows the app: no navigating away, no pop-up windows.
  mainWin.webContents.on('will-navigate', (e) => e.preventDefault());
  mainWin.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWin.loadFile(path.join(__dirname, 'src', 'index.html'));
  if (process.env.PROSPECT_SHOT) {
    // Development aid: save a picture of the window (optionally with sample results) and exit.
    mainWin.webContents.once('did-finish-load', async () => {
      await sleep(800);
      if (process.env.PROSPECT_DEMO) {
        const demo = JSON.parse(fs.readFileSync(process.env.PROSPECT_DEMO, 'utf8'));
        mainWin.webContents.send('run:demo', demo);
        await sleep(1200);
      }
      if (process.env.PROSPECT_EVAL) {
        // Development aid: run a snippet in the window first (for example, type into the city box).
        const out = await mainWin.webContents.executeJavaScript(fs.readFileSync(process.env.PROSPECT_EVAL, 'utf8')).catch((e) => 'error: ' + e.message);
        if (process.env.PROSPECT_EVAL_OUT) fs.writeFileSync(process.env.PROSPECT_EVAL_OUT, JSON.stringify(out, null, 2));
        await sleep(500);
      }
      const img = await mainWin.webContents.capturePage();
      fs.writeFileSync(process.env.PROSPECT_SHOT, img.toPNG());
      app.quit();
    });
  }
  mainWin.on('closed', () => {
    mainWin = null;
    stopFlag = true;
    emailStop = true;
    closeBrowser();
  });
}

// ---------- The browsing window (an ordinary visible browser page, memory-only session) ----------
function openBrowser(show) {
  const ses = session.fromPartition('prospect-browsing'); // no "persist:" prefix = nothing written to disk
  ses.setUserAgent(ses.getUserAgent().replace(/\s(Electron|prospect-finder|ProspectFinder|Prospect Finder)\/\S+/gi, ''));
  ses.setPermissionRequestHandler((wc, permission, cb) => cb(false));
  ses.removeAllListeners('will-download');
  ses.on('will-download', (e) => e.preventDefault());

  const area = screen.getPrimaryDisplay().workArea;
  const width = Math.min(1200, Math.round(area.width * 0.6));
  browseWin = new BrowserWindow({
    width,
    height: Math.min(860, area.height - 40),
    x: area.x + area.width - width - 10,
    y: area.y + 10,
    show,
    title: 'Prospect Finder - browser',
    autoHideMenuBar: true,
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: { session: ses, contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  browseWin.removeMenu();
  const wc = browseWin.webContents;
  wc.setAudioMuted(true);
  wc.setWindowOpenHandler(() => ({ action: 'deny' }));
  wc.on('will-prevent-unload', (e) => e.preventDefault());
  browseWin.on('closed', () => {
    browseWin = null;
    if (running) stopFlag = true; // closing the browser window stops the run
  });

  return {
    url: () => (browseWin ? wc.getURL() : ''),
    async goto(url, settle = 2000) {
      if (!browseWin) return { ok: false, error: 'browser window closed' };
      let error = null;
      try {
        await Promise.race([
          wc.loadURL(url),
          sleep(35000).then(() => {
            throw new Error('timed out');
          }),
        ]);
      } catch (e) {
        const msg = String(e.message || e);
        if (/timed out/.test(msg)) {
          try {
            wc.stop();
          } catch (ignore) {}
        } else if (!/ERR_ABORTED/.test(msg)) {
          error = (msg.match(/ERR_[A-Z_]+/) || [msg.slice(0, 60)])[0];
        }
      }
      if (error) return { ok: false, error };
      const t = Date.now();
      while (browseWin && wc.isLoading() && Date.now() - t < 12000) await sleep(250);
      await sleep(settle);
      return { ok: true };
    },
    async evaluate(expr) {
      if (!browseWin) throw new Error('browser window closed');
      return Promise.race([
        wc.executeJavaScript(`${LIB}\n;(${expr})`, true),
        sleep(45000).then(() => {
          throw new Error('page took too long to read');
        }),
      ]);
    },
    // Opens a page the way a phone would (Chrome's device mode: 390 px wide, touch, phone browser name),
    // runs `expr` there, then switches back to a normal desktop browser.
    async asPhone(url, expr) {
      if (!browseWin) return { error: 'browser window closed' };
      const cdp = (method, params) => wc.debugger.sendCommand(method, params || {});
      const desktopUA = ses.getUserAgent();
      const chrome = (desktopUA.match(/Chrome\/[\d.]+/) || ['Chrome/130.0.0.0'])[0];
      let attached = false;
      try {
        if (!wc.debugger.isAttached()) wc.debugger.attach('1.3');
        attached = true;
        await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
        await cdp('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
        await cdp('Emulation.setUserAgentOverride', { userAgent: `Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) ${chrome} Mobile Safari/537.36` });
        const nav = await this.goto(url, 2000);
        if (!nav.ok) return { error: nav.error };
        return await this.evaluate(expr);
      } catch (e) {
        return { error: String(e.message || e).slice(0, 80) };
      } finally {
        if (attached && browseWin) {
          try {
            await cdp('Emulation.clearDeviceMetricsOverride');
            await cdp('Emulation.setTouchEmulationEnabled', { enabled: false });
            await cdp('Emulation.setUserAgentOverride', { userAgent: desktopUA });
            wc.debugger.detach();
          } catch (ignore) {}
        }
      }
    },
    show() {
      if (browseWin) {
        browseWin.show();
        browseWin.focus();
      }
    },
  };
}
function closeBrowser() {
  if (browseWin) {
    try {
      browseWin.destroy();
    } catch (e) {}
    browseWin = null;
  }
  // Forget every cookie and cached file from the sites that were visited.
  const ses = session.fromPartition('prospect-browsing');
  ses.clearStorageData().catch(() => {});
  ses.clearCache().catch(() => {});
}

// ---------- One run ----------
async function doRun(opts, emit) {
  const settings = saveSettings({
    niche: opts.niche, country: opts.country || 'US', city: opts.cityInput || opts.city, count: opts.count, skipTop: opts.skipTop, showBrowser: opts.showBrowser,
  });
  const conn = connOf(settings);
  running = true;
  stopFlag = false;
  const browser = openBrowser(opts.showBrowser !== false);
  const out = { ok: false };
  try {
    let knownDomains = [];
    if (conn) {
      emit({ type: 'status', msg: 'Checking which businesses are already in your sheet' });
      try {
        const d = await sheet.domains(conn);
        knownDomains = d.domains || [];
        if (d.url) saveSettings({ sheetUrl: d.url });
      } catch (e) {
        emit({ type: 'log', msg: `Could not read the sheet first (${e.message}). Continuing; duplicates are not filtered this run.` });
      }
    }
    const result = await runner.run(
      browser,
      { ...opts, knownDomains, skipNames: settings.skipNames },
      (ev) => {
        if (ev.type === 'attention') browser.show();
        emit(ev);
      },
      () => stopFlag,
    );
    Object.assign(out, await finish(result, conn, emit), { ok: true });
  } catch (e) {
    if (e instanceof runner.Stopped) {
      out.stopped = true;
      out.error = 'Stopped. Nothing from this run was written to the sheet.';
    } else {
      out.error = String(e.message || e);
    }
  } finally {
    running = false;
    closeBrowser();
  }
  return out;
}

async function finish(result, conn, emit) {
  const rows = result.rows.map(runner.toSheetRow);
  const res = { result, sheetRows: rows, tab: sheet.todayTab(), sheet: null };
  if (!rows.length || !conn) return res;
  emit({ type: 'status', msg: `Writing ${rows.length} rows to the "${res.tab}" tab` });
  try {
    const a = await sheet.append(conn, res.tab, rows, runner.HEADERS);
    res.sheet = { ok: true, url: a.url, created: a.created, startRow: a.startRow, ids: a.ids || [] };
    emit({ type: 'log', msg: `Sheet updated: tab "${res.tab}"${a.created ? ' (new tab created)' : ''}, starting at row ${a.startRow}.` });
  } catch (e) {
    res.sheet = { ok: false, error: e.message };
    emit({ type: 'log', msg: `Could not write to the sheet: ${e.message}` });
  }
  return res;
}

// ---------- Outreach emails ----------
function buildEmails(rows, ctx) {
  const s = loadSettings();
  // A competitor from the same search whose site passes every check, the best reviewed first.
  const strong = rows.filter((r) => r.audited && r.fails === 0).sort((a, b) => (Number(b.reviews) || 0) - (Number(a.reviews) || 0));
  return rows
    .filter((r) => r.audited && r.fails >= 2)
    .sort((a, b) => (b.priorityScore || 0) - (a.priorityScore || 0)) // best prospects first, so the daily limit is spent on them
    .map((r) => {
      // Rows loaded back from the sheet carry their own niche and city; a fresh run uses the form values.
      const fromSheet = typeof r.context === 'string';
      const niche = fromSheet ? r.niche : ctx.niche;
      const city = fromSheet ? r.city : ctx.city;
      return {
        name: r.name,
        weak: r.weak,
        priority: r.priority || '',
        priorityWhy: r.priorityWhy || '',
        context: fromSheet ? r.context : `${niche}, ${city}`,
        tab: r.tab || '',
        email: mail.build(r, {
          niche, city, senderName: s.senderName, senderAddress: s.senderAddress, subject: s.subject, body: s.body,
          peer: fromSheet ? r.strong : (strong.find((x) => x.name !== r.name) || {}).name,
        }),
      };
    });
}

async function runEmails({ mode, items, context }, emit) {
  const s = loadSettings();
  const conn = connOf(s);
  if (!conn) return { ok: false, error: 'Connect your Google Sheet first. Emails go out through that same connection.' };
  if (!s.senderName.trim() || !s.senderAddress.trim()) {
    return { ok: false, error: 'Fill in your name and postal address under "Email settings" first. US law (CAN-SPAM) requires a real postal address in every outreach email.' };
  }
  if (emailing) return { ok: false, error: 'Emails are already going out.' };
  emailing = true;
  emailStop = false;
  const cap = Math.min(HARD_DAILY_CAP, Math.max(1, Number(s.dailyCap) || 10));
  const done = [];
  let sentNow = 0;
  let limitMsg = null;
  try {
    for (let i = 0; i < items.length; i++) {
      if (emailStop) break;
      const it = items[i];
      if (mode === 'send' && sentNow > 0) {
        const wait = Math.round(SEND_GAP_SECONDS[0] + Math.random() * (SEND_GAP_SECONDS[1] - SEND_GAP_SECONDS[0]));
        for (let left = wait; left > 0 && !emailStop; left--) {
          if (left % 5 === 0 || left === wait) emit({ type: 'wait', index: i, total: items.length, seconds: left, to: it.to });
          await sleep(1000);
        }
        if (emailStop) break;
      }
      emit({ type: 'working', index: i, total: items.length, to: it.to });
      try {
        const r = it.type === 'followup'
          ? await sheet.followUp(conn, { mode, to: it.to, text: it.text, dailyCap: cap })
          : await sheet.email(conn, {
            mode, to: it.to, subject: it.subject, text: it.text, business: it.business, context: it.context || context, senderName: s.senderName, dailyCap: cap,
          });
        done.push({ to: it.to, business: it.business, status: r.status, reason: r.reason || '' });
        if (r.status === 'sent' || r.status === 'follow-up sent') sentNow++;
        emit({ type: 'done', index: i, total: items.length, to: it.to, status: r.status, reason: r.reason || '' });
      } catch (e) {
        if (e.limit) {
          limitMsg = e.message;
          emit({ type: 'limit', msg: e.message });
          break;
        }
        done.push({ to: it.to, business: it.business, status: 'failed', reason: e.message });
        emit({ type: 'done', index: i, total: items.length, to: it.to, status: 'failed', reason: e.message });
      }
    }
  } finally {
    emailing = false;
  }
  return { ok: true, mode, done, stopped: emailStop, limit: limitMsg, remaining: items.length - done.length };
}

// ---------- IPC ----------
ipcMain.handle('settings:get', () => {
  const s = ensureKey();
  return {
    ...s,
    connKey: undefined,
    appsScript: APPS_SCRIPT.replace('__PROSPECT_KEY__', s.connKey),
    connectionCode: s.connUrl ? `${s.connUrl}#key=${s.connKey}` : '',
    today: sheet.todayTab(),
    hardCap: HARD_DAILY_CAP,
    gap: SEND_GAP_SECONDS,
    defaults: { subject: mail.DEFAULT_SUBJECT, body: mail.DEFAULT_BODY, followUpBody: mail.DEFAULT_FOLLOWUP, replyBody: mail.DEFAULT_REPLY },
  };
});
ipcMain.handle('settings:save', (e, patch) => {
  const allowed = ['skipNames', 'senderName', 'senderAddress', 'dailyCap', 'subject', 'body', 'followUpBody', 'replyBody',
    'offerName', 'offerIncludes', 'offerPrice', 'offerTimeline', 'offer2Name', 'offer2Includes', 'offer2Price', 'bookingLink', 'offersReady'];
  const clean = {};
  for (const k of allowed) if (k in patch) clean[k] = patch[k];
  if ('dailyCap' in clean) clean.dailyCap = Math.min(HARD_DAILY_CAP, Math.max(1, Number(clean.dailyCap) || 10));
  if ('offersReady' in clean) clean.offersReady = clean.offersReady === true;
  saveSettings(clean);
  return true;
});
ipcMain.handle('sheet:test', async (e, input) => {
  const parsed = sheet.parseConnection(input);
  const key = parsed.key || ensureKey().connKey;
  try {
    const r = await sheet.ping({ url: parsed.url, key });
    saveSettings({ connUrl: parsed.url, connKey: key, sheetUrl: r.url });
    return { ok: true, name: r.name, url: r.url, connectionCode: `${parsed.url}#key=${key}` };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});
ipcMain.handle('run:start', async (e, opts) => {
  if (running) return { ok: false, error: 'A run is already in progress.' };
  const emit = (ev) => mainWin && !mainWin.isDestroyed() && mainWin.webContents.send('run:event', ev);
  return doRun(opts, emit);
});
ipcMain.handle('run:stop', () => {
  stopFlag = true;
  return true;
});
ipcMain.handle('email:build', (e, { rows, ctx }) => buildEmails(rows, ctx));
ipcMain.handle('email:status', async () => {
  const conn = connOf(loadSettings());
  if (!conn) return { ok: false, error: 'not connected' };
  try {
    return await sheet.emailStatus(conn);
  } catch (err) {
    return { ok: false, error: err.message };
  }
});
// Loads WEAK rows back from the sheet for one day or a period (see engine/periods.js).
ipcMain.handle('email:load', async (e, opts = {}) => {
  const conn = connOf(loadSettings());
  if (!conn) return { ok: false, error: 'Connect your Google Sheet first.' };
  try {
    const list = await sheet.weakRows(conn, {}); // with no tab named, the connector only lists the date tabs
    const pick = periods.pickTabs(list.tabs || [], opts);
    if (pick.error) return { ok: false, error: pick.error };
    const { tabs, wanted } = pick;
    if (!wanted.length) return { ok: true, tabs, picked: [], rows: [] };
    const r = await sheet.weakRows(conn, wanted.length === 1 ? { tab: wanted[0], tabs: wanted } : { tabs: wanted });
    if (wanted.length > 1 && !(r.version >= 4)) return { ok: false, error: OLD_CONNECTOR };
    const picked = r.picked ? wanted.filter((t) => r.picked.includes(t)) : (r.tab ? [r.tab] : []);
    const rows = r.rows.map((row) => ({ ...sheet.rowFromSheet(row), tab: row.tab || r.tab || '' }));
    return { ok: true, tabs, picked, rows };
  } catch (err) {
    return { ok: false, error: /unknown action/.test(err.message) ? OLD_CONNECTOR : err.message };
  }
});
/** Builds the breakdown (and the reply that carries it) for one row read from the sheet. */
function reportFor(sheetRow) {
  const s = loadSettings();
  const r = sheet.rowFromSheet(sheetRow);
  const text = r.checks.faq === undefined && r.checks.schema === undefined && !r.mobile && r.summary
    ? r.summary // not a scored site: keep whatever was saved
    : report.build(r, r.niche, r.city);
  const reply = mail.buildReply({ business: r.name, website: r.website, ownerName: r.ownerName, summary: text }, s);
  return { text, reply };
}

// Audit report on demand: find a business by serial number, email, website or name.
ipcMain.handle('report:find', async (e, query) => {
  const conn = connOf(loadSettings());
  if (!conn) return { ok: false, error: 'Connect your Google Sheet first.' };
  try {
    const r = await sheet.report(conn, String(query || ''));
    return {
      ok: true,
      total: r.total,
      matches: r.matches.map((m) => {
        const built = reportFor(m);
        const email = (String(m.email || '').match(/^([^\s@]+@[^\s@()]+)/) || [])[1] || '';
        return { id: m.id, name: m.name, website: m.website, tab: m.tab, context: m.context, weak: m.weak, email, status: m.status, logStatus: m.logStatus,
          report: built.text, reply: built.reply };
      }),
    };
  } catch (err) {
    return { ok: false, error: /unknown action/.test(err.message) ? OLD_CONNECTOR : err.message };
  }
});
ipcMain.handle('report:draft', async (e, { to, text }) => {
  const conn = connOf(loadSettings());
  if (!conn) return { ok: false, error: 'Connect your Google Sheet first.' };
  try {
    await sheet.replyDraft(conn, to, text);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: /could not find their reply/.test(err.message) ? 'There is no email from them in your Gmail yet, so there is no thread to reply in. Use "Copy" and paste it into an email instead.' : err.message };
  }
});

// Looks in Gmail for replies and bounces, drafts the summary reply for anyone who answered,
// lists who is due a follow-up, and refreshes the scorecard.
ipcMain.handle('pipeline:check', async () => {
  const s = loadSettings();
  const conn = connOf(s);
  if (!conn) return { ok: false, error: 'Connect your Google Sheet first.' };
  try {
    const p = await sheet.pipeline(conn);
    const replies = [];
    for (const r of p.newReplies) {
      const item = { business: r.business, to: r.to, snippet: r.snippet, drafted: false, note: '', id: r.row ? r.row.id : '' };
      if (r.row) r.summary = reportFor(r.row).text; // the full breakdown, written fresh from the sheet row
      if (!s.senderName.trim()) {
        item.note = 'Reply not drafted: fill in your name under "Email settings" first.';
      } else {
        try {
          await sheet.replyDraft(conn, r.replyFrom || r.to, mail.buildReply(r, s));
          item.drafted = true;
        } catch (err) {
          item.note = `Reply not drafted: ${err.message}`;
        }
      }
      replies.push(item);
    }
    const followUps = p.followUps.map((f) => ({ to: f.to, business: f.business, context: f.search, sentOn: f.sentOn, text: mail.buildFollowUp(f, s) }));
    return { ok: true, replies, optOuts: p.optOuts, bounces: p.bounces, nowSent: p.nowSent, followUps, scorecard: p.scorecard,
      draftsDeleted: p.draftsDeleted || [], waitingDrafts: p.waitingDrafts || 0, autoReplies: p.autoReplies || [],
      sentToday: p.sentToday, partial: p.partial, checked: p.checked };
  } catch (err) {
    return { ok: false, error: /unknown action/.test(err.message) ? OLD_CONNECTOR : err.message };
  }
});
ipcMain.handle('email:run', (e, job) => {
  const emit = (ev) => mainWin && !mainWin.isDestroyed() && mainWin.webContents.send('email:event', ev);
  return runEmails(job, emit);
});
ipcMain.handle('email:stop', () => {
  emailStop = true;
  return true;
});
ipcMain.handle('copy', (e, text) => {
  clipboard.writeText(String(text));
  return true;
});
ipcMain.handle('open', (e, target) => (/^https:\/\//.test(target) ? shell.openExternal(target) : false));

// ---------- Start ----------
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  wipeLeftovers();
  app.on('second-instance', () => {
    if (mainWin) {
      if (mainWin.isMinimized()) mainWin.restore();
      mainWin.focus();
    }
  });
  app.whenReady().then(async () => {
    // Self-test mode used during development: runs once without the window and writes the result to a file.
    if (process.env.PROSPECT_AUTORUN) {
      const opts = JSON.parse(process.env.PROSPECT_AUTORUN);
      const events = [];
      let payload;
      try {
        payload = { ...(await doRun(opts, (ev) => events.push(ev))), events };
        if (payload.result) payload.emails = buildEmails(payload.result.rows, opts);
      } catch (err) {
        payload = { ok: false, error: String(err.stack || err), events };
      }
      fs.writeFileSync(process.env.PROSPECT_OUT, JSON.stringify(payload, null, 2));
      app.quit();
      return;
    }
    createMain();
  });
  app.on('window-all-closed', async () => {
    try {
      await session.defaultSession.clearCache();
      await session.defaultSession.clearStorageData();
    } catch (e) {}
    app.quit();
  });
}
