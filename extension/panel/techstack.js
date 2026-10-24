// Tech-stack detection that runs entirely on this device: no AI, no tokens.
// Fingerprints are Lumen's own (not Wappalyzer's GPL database). Each one can match on
//   global: paths of page globals ("jQuery.fn.jquery"); the first set one = present,
//           and if it's a string or number, that's the version
//   dom:    a CSS selector that must match; domAttr: [selector, attribute] gives a version
//   script: a regex over <script src> URLs
//   html:   a regex over the start of the page's HTML
//   meta:   a regex over <meta name="generator">
//   header: { name: regex } over the page's HTTP response headers
//   cookie: a regex over cookie names

export const FINGERPRINTS = [
  // JavaScript frameworks
  { name: "React", url: "https://react.dev", cat: "JavaScript frameworks", global: ["React.version"], dom: "[data-reactroot]", react: true },
  { name: "Next.js", url: "https://nextjs.org", cat: "JavaScript frameworks", global: ["next.version", "__NEXT_DATA__"], script: /\/_next\/static\// },
  { name: "Vue.js", url: "https://vuejs.org", cat: "JavaScript frameworks", global: ["Vue.version", "__VUE__"], dom: "[data-v-app]" },
  { name: "Nuxt", url: "https://nuxt.com", cat: "JavaScript frameworks", global: ["__NUXT__", "$nuxt"], script: /\/_nuxt\// },
  { name: "Angular", url: "https://angular.dev", cat: "JavaScript frameworks", domAttr: ["[ng-version]", "ng-version"], global: ["ng"] },
  { name: "AngularJS", url: "https://angularjs.org", cat: "JavaScript frameworks", global: ["angular.version.full"] },
  { name: "Svelte", url: "https://svelte.dev", cat: "JavaScript frameworks", html: /class="[^"]*svelte-[a-z0-9]{6}/ },
  { name: "SvelteKit", url: "https://svelte.dev/docs/kit", cat: "JavaScript frameworks", global: ["__sveltekit_dev"], script: /\/_app\/immutable\//, html: /__sveltekit_/ },
  { name: "Solid", url: "https://www.solidjs.com", cat: "JavaScript frameworks", global: ["_$HY"] },
  { name: "Preact", url: "https://preactjs.com", cat: "JavaScript frameworks", global: ["preact"] },
  { name: "Ember.js", url: "https://emberjs.com", cat: "JavaScript frameworks", global: ["Ember.VERSION"] },
  { name: "Polymer", url: "https://polymer-library.polymer-project.org", cat: "JavaScript frameworks", global: ["Polymer.version", "Polymer"] },
  { name: "Lit", url: "https://lit.dev", cat: "JavaScript frameworks", global: ["litElementVersions.0", "litHtmlVersions.0"] },
  { name: "Alpine.js", url: "https://alpinejs.dev", cat: "JavaScript frameworks", global: ["Alpine.version"], dom: "[x-data]" },
  { name: "Qwik", url: "https://qwik.dev", cat: "JavaScript frameworks", html: /q:container=/ },
  { name: "Astro", url: "https://astro.build", cat: "JavaScript frameworks", html: /<astro-island|data-astro-cid/, meta: /^Astro/ },
  { name: "Remix", url: "https://remix.run", cat: "JavaScript frameworks", global: ["__remixContext"] },
  { name: "Gatsby", url: "https://www.gatsbyjs.com", cat: "JavaScript frameworks", dom: "#___gatsby" },
  { name: "htmx", url: "https://htmx.org", cat: "JavaScript frameworks", global: ["htmx.version"] },

  // JavaScript libraries
  { name: "jQuery", url: "https://jquery.com", cat: "JavaScript libraries", global: ["jQuery.fn.jquery"] },
  { name: "Lodash", url: "https://lodash.com", cat: "JavaScript libraries", global: ["_.VERSION"] },
  { name: "Moment.js", url: "https://momentjs.com", cat: "JavaScript libraries", global: ["moment.version"] },
  { name: "D3", url: "https://d3js.org", cat: "JavaScript libraries", global: ["d3.version"] },
  { name: "Three.js", url: "https://threejs.org", cat: "JavaScript libraries", global: ["THREE.REVISION"] },
  { name: "GSAP", url: "https://gsap.com", cat: "JavaScript libraries", global: ["gsap.version", "TweenMax.version"] },
  { name: "anime.js", url: "https://animejs.com", cat: "JavaScript libraries", global: ["anime.version"] },
  { name: "Lottie", url: "https://airbnb.io/lottie", cat: "JavaScript libraries", global: ["lottie", "bodymovin"], dom: "lottie-player, dotlottie-player" },
  { name: "Hammer.js", url: "https://hammerjs.github.io", cat: "JavaScript libraries", global: ["Hammer.VERSION"] },
  { name: "XRegExp", url: "https://xregexp.com", cat: "JavaScript libraries", global: ["XRegExp.version"] },
  { name: "Swiper", url: "https://swiperjs.com", cat: "JavaScript libraries", global: ["Swiper"], html: /class="[^"]*swiper-wrapper/ },

  // UI / CSS
  { name: "Bootstrap", url: "https://getbootstrap.com", cat: "UI frameworks", global: ["bootstrap.Tooltip.VERSION", "jQuery.fn.tooltip.Constructor.VERSION"], html: /bootstrap(\.min)?\.css/ },
  { name: "Tailwind CSS", url: "https://tailwindcss.com", cat: "UI frameworks", html: /class="[^"]*\b(?:flex|grid) [^"]*\b(?:px|py|mt|mb|gap)-\d[^"]*\b(?:text|bg)-(?:gray|slate|zinc|neutral|white|black)/ },
  { name: "Material UI", url: "https://mui.com", cat: "UI frameworks", html: /class="[^"]*\bMui[A-Z]/ },
  { name: "Font Awesome", url: "https://fontawesome.com", cat: "Font scripts", html: /font-?awesome|class="[^"]*\bfa[srlb]? fa-/ },
  { name: "Google Fonts", url: "https://fonts.google.com", cat: "Font scripts", dom: 'link[href*="fonts.googleapis.com"], link[href*="fonts.gstatic.com"]', html: /fonts\.googleapis\.com|fonts\.gstatic\.com/ },
  { name: "Adobe Fonts", url: "https://fonts.adobe.com", cat: "Font scripts", dom: 'link[href*="use.typekit.net"]', html: /use\.typekit\.net/ },

  // CMS & site builders
  { name: "WordPress", url: "https://wordpress.org", cat: "CMS", meta: /^WordPress\s*([\d.]+)?/, dom: 'link[href*="/wp-content/"], script[src*="/wp-includes/"], link[rel="https://api.w.org/"]', html: /\/wp-content\/|\/wp-includes\// },
  { name: "WooCommerce", url: "https://woocommerce.com", cat: "Ecommerce", html: /woocommerce/i },
  { name: "Drupal", url: "https://www.drupal.org", cat: "CMS", meta: /^Drupal\s*([\d.]+)?/, global: ["Drupal"] },
  { name: "Joomla", url: "https://www.joomla.org", cat: "CMS", meta: /^Joomla/ },
  { name: "Ghost", url: "https://ghost.org", cat: "CMS", meta: /^Ghost\s*([\d.]+)?/ },
  { name: "Wix", url: "https://www.wix.com", cat: "Site builders", html: /static\.wixstatic\.com|wix-warmup-data/ },
  { name: "Squarespace", url: "https://www.squarespace.com", cat: "Site builders", global: ["Squarespace"], html: /static1\.squarespace\.com/ },
  { name: "Webflow", url: "https://webflow.com", cat: "Site builders", html: /data-wf-site=/, meta: /^Webflow/ },
  { name: "Framer", url: "https://www.framer.com", cat: "Site builders", html: /framerusercontent\.com|data-framer-/ },
  { name: "Shopify", url: "https://www.shopify.com", cat: "Ecommerce", global: ["Shopify.shop"], html: /cdn\.shopify\.com/ },
  { name: "Magento", url: "https://business.adobe.com/products/magento/magento-commerce.html", cat: "Ecommerce", global: ["Mage"], html: /Magento_|mage\/cookies/ },
  { name: "BigCommerce", url: "https://www.bigcommerce.com", cat: "Ecommerce", html: /cdn\d*\.bigcommerce\.com/ },
  { name: "HubSpot", url: "https://www.hubspot.com", cat: "Marketing", script: /js\.hs-scripts\.com|js\.hsforms\.net|js\.hs-analytics\.net/ },

  // Analytics & ads
  { name: "Google Analytics", url: "https://marketingplatform.google.com/about/analytics/", cat: "Analytics", global: ["gtag", "ga", "GoogleAnalyticsObject"], script: /google-analytics\.com\/(analytics|ga)\.js|googletagmanager\.com\/gtag\/js/ },
  { name: "Google Tag Manager", url: "https://tagmanager.google.com", cat: "Tag managers", global: ["google_tag_manager"], script: /googletagmanager\.com\/gtm\.js/ },
  { name: "Meta Pixel", url: "https://www.facebook.com/business/tools/meta-pixel", cat: "Analytics", global: ["fbq"], script: /connect\.facebook\.net\/.*fbevents/ },
  { name: "Hotjar", url: "https://www.hotjar.com", cat: "Analytics", global: ["hj"], script: /static\.hotjar\.com/ },
  { name: "Microsoft Clarity", url: "https://clarity.microsoft.com", cat: "Analytics", global: ["clarity"], script: /clarity\.ms\/tag/ },
  { name: "Mixpanel", url: "https://mixpanel.com", cat: "Analytics", global: ["mixpanel.__loaded"], script: /cdn\.mxpnl\.com/ },
  { name: "Segment", url: "https://segment.com", cat: "Analytics", global: ["analytics.Integrations"], script: /cdn\.segment\.com/ },
  { name: "Amplitude", url: "https://amplitude.com", cat: "Analytics", global: ["amplitude"], script: /cdn\.amplitude\.com/ },
  { name: "PostHog", url: "https://posthog.com", cat: "Analytics", global: ["posthog.__loaded"] },
  { name: "Plausible", url: "https://plausible.io", cat: "Analytics", script: /plausible\.io\/js/ },
  { name: "TikTok Pixel", url: "https://ads.tiktok.com", cat: "Analytics", global: ["ttq"] },
  { name: "LinkedIn Insight", url: "https://business.linkedin.com/marketing-solutions/insight-tag", cat: "Analytics", global: ["_linkedin_partner_id"], script: /snap\.licdn\.com/ },
  { name: "DoubleClick", url: "https://marketingplatform.google.com", cat: "Advertising", script: /doubleclick\.net|googlesyndication\.com|googleadservices\.com/ },
  { name: "Google AdSense", url: "https://adsense.google.com", cat: "Advertising", global: ["adsbygoogle"] },

  // Hosting, CDN, servers (mostly from response headers)
  { name: "Cloudflare", url: "https://www.cloudflare.com", cat: "CDN", header: { "cf-ray": /./, server: /cloudflare/i } },
  { name: "Vercel", url: "https://vercel.com", cat: "Hosting", header: { "x-vercel-id": /./, server: /vercel/i } },
  { name: "Netlify", url: "https://www.netlify.com", cat: "Hosting", header: { "x-nf-request-id": /./, server: /netlify/i } },
  { name: "Amazon CloudFront", url: "https://aws.amazon.com/cloudfront/", cat: "CDN", header: { "x-amz-cf-id": /./, via: /cloudfront/i } },
  { name: "Fastly", url: "https://www.fastly.com", cat: "CDN", header: { "x-served-by": /cache-/, "x-fastly-request-id": /./ } },
  { name: "Akamai", url: "https://www.akamai.com", cat: "CDN", header: { "x-akamai-transformed": /./, server: /akamai/i } },
  { name: "GitHub Pages", url: "https://pages.github.com", cat: "Hosting", header: { "x-github-request-id": /./, server: /github\.com/i } },
  { name: "Fly.io", url: "https://fly.io", cat: "Hosting", header: { "fly-request-id": /./, server: /fly\/?/i } },
  { name: "Google Cloud", url: "https://cloud.google.com", cat: "Hosting", header: { via: /1\.1 google/i, server: /^(gws|gfe|ESF)/i } },
  { name: "Nginx", url: "https://nginx.org", cat: "Web servers", header: { server: /nginx\/?([\d.]+)?/i } },
  { name: "Apache", url: "https://httpd.apache.org", cat: "Web servers", header: { server: /apache\/?([\d.]+)?/i } },
  { name: "Microsoft IIS", url: "https://www.iis.net", cat: "Web servers", header: { server: /iis\/?([\d.]+)?/i } },
  { name: "Envoy", url: "https://www.envoyproxy.io", cat: "Web servers", header: { server: /envoy/i } },
  { name: "PHP", url: "https://www.php.net", cat: "Languages", header: { "x-powered-by": /php\/?([\d.]+)?/i }, cookie: /^PHPSESSID$/ },
  { name: "Express", url: "https://expressjs.com", cat: "Web frameworks", header: { "x-powered-by": /express/i } },
  { name: "ASP.NET", url: "https://dotnet.microsoft.com/apps/aspnet", cat: "Web frameworks", header: { "x-powered-by": /asp\.net/i, "x-aspnet-version": /./ } },
  { name: "Ruby on Rails", url: "https://rubyonrails.org", cat: "Web frameworks", meta: /csrf-param/, header: { "x-runtime": /^[\d.]+$/ } },

  // Payments, auth, support, security, media
  { name: "Stripe", url: "https://stripe.com", cat: "Payments", global: ["Stripe"], script: /js\.stripe\.com/ },
  { name: "PayPal", url: "https://www.paypal.com", cat: "Payments", script: /paypal\.com\/sdk\/js|paypalobjects\.com/ },
  { name: "Firebase", url: "https://firebase.google.com", cat: "Backend", global: ["firebase.SDK_VERSION", "firebase"], script: /firebase(app)?[-.]/ },
  { name: "Supabase", url: "https://supabase.com", cat: "Backend", script: /supabase/ },
  { name: "Auth0", url: "https://auth0.com", cat: "Authentication", script: /cdn\.auth0\.com/ },
  { name: "Clerk", url: "https://clerk.com", cat: "Authentication", global: ["Clerk"] },
  { name: "Intercom", url: "https://www.intercom.com", cat: "Live chat", global: ["Intercom"] },
  { name: "Zendesk", url: "https://www.zendesk.com", cat: "Live chat", global: ["zE"], script: /static\.zdassets\.com/ },
  { name: "Crisp", url: "https://crisp.chat", cat: "Live chat", global: ["$crisp"] },
  { name: "Sentry", url: "https://sentry.io", cat: "Monitoring", global: ["Sentry.SDK_VERSION", "__SENTRY__"] },
  { name: "reCAPTCHA", url: "https://www.google.com/recaptcha", cat: "Security", global: ["grecaptcha"], script: /recaptcha/ },
  { name: "hCaptcha", url: "https://www.hcaptcha.com", cat: "Security", global: ["hcaptcha"] },
  { name: "Cloudflare Turnstile", url: "https://www.cloudflare.com/products/turnstile/", cat: "Security", global: ["turnstile"], script: /challenges\.cloudflare\.com\/turnstile/ },
  { name: "Algolia", url: "https://www.algolia.com", cat: "Search", global: ["algoliasearch"] },
  { name: "YouTube", url: "https://www.youtube.com", cat: "Video players", dom: 'ytd-app, iframe[src*="youtube.com/embed"], iframe[src*="youtube-nocookie.com/embed"]' },
  { name: "Vimeo", url: "https://vimeo.com", cat: "Video players", dom: 'iframe[src*="player.vimeo.com"]' },
  { name: "PWA", url: "https://web.dev/explore/progressive-web-apps", cat: "Miscellaneous", dom: 'link[rel="manifest"]' },
  { name: "Open Graph", url: "https://ogp.me", cat: "Miscellaneous", dom: 'meta[property^="og:"]' },
  { name: "Priority Hints", url: "https://web.dev/articles/fetch-priority", cat: "Performance", dom: "[fetchpriority]" },
];

// Runs in the page (main world, so page globals are visible). No eval: many sites'
// CSPs forbid it, so checks are plain property paths and selectors.
export function collect(checks) {
  const get = (path) => {
    let v = window;
    for (const k of path.split(".")) {
      if (v == null) return undefined;
      try {
        v = v[k];
      } catch {
        return undefined;
      }
    }
    return v;
  };
  const hits = {};
  for (const c of checks) {
    let v;
    for (const path of c.global || []) {
      const x = get(path);
      if (x) {
        v = typeof x === "string" || typeof x === "number" ? String(x) : true;
        break;
      }
    }
    if (!v && c.domAttr) v = document.querySelector(c.domAttr[0])?.getAttribute(c.domAttr[1]) || undefined;
    if (!v && c.dom && document.querySelector(c.dom)) v = true;
    // React leaves __reactFiber$… / __reactContainer$… keys on DOM nodes.
    if (!v && c.react) {
      const nodes = [document.getElementById("root"), document.getElementById("__next"), ...document.querySelectorAll("body > *")].filter(Boolean);
      if (nodes.some((n) => Object.keys(n).some((k) => k.startsWith("__react")))) v = true;
    }
    if (v) hits[c.name] = v;
  }
  return {
    js: hits,
    scripts: [...document.scripts].map((s) => s.src).filter(Boolean).slice(0, 400),
    // Inline scripts can be megabytes (YouTube's are): drop their contents before sampling.
    html: document.documentElement.outerHTML.replace(/(<script\b[^>]*>)[\s\S]*?<\/script>/gi, "$1</script>").slice(0, 400000),
    generator: document.querySelector('meta[name="generator"]')?.content || "",
    metaNames: [...document.querySelectorAll("meta[name]")].map((m) => m.name).join(" "),
    cookies: document.cookie.split(";").map((c) => c.split("=")[0].trim()).filter(Boolean),
  };
}

async function headersOf(url) {
  try {
    const res = await fetch(url, { method: "HEAD", credentials: "include" });
    return Object.fromEntries([...res.headers].map(([k, v]) => [k.toLowerCase(), v]));
  } catch {
    return {};
  }
}

const versionFrom = (m) => (m && m[1] && /\d/.test(m[1]) ? m[1] : "");

export const checksFor = () =>
  FINGERPRINTS.filter((f) => f.global || f.dom || f.domAttr || f.react).map(({ name, global, dom, domAttr, react }) => ({ name, global, dom, domAttr, react }));

// Returns { url, found: [{ name, cat, version }] } for a tab.
export async function detect(tab) {
  const checks = checksFor();
  let page = { js: {}, scripts: [], html: "", generator: "", metaNames: "", cookies: [] };
  try {
    const frames = await chrome.scripting.executeScript({ target: { tabId: tab.id }, world: "MAIN", func: collect, args: [checks] });
    page = frames[0]?.result || page;
  } catch {
    throw new Error("This page can't be read by extensions.");
  }
  const headers = /^https?:/.test(tab.url) ? await headersOf(tab.url) : {};
  return { url: tab.url, title: tab.title, found: match(page, headers) };
}

// Turns what collect() saw (plus response headers) into detected technologies.
export function match(page, headers = {}) {
  const found = [];
  for (const f of FINGERPRINTS) {
    let hit = false;
    let version = "";
    const jsVal = page.js[f.name];
    if (jsVal) {
      hit = true;
      if (typeof jsVal === "string") version = jsVal;
    }
    if (!hit && f.script) hit = page.scripts.some((s) => f.script.test(s));
    if (!hit && f.html) hit = f.html.test(page.html);
    if (f.meta) {
      const m = page.generator.match(f.meta) || (f.meta.test(page.metaNames) ? [] : null);
      if (m) {
        hit = true;
        version ||= versionFrom(m);
      }
    }
    if (f.header) {
      for (const [name, re] of Object.entries(f.header)) {
        const m = headers[name] && headers[name].match(re);
        if (m) {
          hit = true;
          version ||= versionFrom(m);
        }
      }
    }
    if (!hit && f.cookie) hit = page.cookies.some((c) => f.cookie.test(c));
    if (hit) found.push({ name: f.name, url: f.url, cat: f.cat, version: /^[\w.\-+]{1,20}$/.test(version) ? version : "" });
  }
  return found;
}

// Markdown for the chat, grouped by category.
export function toMarkdown({ url, found }) {
  const host = (() => {
    try {
      return new URL(url).hostname.replace(/^www\./, "");
    } catch {
      return url;
    }
  })();
  if (!found.length) return `**${host}**: no known technologies detected. (Detected on this device, no AI.)`;
  const groups = {};
  for (const f of found) (groups[f.cat] ??= []).push(f);
  const order = Object.keys(groups).sort();
  const lines = [`**Tech stack of ${host}** · ${found.length} found · detected on this device, no AI`, ""];
  for (const cat of order) {
    lines.push(`**${cat}**`);
    for (const f of groups[cat]) lines.push(`- ${f.url ? `[${f.name}](${f.url})` : f.name}${f.version ? ` \`${f.version}\`` : ""}`);
    lines.push("");
  }
  lines.push("*Ask a follow-up and the model sees this list.*");
  return lines.join("\n");
}
