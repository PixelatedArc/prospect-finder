// Injected into every page by setup.js. Call from browser_evaluate, e.g. () => window.__prospect.audit()
window.__prospect = {
mapsList: async () => {
  // Run on a Google Maps search results page (https://www.google.com/maps/search/...).
  // Returns the organic listings in ranked order: ads removed, duplicates removed.
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let feed = null;
  for (let t = 0; t < 20 && !feed; t++) {
    feed = document.querySelector('div[role="feed"]');
    if (!feed) await sleep(500);
  }
  if (!feed) {
    return {
      error: 'no results feed found',
      title: document.title,
      url: location.href,
      bodyStart: document.body.innerText.slice(0, 400),
    };
  }
  for (let i = 0; i < 3; i++) {
    feed.scrollTo(0, feed.scrollHeight);
    await sleep(1500);
  }
  const seen = new Set();
  const listings = [];
  let adsSkipped = 0;
  for (const a of feed.querySelectorAll('a.hfpxzc')) {
    const card = a.parentElement;
    const text = card ? card.innerText : '';
    if (/(^|\n)\s*Sponsored\s*(\n|$)/i.test(text)) {
      adsSkipped++;
      continue;
    }
    const name = (a.getAttribute('aria-label') || '').trim();
    const key = a.href.split('?')[0].split('/data=')[1] || name;
    if (!name || seen.has(name) || seen.has(key)) continue;
    seen.add(name);
    seen.add(key);
    listings.push({
      rank: listings.length + 1,
      name,
      placeUrl: a.href,
      info: text.replace(/\s*\n+\s*/g, ' | ').slice(0, 140),
      rating: (text.match(/(\d\.\d)\s*\(([\d,]+)\)/) || [])[1] || '',
      reviews: Number(((text.match(/(\d\.\d)\s*\(([\d,]+)\)/) || [])[2] || '0').replace(/,/g, '')),
    });
  }
  return { query: document.title, adsSkipped, count: listings.length, listings };
},

mapsPlace: async () => {
  // Run on a single Google Maps place page. Returns the business name and its website link.
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let t = 0; t < 20 && !document.querySelector('h1'); t++) await sleep(400);
  await sleep(900);
  const site = document.querySelector('a[data-item-id="authority"]');
  const phone = document.querySelector('[data-item-id^="phone:"]');
  const h1 = document.querySelector('h1');
  return {
    name: h1 ? h1.innerText.trim() : null,
    website: site ? site.href : null,
    phone: phone ? phone.getAttribute('data-item-id').replace('phone:tel:', '') : null,
    phoneText: phone ? ((phone.getAttribute('aria-label') || phone.innerText || '').replace(/^\s*phone:\s*/i, '').trim() || null) : null,
  };
},

audit: async () => {
  // Run on any page of a business website. Collects the raw evidence for the audit:
  // structured data (JSON-LD + microdata), FAQ signals, internal links, footer credits, emails.
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  window.scrollTo(0, document.body.scrollHeight);
  await sleep(1200);

  const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const typeName = (t) => String(t).replace(/^https?:\/\/schema\.org\//i, '').replace(/^schema:/i, '');

  // ---------- Structured data ----------
  // schema.org LocalBusiness and its subtypes (plus MedicalOrganization types that
  // work as a local business entity, e.g. Dentist, Physician, MedicalClinic).
  const LOCAL = new Set(('LocalBusiness AnimalShelter ArchiveOrganization AutomotiveBusiness AutoBodyShop AutoDealer ' +
    'AutoPartsStore AutoRental AutoRepair AutoWash GasStation MotorcycleDealer MotorcycleRepair ChildCare Dentist ' +
    'DryCleaningOrLaundry EmergencyService FireStation Hospital PoliceStation EmploymentAgency EntertainmentBusiness ' +
    'AdultEntertainment AmusementPark ArtGallery Casino ComedyClub MovieTheater NightClub FinancialService ' +
    'AccountingService AutomatedTeller BankOrCreditUnion InsuranceAgency FoodEstablishment Bakery BarOrPub Brewery ' +
    'CafeOrCoffeeShop Distillery FastFoodRestaurant IceCreamShop Restaurant Winery GovernmentOffice PostOffice ' +
    'HealthAndBeautyBusiness BeautySalon DaySpa HairSalon HealthClub NailSalon TattooParlor HomeAndConstructionBusiness ' +
    'Electrician GeneralContractor HVACBusiness HousePainter Locksmith MovingCompany Plumber RoofingContractor ' +
    'InternetCafe LegalService Attorney Notary Library LodgingBusiness BedAndBreakfast Campground Hostel Hotel Motel ' +
    'Resort MedicalBusiness CommunityHealth Dermatology DietNutrition Emergency Geriatric Gynecologic MedicalClinic ' +
    'Midwifery Nursing Obstetric Oncologic Optician Optometric Otolaryngologic Pediatric Pharmacy Physician ' +
    'Physiotherapy PlasticSurgery Podiatric PrimaryCare Psychiatric PublicHealth ProfessionalService RadioStation ' +
    'RealEstateAgent RecyclingCenter SelfStorage ShoppingCenter SportsActivityLocation BowlingAlley ExerciseGym ' +
    'GolfCourse PublicSwimmingPool SkiResort SportsClub StadiumOrArena TennisComplex Store BikeStore BookStore ' +
    'ClothingStore ComputerStore ConvenienceStore DepartmentStore ElectronicsStore Florist FurnitureStore GardenStore ' +
    'GroceryStore HardwareStore HobbyShop HomeGoodsStore JewelryStore LiquorStore MensClothingStore MobilePhoneStore ' +
    'MovieRentalStore MusicStore OfficeEquipmentStore OutletStore PawnShop PetStore ShoeStore SportingGoodsStore ' +
    'TireShop ToyStore WholesaleStore TelevisionStation TouristInformationCenter TravelAgency VeterinaryCare ' +
    'DiagnosticLab IndividualPhysician PhysiciansOffice MedicalOrganization').split(' '));
  const GENERIC = new Set(('Organization Corporation WebSite WebPage CollectionPage AboutPage ContactPage ItemPage ' +
    'BreadcrumbList ListItem ImageObject SearchAction ReadAction EntryPoint SiteNavigationElement WPHeader WPFooter ' +
    'WPSideBar Person Article BlogPosting PostalAddress Place Thing CreativeWork').split(' '));

  const nodes = [];
  let jsonLdBlocks = 0;
  let jsonLdParseErrors = 0;
  const walk = (n) => {
    if (Array.isArray(n)) return n.forEach(walk);
    if (!n || typeof n !== 'object') return;
    if (n['@type']) nodes.push(n);
    for (const v of Object.values(n)) if (v && typeof v === 'object') walk(v);
  };
  for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
    jsonLdBlocks++;
    try {
      walk(JSON.parse(s.textContent));
    } catch (e) {
      jsonLdParseErrors++;
    }
  }
  const typesOf = (n) => [].concat(n['@type']).map(typeName);
  const typeCounts = {};
  for (const n of nodes) for (const t of typesOf(n)) typeCounts[t] = (typeCounts[t] || 0) + 1;

  const FIELDS = ['name', 'address', 'telephone', 'url', 'openingHours', 'openingHoursSpecification', 'geo', 'sameAs',
    'aggregateRating', 'review', 'image', 'logo', 'priceRange', 'areaServed', 'hasMap', 'medicalSpecialty',
    'availableService', 'hasOfferCatalog', 'makesOffer', 'founder', 'employee', 'email'];
  const filled = (v) => v != null && v !== '' && !(Array.isArray(v) && v.length === 0);
  const businessEntities = nodes
    .filter((n) => typesOf(n).some((t) => LOCAL.has(t)))
    .map((n) => {
      const present = FIELDS.filter((f) => filled(n[f]));
      const addr = [].concat(n.address || [])[0];
      return {
        types: typesOf(n),
        name: typeof n.name === 'string' ? n.name : null,
        fieldsPresent: present,
        coreMissing: ['name', 'address', 'telephone'].filter((f) => !present.includes(f)),
        addressIsStructured: !!(addr && typeof addr === 'object' && (addr.streetAddress || addr.addressLocality)),
        email: typeof n.email === 'string' ? n.email : null,
      };
    });

  const microdataTypes = [...new Set([...document.querySelectorAll('[itemtype]')]
    .flatMap((el) => el.getAttribute('itemtype').split(/\s+/)).filter(Boolean).map(typeName))];
  const rdfaTypes = [...new Set([...document.querySelectorAll('[typeof]')]
    .flatMap((el) => el.getAttribute('typeof').split(/\s+/)).filter(Boolean).map(typeName))];
  const microdataLocal = [...microdataTypes, ...rdfaTypes].filter((t) => LOCAL.has(t));

  const allTypes = [...new Set([...Object.keys(typeCounts), ...microdataTypes, ...rdfaTypes])];
  const otherUsefulTypes = allTypes.filter((t) => !LOCAL.has(t) && !GENERIC.has(t));
  let verdict = 'none';
  if (businessEntities.length || microdataLocal.length) verdict = 'local-business';
  else if (allTypes.length) verdict = 'generic-only';

  const schema = {
    verdict, // 'local-business' | 'generic-only' | 'none'
    jsonLdBlocks,
    jsonLdParseErrors,
    typeCounts,
    businessEntities,
    microdataTypes,
    rdfaTypes,
    otherUsefulTypes, // e.g. FAQPage, Service, Review, Product, MedicalProcedure
    hasFAQPageSchema: allTypes.includes('FAQPage'),
    hasServiceSchema: allTypes.some((t) => /^(Service|MedicalProcedure|MedicalTherapy|OfferCatalog|Offer)$/.test(t)),
  };

  // ---------- FAQ signals ----------
  const headings = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].map((h) => clean(h.innerText)).filter(Boolean);
  const faqHeadings = headings.filter((h) => /\bfaqs?\b|frequently asked|common questions|questions (and|&) answers/i.test(h));
  const questionEls = [...document.querySelectorAll('h2,h3,h4,h5,h6,summary,button,[role="button"],dt,[class*="accordion" i],[class*="faq" i]')]
    .map((el) => clean(el.innerText)).filter((t) => t.length > 12 && t.length < 200 && /\?$/.test(t));
  const questions = [...new Set(questionEls)];
  const questionLines = [...new Set((document.body.innerText || '').split('\n').map(clean)
    .filter((t) => t.length > 14 && t.length < 200 && /\?$/.test(t)))];

  // ---------- Links ----------
  const host = location.hostname.replace(/^www\./, '');
  const internal = new Map();
  const external = [];
  for (const a of document.querySelectorAll('a[href]')) {
    let u;
    try {
      u = new URL(a.href, location.href);
    } catch (e) {
      continue;
    }
    if (!/^https?:$/.test(u.protocol)) continue;
    const text = clean(a.innerText || a.getAttribute('aria-label') || a.title).slice(0, 70);
    if (u.hostname.replace(/^www\./, '') === host) {
      const path = u.pathname.replace(/\/+$/, '') || '/';
      if (!internal.has(path)) internal.set(path, text);
      else if (!internal.get(path) && text) internal.set(path, text);
    } else {
      external.push({ text, host: u.hostname.replace(/^www\./, ''), a });
    }
  }
  const internalLinks = [...internal.entries()].map(([path, text]) => ({ path, text }));
  const pick = (re) => internalLinks.filter((l) => re.test(l.path) || re.test(l.text));
  const links = {
    internalCount: internalLinks.length,
    internal: internalLinks.slice(0, 150),
    faqLinks: pick(/\bfaqs?\b|frequently-asked|questions/i),
    contactAboutLinks: pick(/contact|about|team|staff|meet|doctor|owner|our-story|who-we-are/i).slice(0, 15),
  };

  // ---------- Service page candidates ----------
  // Links that sit under a "Services" menu item or heading, plus children of a /services hub URL.
  const NOT_SERVICE = /^(home|about|contact|blog|news|our team|team|staff|reviews?|testimonials?|gallery|smile gallery|insurance|payments?|financing|forms?|patient forms|privacy|terms|faqs?|careers?|jobs|locations?|appointments?|schedule|book|request|new patients?|sitemap|accessibility|log ?in|cart|shop|events?|meet|our story|specials?|offers?|coupons?|service areas?|areas? we serve|resources|videos?|hipaa|get directions|directions|call|free quote|get a quote|estimate|learn more|read more|view all|see all|all services|our services|services)\b/i;
  const LABEL = /^(our |all |view |dental |legal |medical |home |residential |commercial |popular |featured )?(services?|treatments?|procedures?|practice areas?|what we do|specialties|solutions|areas of practice)( menu| offered| we offer| we provide)?:?$/i;
  const herePath = location.pathname.replace(/\/+$/, '') || '/';
  const svc = new Map();
  const addSvc = (a) => {
    let u;
    try {
      u = new URL(a.href, location.href);
    } catch (e) {
      return false;
    }
    if (!/^https?:$/.test(u.protocol) || u.hostname.replace(/^www\./, '') !== host) return false;
    const path = u.pathname.replace(/\/+$/, '') || '/';
    const text = clean(a.innerText || a.getAttribute('aria-label') || a.title).slice(0, 70);
    if (path === '/' || path === herePath || !text || NOT_SERVICE.test(text)) return false;
    if (/\.(pdf|jpe?g|png|webp)$/i.test(path)) return false;
    if (!svc.has(path)) svc.set(path, text);
    return true;
  };
  const qualifying = (box) => [...box.querySelectorAll('a[href]')].filter((a) => {
    try {
      const u = new URL(a.href, location.href);
      const t = clean(a.innerText);
      const p = u.pathname.replace(/\/+$/, '') || '/';
      return u.hostname.replace(/^www\./, '') === host && p !== '/' && p !== herePath && t && !NOT_SERVICE.test(t);
    } catch (e) {
      return false;
    }
  });
  for (const el of document.querySelectorAll('a,button,span,h2,h3,h4,h5,h6,p,strong,div')) {
    if (el.children.length > 2) continue;
    const label = clean(el.innerText);
    if (label.length > 40 || !LABEL.test(label)) continue;
    const boxes = [el.closest('li'), el.parentElement, el.parentElement && el.parentElement.parentElement];
    for (const box of boxes) {
      if (!box || box.matches('body,main,header,footer,nav,html')) continue;
      const all = box.querySelectorAll('a[href]').length;
      const q = qualifying(box);
      if (q.length >= 3 && all <= 45) {
        q.forEach(addSvc);
        break;
      }
    }
  }
  const hubLink = internalLinks.find((l) => /^\/(our-)?(services?|treatments?|procedures?|practice-areas?|what-we-do)$/i.test(l.path));
  const serviceHub = hubLink ? hubLink.path : null;
  const hubBase = serviceHub || (/^\/(our-)?(services?|treatments?|procedures?|practice-areas?)$/i.test(herePath) ? herePath : null);
  if (hubBase) {
    for (const a of document.querySelectorAll('a[href]')) {
      try {
        const p = new URL(a.href, location.href).pathname;
        if (p.startsWith(hubBase + '/') && p.replace(/\/+$/, '').length > hubBase.length + 1) addSvc(a);
      } catch (e) {}
    }
  }
  const serviceLinks = [...svc.entries()].map(([path, text]) => ({ path, text })).slice(0, 60);

  // ---------- Footer / agency credit ----------
  const footerEl = document.querySelector('footer, [role="contentinfo"], #footer, .footer, .site-footer');
  const bodyText = document.body.innerText || '';
  const footerText = clean(footerEl ? footerEl.innerText : bodyText.slice(-900));
  const tail = clean(bodyText.slice(-700));
  const creditRe = /((web\s?site|site|web|design(ed)?|develop(ed|ment)?|built|buil[dt]|powered|created|crafted|managed|hosted|marketing|seo|made)\s*(&|and|\+)?\s*\w*\s*(by|:)\s+[^|©•\n]{2,60})/gi;
  const creditMatches = [...new Set(((footerText + ' || ' + tail).match(creditRe) || []).map(clean))].slice(0, 6);
  const SOCIAL = /facebook|instagram|twitter|x\.com|linkedin|youtube|tiktok|yelp|google\.|goo\.gl|pinterest|healthgrades|bbb\.org|apple\.com|nextdoor|g\.page|maps\.app/i;
  const footerExternalLinks = external
    .filter((l) => (footerEl ? footerEl.contains(l.a) : false) && !SOCIAL.test(l.host))
    .map((l) => ({ text: l.text, host: l.host }));
  const html = document.documentElement.outerHTML;
  const generator = [...document.querySelectorAll('meta[name="generator"]')].map((m) => m.content);
  const platformHints = [
    [/wp-content|wp-includes/i, 'WordPress'], [/static\.wixstatic|wix\.com/i, 'Wix'],
    [/squarespace/i, 'Squarespace'], [/webflow/i, 'Webflow'], [/godaddy|wsimg\.com/i, 'GoDaddy builder'],
    [/duda|dudaone|multiscreensite/i, 'Duda'], [/cdn\.shopify/i, 'Shopify'], [/weebly/i, 'Weebly'],
    [/hubspot/i, 'HubSpot'], [/elementor/i, 'Elementor'], [/et_pb_|themes\/Divi/, 'Divi'],
  ].filter(([re]) => re.test(html)).map(([, n]) => n);
  const footer = {
    footerFound: !!footerEl,
    footerText: footerText.slice(-600),
    creditMatches,
    footerExternalLinks: footerExternalLinks.slice(0, 12),
    generator,
    platformHints,
  };

  // ---------- Emails ----------
  const emails = new Set();
  const addEmail = (e) => {
    e = (e || '').trim().toLowerCase().replace(/^mailto:/, '').split('?')[0];
    if (!/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(e)) return;
    if (/\.(png|jpe?g|gif|webp|svg|css|js)$/.test(e)) return;
    if (/sentry|wixpress|example\.|domain\.com|yourname|email\.com$|@2x/.test(e)) return;
    emails.add(e);
  };
  for (const a of document.querySelectorAll('a[href^="mailto:" i]')) addEmail(decodeURIComponent(a.getAttribute('href')));
  for (const el of document.querySelectorAll('[data-cfemail]')) {
    const hex = el.getAttribute('data-cfemail');
    const key = parseInt(hex.slice(0, 2), 16);
    let out = '';
    for (let i = 2; i < hex.length; i += 2) out += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16) ^ key);
    addEmail(out);
  }
  for (const m of bodyText.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) || []) addEmail(m);
  for (const b of businessEntities) if (b.email) addEmail(b.email);
  const GENERIC_BOX = /^(info|contact|office|hello|admin|support|frontdesk|front\.desk|appointments?|scheduling|reception|mail|team|care|smile|smiles|billing|sales|service|help|enquir\w*|inquir\w*|bids?|estimates?|quotes?|dispatch|jobs|careers|hr|marketing|web|no-?reply|customerservice|schedule|booking|hi)\b/;
  const emailList = [...emails].map((e) => ({
    email: e,
    sameDomain: e.split('@')[1].replace(/^www\./, '') === host,
    mailbox: GENERIC_BOX.test(e.split('@')[0]) ? 'generic' : 'personal-looking',
  }));

  // ---------- People (owner or lead practitioner), for a personal greeting ----------
  const people = new Map();
  const NAME = "[A-Z][a-z]+(?:\\s+[A-Z]\\.)?\\s+[A-Z][A-Za-z'\\-]+";
  const NOT_NAME = /\b(Dental|Dentistry|Care|Team|Family|Clinic|Center|Group|Services?|Office|Smiles?|Plumbing|Law|Associates|Our|Meet|The|And|Read|More|Learn|Contact|Book|Schedule|Your|About|Welcome|Call|Today|Now|Request|New|Patients?|Reviews?|Street|Avenue|Suite|Road|Blvd|Family|Home|Heating|Cooling|Roofing|Electric|Company|Inc|LLC)\b/;
  const addPerson = (raw, source, weight) => {
    const name = clean(raw).replace(/^Dr\.?\s+/i, '').replace(/[,.;:]+$/, '');
    if (!name || name.length > 40 || NOT_NAME.test(name)) return;
    const key = name.toLowerCase();
    const p = people.get(key) || { name, doctor: false, owner: false, score: 0 };
    if (source === 'doctor') p.doctor = true;
    if (source === 'owner') p.owner = true;
    p.score += weight;
    people.set(key, p);
  };
  for (const n of nodes) {
    for (const f of ['founder', 'founders', 'owner']) {
      for (const v of [].concat(n[f] || [])) {
        const nm = typeof v === 'string' ? v : v && v.name;
        if (typeof nm === 'string' && /\s/.test(nm)) addPerson(nm, 'owner', 5);
      }
    }
    if (typesOf(n).some((t) => /^(Person|Physician|IndividualPhysician)$/.test(t)) && typeof n.name === 'string' && /\s/.test(n.name)) {
      addPerson(n.name, /^Dr\b/i.test(n.name) ? 'doctor' : 'schema', 2);
    }
  }
  const flat = bodyText.replace(/\s+/g, ' ');
  const each = (pattern, fn) => {
    for (const m of flat.matchAll(new RegExp(pattern, 'g'))) fn(m);
  };
  each('\\bDr\\.?\\s+(' + NAME + ')', (m) => addPerson(m[1], 'doctor', 1));
  each('\\b(' + NAME + '),?\\s+(?:DDS|DMD|D\\.D\\.S\\.|D\\.M\\.D\\.|DC|D\\.C\\.|MD|M\\.D\\.|DVM|OD|DPM)\\b', (m) => addPerson(m[1], 'doctor', 2));
  each('\\b(?:[Oo]wner|[Ff]ounder|[Oo]wned (?:and operated )?by|[Ff]ounded by|[Pp]resident|CEO)[:,]?\\s+(' + NAME + ')', (m) => addPerson(m[1], 'owner', 4));
  each('\\b(' + NAME + '),?\\s+(?:[Oo]wner|[Ff]ounder|[Pp]resident|CEO|Managing Partner|Principal)\\b', (m) => addPerson(m[1], 'owner', 4));
  const peopleList = [...people.values()].sort((a, b) => b.score - a.score).slice(0, 8);

  // ---------- Phone numbers: tap-to-call links and US-style numbers in the text ----------
  const phones = [];
  const addPhone = (raw, display, source) => {
    const digits = String(raw || '').replace(/\D/g, '');
    if (digits.length < 9 || digits.length > 13) return;
    const same = phones.find((p) => p.digits.slice(-9) === digits.slice(-9));
    if (same) {
      same.count++;
      if (source === 'tel') same.tel = true;
      return;
    }
    phones.push({ digits, display: clean(display || raw).slice(0, 30), tel: source === 'tel', count: 1 });
  };
  for (const a of document.querySelectorAll('a[href^="tel:" i]')) {
    const href = decodeURIComponent(a.getAttribute('href') || '').replace(/^tel:/i, '');
    const text = clean(a.innerText || '');
    addPhone(href, /\d{3}.*\d{4}/.test(text) ? text.match(/[+(\d][\d\s().+-]{8,}\d/)?.[0] || href : href, 'tel');
  }
  for (const m of flat.matchAll(/(?:\+?1[\s.-]?)?\(?\b[2-9]\d{2}\)?[\s.-]?[2-9]\d{2}[\s.-]?\d{4}\b/g)) addPhone(m[0], m[0], 'text');

  const wordTotal = bodyText.split(/\s+/).length;
  const blocked = wordTotal < 150 &&
    /just a moment|checking your browser|verify you are human|access denied|attention required|captcha|are you a robot|403 forbidden/i
      .test(document.title + ' ' + bodyText);

  return {
    blocked, // true = bot check / access wall. Nothing below is meaningful; do not score this site.
    url: location.href,
    title: document.title,
    h1: headings[0] || null,
    wordCount: bodyText.split(/\s+/).length,
    schema,
    faq: { hasFAQPageSchema: schema.hasFAQPageSchema, faqHeadings, questionCount: questions.length, questionLines: questionLines.length, sampleQuestions: questions.slice(0, 5), faqLinks: links.faqLinks },
    links,
    serviceLinks,
    serviceHub,
    footer,
    emails: emailList,
    people: peopleList,
    phones: phones.slice(0, 8),
    hasContactForm: !!document.querySelector('form textarea, form input[type="email"]'),
  };
},

mobileCheck: async () => {
  // Run on the homepage while the browser imitates a phone (390 px wide). A page built for phones keeps
  // a 390 px layout; a desktop-only page makes the phone zoom out, so the layout is wider and text is tiny.
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  await sleep(700);
  const SCREEN = 390;
  const vpTag = document.querySelector('meta[name="viewport" i]');
  const viewport = vpTag ? (vpTag.getAttribute('content') || '') : '';
  const layoutWidth = Math.max(window.innerWidth, document.documentElement.scrollWidth, document.body ? document.body.scrollWidth : 0);
  const zoom = Math.min(1, SCREEN / Math.max(layoutWidth, 1)); // how far the phone has to shrink the page
  let chars = 0;
  let smallChars = 0;
  if (document.body) {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node;
    let seen = 0;
    while ((node = walker.nextNode()) && seen < 5000) {
      seen++;
      const t = node.textContent.replace(/\s+/g, ' ').trim();
      if (t.length < 15) continue;
      const el = node.parentElement;
      if (!el) continue;
      const box = el.getBoundingClientRect();
      if (!box.width || !box.height) continue;
      const st = getComputedStyle(el);
      if (st.visibility === 'hidden' || st.display === 'none') continue;
      chars += t.length;
      if (parseFloat(st.fontSize) * zoom < 12) smallChars += t.length;
    }
  }
  // Call buttons come in several forms: a tel: link, a callto: link, or a button that opens tel: by script.
  const telLinks = [...document.querySelectorAll('a[href*="tel:" i], a[href^="callto:" i], [onclick*="tel:" i], [data-href^="tel:" i]')];
  const visible = telLinks.filter((a) => {
    const b = a.getBoundingClientRect();
    const st = getComputedStyle(a);
    return b.width > 0 && b.height > 0 && st.visibility !== 'hidden' && st.display !== 'none';
  });
  const pinned = (a) => {
    for (let e = a; e && e !== document.body; e = e.parentElement) {
      const p = getComputedStyle(e).position;
      if (p === 'fixed' || p === 'sticky') return true;
    }
    return false;
  };
  const nearTop = visible.some((a) => a.getBoundingClientRect().top + window.scrollY < window.innerHeight || pinned(a));
  return {
    url: location.href,
    viewport: viewport.slice(0, 120),
    hasViewport: /width\s*=\s*device-width|initial-scale\s*=\s*1/i.test(viewport),
    layoutWidth,
    smallShare: chars ? Math.round((smallChars / chars) * 100) / 100 : 0,
    textChars: chars,
    telTotal: telLinks.length,
    telVisible: visible.length,
    telNearTop: nearTop,
  };
},
};
