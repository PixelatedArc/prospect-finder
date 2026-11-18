// Writes the website breakdown (audit report) that the first email offers. Plain text, so it can go
// straight into an email reply. Built only from what was actually seen on the site, so it works the
// same for a fresh run and for a row loaded back from the sheet (checks it lacks are left out).

function domainOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch (e) {
    return url;
  }
}

const WHO = [
  [/dent|orthodont|chiro|vet|clinic|medical|doctor/i, 'patients'],
  [/lawyer|attorney|law|legal|med ?spa|salon|spa/i, 'clients'],
  [/plumb|hvac|heating|roof|electric|pest|landscap|lawn|clean|contractor|handyman/i, 'homeowners'],
];
const whoFor = (niche) => (WHO.find(([re]) => re.test(niche || '')) || [null, 'customers'])[1];

/** Explanations for the short notes in the "Other Issue" column. */
function otherNotes(other) {
  const out = [];
  for (const raw of String(other || '').split(/;\s*/).map((s) => s.trim()).filter(Boolean)) {
    let m;
    if (/^no HTTPS/i.test(raw)) out.push('No HTTPS: browsers label the site "Not secure", which makes visitors hesitate and counts against it in Google.');
    else if ((m = raw.match(/footer copyright (\d{4})/i))) out.push(`The footer still says © ${m[1]}, which makes the site look unmaintained to visitors.`);
    else if ((m = raw.match(/thin homepage \((\d+) words\)/i))) out.push(`The homepage has only about ${m[1]} words, too little for Google and AI tools to understand what you offer.`);
    else if (/no H1/i.test(raw)) out.push('The homepage has no main heading (H1), the line search engines read first to understand a page.');
    else if ((m = raw.match(/^(\w+) builder site/i))) out.push(`The site is built on ${m[1]}'s website builder, which limits what can be changed for search and AI visibility.`);
    else if (!/could not check|did not load|blocked|only link/i.test(raw)) out.push(raw.charAt(0).toUpperCase() + raw.slice(1) + '.');
  }
  return out;
}

/** row: { name, website, checks, schemaDetail, other, agency, mobile, tap, phone, rating, reviews } */
function build(row, niche, city) {
  const c = row.checks || {};
  const site = domainOf(row.website);
  const who = whoFor(niche);
  const town = String(city || '').replace(/,.*$/, '').replace(/\s+[A-Z]{2,3}$/, '').trim();
  const out = [];
  const fixes = [];
  const fix = (title, found, why, todo) => fixes.push({ title, found, why, todo });

  // ----- most urgent first: things that lose calls today -----
  const ph = row.phone;
  if (ph && ph.state === 'different') {
    fix('Phone number does not match Google',
      `Your website shows ${ph.site}, but your Google listing shows ${ph.google}.`,
      'Callers and Google both see two different numbers. Google and AI assistants trust business details that match everywhere; mismatched details lower that trust and some callers give up.',
      'Use one main number on the website, the Google listing and the business schema, or explain clearly which number is for what.');
  } else if (ph && ph.state === 'several') {
    fix('Several phone numbers, none matching Google',
      `The site lists several numbers, and none of them is the one on your Google listing (${ph.google}).`,
      'When the numbers do not line up, Google and AI tools cannot be sure which one is right, and people may call the wrong one.',
      'Make the Google listing number the main number on the site, or update the listing.');
  } else if (ph && ph.state === 'not-on-site') {
    fix('Phone number not readable on the site',
      `I could not find your phone number as text on the pages I checked. Your Google listing has ${ph.google}.`,
      'A number inside an image or only in a form cannot be read by Google, AI tools or a phone\'s tap-to-call.',
      'Put the number as plain text in the header and footer, as a tap-to-call link.');
  }

  const mob = row.mobile;
  if (mob && !mob.ok) {
    fix('Not built for phones',
      mob.reason === 'no-mobile-layout'
        ? 'On a phone, the site shows the full desktop page shrunk down. Visitors have to pinch and zoom to read anything.'
        : 'On a phone, the pages are wider than the screen, so visitors have to zoom out or scroll sideways.',
      `Most people looking for a ${niche || 'local business'}${town ? ' in ' + town : ''} search on their phone. If the site is hard to use there, they press back and call the next result. Google also ranks sites that work badly on phones lower.`,
      'Make the layout mobile-first: readable text without zooming, buttons big enough to tap, and the phone number and booking button at the top.');
  } else if (mob && mob.smallText) {
    fix('Small text on phones',
      'The site fits a phone screen, but a lot of the text is very small to read there.',
      'Visitors on phones skim; if they have to zoom, many leave.',
      'Raise the body text to at least 16 px on phones and give buttons more space.');
  }

  const tap = row.tap;
  if (tap && !tap.ok) {
    fix('No tap-to-call on phones',
      'There is no tap-to-call button, so people on a phone have to copy your number by hand.',
      `For a ${niche || 'local business'}, a phone call is usually the conversion. Every extra step loses some of those calls.`,
      'Add a tap-to-call button at the top of every page on phones, ideally one that stays visible while scrolling.');
  } else if (tap && tap.where !== 'top') {
    fix('Tap-to-call is hard to find',
      tap.where === 'menu' ? 'The tap-to-call link is only inside the menu on phones.' : 'The tap-to-call link is not on the first screen on phones.',
      'People ready to call do not hunt for the number.',
      'Show a call button at the top on phones, or one that stays visible while scrolling.');
  }

  // ----- AI and search visibility -----
  if (c.schema === false) {
    const generic = /^Generic only/i.test(row.schemaDetail || '');
    fix('Business details for Google and AI tools (schema): missing',
      generic
        ? `The site only has the automatic code most website builders add (${String(row.schemaDetail || '').replace(/^Generic only:\s*/i, '').replace(/\.\s*No business entity\.?$/i, '')}). Nothing identifies you as a ${niche || 'local business'}.`
        : 'There is no structured data telling search engines what kind of business this is.',
      'Schema is the label machines read. Without it, an AI assistant has to guess what you do, where you are and when you are open, so it tends to recommend businesses that state it clearly.',
      `Add complete ${niche || 'local business'} schema: business type, name, address, phone, opening hours, map location, services and review profiles.`);
  } else if (c.schema === true && /Thin\./.test(row.schemaDetail || '')) {
    fix('Business details for Google and AI tools (schema): thin',
      String(row.schemaDetail),
      'The basics are there, but the details AI tools use to choose between similar businesses (hours, services, area served) are missing.',
      'Fill in the missing fields and use the specific business type for your trade.');
  }
  if (c.faq === false) {
    fix('FAQ answers: missing',
      `I couldn't find a page or section answering the questions ${who} ask before they call.`,
      'People now ask AI tools full questions ("how much does it cost", "do you take my insurance"). A site that answers them in plain words is the one that gets quoted.',
      'Write 8 to 10 real customer questions with short, honest answers, publish them, and mark them up so search engines read them as questions and answers.');
  }
  if (c.service === false) {
    fix('A page for each service: missing',
      'I couldn\'t find a separate page for each service; they appear to be listed together.',
      'A search for one specific service can only land on a page about that service. One shared page loses to sites with a page for each.',
      'Give each main service its own page: what it is, who it is for, what to expect, and a clear way to book.');
  }

  // ----- write it out -----
  out.push(`WEBSITE BREAKDOWN: ${row.name} (${site})`);
  out.push('');
  out.push(mob || tap || (ph && ph.state)
    ? `I looked at your website the way a new ${who.replace(/s$/, '')} would: on a phone, on Google, and through AI assistants like ChatGPT and Google's AI answers.`
    : 'I looked at your website the way Google and AI assistants like ChatGPT and Google\'s AI answers read it.');
  out.push('');

  const glance = [];
  const yn = (v) => (v ? 'yes' : 'no');
  if (ph && ph.state !== 'no-google') glance.push(`Phone number matches Google: ${ph.state === 'match' ? 'yes' : ph.state === 'not-on-site' ? 'not found on site' : 'no'}`);
  if (mob) glance.push(`Works well on phones: ${mob.ok ? (mob.smallText ? 'mostly (small text)' : 'yes') : 'no'}`);
  if (tap) glance.push(`Tap-to-call on phones: ${tap.ok ? (tap.where === 'top' ? 'yes' : 'yes, but hard to find') : 'no'}`);
  if (c.schema != null) glance.push(`Business details for AI (schema): ${c.schema ? (/Thin\./.test(row.schemaDetail || '') ? 'thin' : 'yes') : 'missing'}`);
  if (c.faq != null) glance.push(`FAQ answers: ${yn(c.faq)}`);
  if (c.service != null) glance.push(`A page for each service: ${yn(c.service)}`);
  if (glance.length) {
    out.push('AT A GLANCE');
    glance.forEach((g) => out.push(`  ${g}`));
    out.push('');
  }

  if (fixes.length) {
    out.push('WHAT TO FIX, MOST URGENT FIRST');
    out.push('');
    fixes.forEach((f, i) => {
      out.push(`${i + 1}. ${f.title}`);
      out.push(`   What I found: ${f.found}`);
      out.push(`   Why it matters: ${f.why}`);
      out.push(`   What to do: ${f.todo}`);
      out.push('');
    });
  }

  const notes = otherNotes(row.other);
  if (notes.length) {
    out.push('OTHER THINGS I NOTICED');
    notes.forEach((n) => out.push(`- ${n}`));
    out.push('');
  }

  const good = [];
  if (ph && ph.state === 'match') good.push('your phone number matches your Google listing');
  if (mob && mob.ok && !mob.smallText) good.push('the site works on phones');
  if (tap && tap.ok && tap.where === 'top') good.push('people can tap to call');
  if (c.service === true) good.push('each service has its own page');
  if (c.faq === true) good.push('there is real FAQ content');
  if (c.schema === true && !/Thin\./.test(row.schemaDetail || '')) good.push('the business schema is in place');
  if (Number(row.rating) >= 4.3 && Number(row.reviews) >= 15) good.push(`your Google rating is strong (${row.rating} stars from ${Number(row.reviews).toLocaleString('en-US')} reviews), so the reputation is there; the site just needs to catch up`);
  if (good.length) {
    out.push('WHAT IS ALREADY WORKING');
    good.forEach((g) => out.push(`- ${g.charAt(0).toUpperCase() + g.slice(1)}`));
  }
  return out.join('\n').trim();
}

module.exports = { build };
