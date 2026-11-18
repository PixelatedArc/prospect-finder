// Builds every outreach message from the templates: first email, follow-up, and the reply that
// carries the audit summary and the offer. No sending happens here.
//
// How the first email works (cold email structure):
//   1. {{opener}}   a specific, true compliment (their Google rating) that shows you actually looked
//   2. the shift    people search on their phones and ask ChatGPT / Google's AI who to call
//   3. {{findings}} up to 3 problems, the ones an owner feels first at the top: phone number vs
//                   Google, the site on a phone, tap-to-call, then the AI basics
//   4. {{proof}}    a named competitor from the same search that already has the AI basics (loss aversion)
//   5. the ask      a free full breakdown, answered with one word ("Want me to send it over?")
// Every line is built from facts the app collected. Lines with no data simply drop out.

const DEFAULT_SUBJECT = '{{business}} on ChatGPT';
const DEFAULT_BODY = `Hi {{greeting}},

{{opener}}

Most people looking for a {{niche}} in {{city}} search on their phone, and more of them now ask ChatGPT or Google's AI who to call. I checked {{website}} the way they would, and found a few things that could be costing you {{customers}}:
{{findings}}

{{proof}}

I put together a full breakdown for {{business}}: everything I found, what to fix first, and whether it makes more sense to improve your current site or start fresh. Want me to send it over?

{{sender}}
{{address}}

P.S. Not for you? Reply "no thanks" and I won't email again.`;

const DEFAULT_FOLLOWUP = `Hi {{greeting}},

One thing I left out: the same fixes also help {{business}} show up in regular Google search and on Maps, not just in AI answers, because Google reads the same signals.

The breakdown for {{website}} is ready. Should I send it, or is now a bad time?

{{sender}}`;

const DEFAULT_REPLY = `Hi {{greeting}},

Thanks for getting back to me. Here's the breakdown for {{website}}. It's yours to keep: your web person can use it as a checklist.

{{summary}}

{{offer}}

Best,
{{sender}}`;

// Placeholder offers until you set your own under "Email settings". Option 1 is priced from 2026 US
// market rates (schema setup alone commonly $300 to $500; audit plus implementation $500 to $1,500).
// Option 2 (a new site you build and look after) uses a typical small-business range: a few thousand
// to build, or a monthly plan that includes hosting and changes.
const DEFAULT_OFFER = {
  offerName: 'AI Visibility Fix',
  offerIncludes: 'the phone and mobile fixes, complete business schema, an FAQ section of 8 to 10 questions with matching schema, and a page for each of your main services (up to 5)',
  offerPrice: '$950',
  offerTimeline: '7 days',
  offer2Name: 'AI-ready website',
  offer2Includes: 'a new mobile-first website built so Google and AI assistants understand it from day one, with your services, FAQs and tap-to-call set up; we host it, keep it updated and make changes whenever you need them',
  offer2Price: '$2,500 to build, then $149 a month for hosting, updates and changes',
  bookingLink: '',
};

// Words that make the email sound like it was written for their trade.
// one: the business, said singular; who: their customers; service: a high-value search; asks: what customers ask first.
const NICHES = [
  [/dent|orthodont/i, { one: 'dental practice', who: 'patients', service: 'dental implants', asks: 'whether you take their insurance and what a visit costs' }],
  [/chiro/i, { one: 'chiropractic clinic', who: 'patients', service: 'sciatica treatment', asks: 'whether insurance covers it and how many visits they will need' }],
  [/vet|animal/i, { one: 'veterinary clinic', who: 'pet owners', service: 'emergency vet care', asks: 'what a visit costs and whether you take walk-ins' }],
  [/med ?spa|aesthetic|botox/i, { one: 'med spa', who: 'clients', service: 'Botox', asks: 'what it costs and how long results last' }],
  [/lawyer|attorney|law firm|legal/i, { one: 'law firm', who: 'clients', service: 'car accident claims', asks: 'what it costs and whether they even have a case' }],
  [/plumb/i, { one: 'plumbing company', who: 'homeowners', service: 'water heater repair', asks: 'how fast you can come out and what it will cost' }],
  [/hvac|heating|air cond|furnace/i, { one: 'HVAC company', who: 'homeowners', service: 'AC repair', asks: 'how fast you can come out and whether repair beats replacing' }],
  [/roof/i, { one: 'roofing company', who: 'homeowners', service: 'roof replacement', asks: 'what a new roof costs and whether insurance will cover it' }],
  [/electric/i, { one: 'electrical contractor', who: 'homeowners', service: 'panel upgrades', asks: 'what it costs and whether you are licensed for the job' }],
  [/pest|extermin/i, { one: 'pest control company', who: 'homeowners', service: 'termite treatment', asks: 'whether the treatment is safe for kids and pets and what it costs' }],
  [/landscap|lawn/i, { one: 'landscaping company', who: 'homeowners', service: 'lawn care', asks: 'what weekly service costs and which areas you cover' }],
  [/auto|mechanic|car repair|collision/i, { one: 'auto shop', who: 'drivers', service: 'brake repair', asks: 'what a repair will cost and how long it takes' }],
];
function nicheWords(niche) {
  const hit = NICHES.find(([re]) => re.test(niche || ''));
  if (hit) return hit[1];
  const n = String(niche || 'local').toLowerCase();
  return { one: `${n} business`, who: 'customers', service: `${n} services`, asks: 'what it costs and how soon you can help' };
}

function domainOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch (e) {
    return String(url || '');
  }
}

/** "Crossroads Dentistry - Fleming J Daniel Dr" -> "Crossroads Dentistry"; "Smile Co | Austin TX" -> "Smile Co". */
function shortName(name) {
  const n = String(name || '').trim();
  const cut = n.split(/\s+[-|–—:]\s+|\s*\(/)[0].trim();
  return cut.length >= 3 ? cut : n;
}

/** "Kansas City MO" -> "Kansas City"; "Leeds, England, United Kingdom" -> "Leeds"; "Toronto ON, Canada" -> "Toronto". */
function townOf(city) {
  return String(city || '')
    .replace(/,\s*(United Kingdom|Canada|Australia|New Zealand|Ireland)$/i, '')
    .replace(/,\s*(England|Scotland|Wales|Northern Ireland)$/i, '')
    .replace(/,\s*[^,]+$/, (m) => (/^,\s*[A-Z][a-z]/.test(m) ? '' : m)) // "Hamilton, Waikato" -> "Hamilton"
    .replace(/\s+[A-Z]{2,3}$/, '')
    .trim();
}

/**
 * Plain-English list of what the site gets wrong, the problems an owner feels first at the top:
 * phone number vs Google, phones, tap-to-call, then the AI basics. At most `max` lines; the rest
 * goes into the breakdown.
 */
function findings(row, niche, city, max = 3) {
  const c = row.checks || {};
  const w = nicheWords(niche);
  const town = townOf(city) || 'your area';
  const detail = String(row.schemaDetail || '');
  const list = [];
  const ph = row.phone;
  if (ph && ph.state === 'different') {
    list.push(`- your website shows ${ph.site} but Google shows ${ph.google}, so callers and AI tools can't tell which number is right`);
  }
  if (row.mobile && !row.mobile.ok) {
    list.push(row.mobile.reason === 'no-mobile-layout'
      ? '- on a phone, your site shows the shrunken desktop version, so visitors have to pinch and zoom'
      : '- on a phone, your pages are wider than the screen, so visitors have to scroll sideways');
  }
  if (row.tap && !row.tap.ok) list.push('- there\'s no tap-to-call button on phones, so people have to copy your number by hand');
  if (c.schema === false) {
    list.push(/^generic/i.test(detail)
      ? `- your site's code describes you as a generic website, not a ${w.one} in ${town}, so AI tools can't confirm what you do, where you are or when you're open`
      : `- nothing in your site's code tells Google or AI tools that you're a ${w.one} in ${town}, or when you're open`);
  }
  // FAQ and service pages are judged from the pages the app could reach, so these two are worded as
  // "I couldn't find": still a clear problem, but never a wrong accusation if a page was missed.
  if (c.faq === false) list.push(`- I couldn't find an FAQ answering what ${w.who} ask before they call, like ${w.asks}`);
  if (c.service === false) list.push(`- I couldn't find a separate page for each service, so a search for "${w.service} in ${town}" has no page of yours to show`);
  return list.slice(0, max).join('\n');
}

/** A specific, true compliment when the reviews earn one; otherwise a plain "here is why I am writing". */
function opener(row, niche, city) {
  const w = nicheWords(niche);
  const rating = Number(row.rating) || 0;
  const reviews = Number(row.reviews) || 0;
  if (rating >= 4.3 && reviews >= 15) {
    const cap = w.who.charAt(0).toUpperCase() + w.who.slice(1);
    return `${reviews.toLocaleString('en-US')} Google reviews at ${rating} stars. ${cap} clearly like you.`;
  }
  const town = townOf(city);
  const many = /y$/.test(w.one) ? w.one.slice(0, -1) + 'ies' : /s$/.test(w.one) ? w.one + 'es' : w.one + 's';
  return `I was looking at ${many}${town ? ' in ' + town : ''} and spent a few minutes on your site.`;
}

function render(template, vars) {
  return String(template || '').replace(/\{\{\s*(\w+)\s*\}\}/g, (m, k) => (vars[k] == null ? '' : String(vars[k])));
}
const tidy = (s) => s.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();

/** "Dr. Tomlinson" from "Dr. Angella Tomlinson", "John" from "John Smith", otherwise "there". */
function greetingFrom(ownerName) {
  const n = String(ownerName || '').trim();
  if (!n) return 'there';
  const parts = n.replace(/^Dr\.?\s+/i, '').split(/\s+/);
  return /^Dr\b/i.test(n) ? `Dr. ${parts[parts.length - 1]}` : parts[0];
}

// Until you confirm your real offers, replies carry this instead of placeholder prices.
const OFFER_NOT_SET = '[YOUR OFFER GOES HERE: set your two offers and prices under "Email settings and template" in Prospect Finder and tick "Use these offers in replies". Or delete this line and suggest a quick call instead.]';

function offerText(s) {
  if (!s || !s.offersReady) return OFFER_NOT_SET;
  const pick = (k) => (s && String(s[k] || '').trim()) || DEFAULT_OFFER[k];
  const lines = ['If you\'d rather not deal with it yourself, there are two ways I can help:', ''];
  lines.push(`1. Keep your current website and I fix it (${pick('offerName')}): ${pick('offerIncludes')}. ${pick('offerPrice')}, done in ${pick('offerTimeline')}, no contract.`);
  lines.push('');
  lines.push(`2. Start fresh with a new ${pick('offer2Name')}: ${pick('offer2Includes')}. ${pick('offer2Price')}.`);
  lines.push('');
  lines.push(s && s.bookingLink
    ? `If either sounds useful, grab 15 minutes here and I'll walk you through it: ${s.bookingLink}`
    : 'If either sounds useful, reply with a good time for a 15 minute call and I\'ll walk you through it.');
  return lines.join('\n');
}

/** First email. Returns { to, kind, business, subject, text } or null if the site has no email. ctx.peer: a competitor from the same search that passes every check. */
function build(row, ctx) {
  if (!row.emailRaw) return null;
  const c = row.checks || {};
  const missingCount = ['schema', 'faq', 'service'].filter((k) => c[k] === false).length;
  const peer = ctx.peer && shortName(ctx.peer) !== shortName(row.name) ? shortName(ctx.peer) : '';
  const town = townOf(ctx.city);
  const vars = {
    business: shortName(row.name),
    website: domainOf(row.website),
    niche: ctx.niche,
    city: town,
    customers: nicheWords(ctx.niche).who,
    opener: opener(row, ctx.niche, ctx.city),
    missing: missingCount >= 3 ? 'three' : missingCount === 2 ? 'two' : 'some',
    findings: findings(row, ctx.niche, ctx.city),
    // The named competitor passed every AI check, so the line only claims those.
    proof: peer && missingCount >= 1 ? `${peer}, also in ${town || 'your area'}, already has the business details, FAQ answers and service pages these AI tools read.` : '',
    greeting: row.greeting || greetingFrom(row.ownerName),
    sender: ctx.senderName || '',
    address: ctx.senderAddress || '',
  };
  return {
    to: row.emailRaw,
    kind: row.emailKind,
    business: row.name,
    subject: render(ctx.subject || DEFAULT_SUBJECT, vars).replace(/\s+/g, ' ').trim(),
    text: tidy(render(ctx.body || DEFAULT_BODY, vars)),
  };
}

/** Follow-up for someone who has not answered. `p` is { business, website, ownerName }. */
function buildFollowUp(p, s) {
  return tidy(render(s.followUpBody || DEFAULT_FOLLOWUP, {
    business: shortName(p.business),
    website: domainOf(p.website),
    greeting: greetingFrom(p.ownerName),
    sender: s.senderName || '',
  }));
}

/** Reply to someone who answered: the audit summary plus the offer. */
function buildReply(p, s) {
  return tidy(render(s.replyBody || DEFAULT_REPLY, {
    business: shortName(p.business),
    website: domainOf(p.website),
    greeting: greetingFrom(p.ownerName),
    summary: p.summary || '(The summary for this site was not saved. Write a few lines here before sending.)',
    offer: offerText(s),
    sender: s.senderName || '',
  }));
}

module.exports = { build, buildFollowUp, buildReply, greetingFrom, offerText, shortName, townOf, OFFER_NOT_SET, DEFAULT_SUBJECT, DEFAULT_BODY, DEFAULT_FOLLOWUP, DEFAULT_REPLY, DEFAULT_OFFER };
