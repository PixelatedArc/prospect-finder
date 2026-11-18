// The phone-side checks: does the site work on a phone, can people tap to call, and does the phone
// number on the site match the Google listing. Each verdict is written to the sheet as plain text
// and can be read back from that text, so reports work for rows loaded from the sheet too.

const digits = (s) => String(s || '').replace(/\D/g, '');
const last9 = (s) => digits(s).slice(-9);

/** "+18165311000" or "8165311000" -> "(816) 531-1000"; anything else is shown as given. */
function prettyPhone(raw) {
  const d = digits(raw);
  if (d.length === 11 && d[0] === '1') return `(${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}`;
  if (d.length === 10 && !/^0/.test(d)) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
  return String(raw || '').replace(/\s+/g, ' ').trim();
}

/* ---------- mobile ---------- */

/** m: result of mobileCheck(). Returns { ok, reason: 'no-mobile-layout'|'too-wide'|'', smallText } or null when unknown. */
function judgeMobile(m) {
  if (!m || m.error || !m.textChars) return null;
  // The measured layout decides; the viewport tag only explains why. Some responsive sites use an
  // unusual viewport tag, and they must not be called "not mobile" when they fit the screen.
  const wide = m.layoutWidth > 430;
  const reason = !wide ? '' : !m.hasViewport ? 'no-mobile-layout' : 'too-wide';
  return { ok: !wide, reason, smallText: !wide && m.smallShare >= 0.3 };
}
function formatMobile(v) {
  if (!v) return '';
  if (v.reason === 'no-mobile-layout') return 'no: no mobile layout, phones show the shrunken desktop page';
  if (v.reason === 'too-wide') return 'no: wider than a phone screen, visitors zoom out or scroll sideways';
  return v.smallText ? 'yes, but some text is very small' : 'yes';
}
function parseMobile(s) {
  s = String(s || '').trim().toLowerCase();
  if (!s) return null;
  if (s.startsWith('no')) return { ok: false, reason: /no mobile layout/.test(s) ? 'no-mobile-layout' : 'too-wide', smallText: false };
  return { ok: true, reason: '', smallText: /small/.test(s) };
}

/* ---------- tap to call ---------- */

function judgeTap(m) {
  if (!m || m.error || !m.textChars) return null;
  if (!m.telTotal) return { ok: false, where: 'none' };
  if (!m.telVisible) return { ok: true, where: 'menu' };
  return { ok: true, where: m.telNearTop ? 'top' : 'lower' };
}
function formatTap(v) {
  if (!v) return '';
  if (!v.ok) return 'no';
  if (v.where === 'menu') return 'yes, but only inside the menu';
  if (v.where === 'lower') return 'yes, but not on the first screen';
  return 'yes';
}
function parseTap(s) {
  s = String(s || '').trim().toLowerCase();
  if (!s) return null;
  if (s === 'no') return { ok: false, where: 'none' };
  return { ok: true, where: /menu/.test(s) ? 'menu' : /first screen/.test(s) ? 'lower' : 'top' };
}

/* ---------- phone number vs Google ---------- */

/**
 * pages: audit() results (each has .phones). googleRaw/googleText: from the Maps listing.
 * Returns { state: 'match'|'different'|'several'|'not-on-site'|'no-google', site, google }.
 */
function judgePhone(pages, googleRaw, googleText) {
  const google = googleRaw ? (googleText || prettyPhone(googleRaw)) : '';
  if (!googleRaw || last9(googleRaw).length < 9) return { state: 'no-google', site: '', google: '' };
  const all = new Map();
  for (const p of pages) {
    for (const ph of p.phones || []) {
      const k = last9(ph.digits);
      const cur = all.get(k) || { ...ph, count: 0, tel: false };
      cur.count += ph.count;
      cur.tel = cur.tel || ph.tel;
      all.set(k, cur);
    }
  }
  if (!all.size) return { state: 'not-on-site', site: '', google: prettyPhone(google) };
  if (all.has(last9(googleRaw))) return { state: 'match', site: prettyPhone(all.get(last9(googleRaw)).display), google: prettyPhone(google) };
  // The number the site pushes hardest: a tap-to-call number first, then the most repeated one.
  const main = [...all.values()].sort((a, b) => (b.tel - a.tel) || (b.count - a.count))[0];
  return { state: all.size >= 3 ? 'several' : 'different', site: prettyPhone(main.display), google: prettyPhone(google) };
}
function formatPhone(v) {
  if (!v || !v.state) return '';
  if (v.state === 'match') return `match: ${v.google}`;
  if (v.state === 'different') return `different: site ${v.site}, Google ${v.google}`;
  if (v.state === 'several') return `unclear: several numbers on the site, none is Google's ${v.google}`;
  if (v.state === 'not-on-site') return `not on site: no phone number found as text, Google has ${v.google}`;
  return 'no phone on the Google listing';
}
function parsePhone(s) {
  s = String(s || '').trim();
  if (!s) return null;
  let m;
  if ((m = s.match(/^match:\s*(.+)$/i))) return { state: 'match', site: m[1], google: m[1] };
  if ((m = s.match(/^different:\s*site (.+), Google (.+)$/i))) return { state: 'different', site: m[1], google: m[2] };
  if ((m = s.match(/^unclear:.*Google's (.+)$/i))) return { state: 'several', site: '', google: m[1] };
  if ((m = s.match(/^not on site:.*Google has (.+)$/i))) return { state: 'not-on-site', site: '', google: m[1] };
  if (/^no phone/i.test(s)) return { state: 'no-google', site: '', google: '' };
  return null;
}

module.exports = { judgeMobile, formatMobile, parseMobile, judgeTap, formatTap, parseTap, judgePhone, formatPhone, parsePhone, prettyPhone };
