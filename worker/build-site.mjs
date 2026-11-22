// Builds the static product site into ./public (served by the Worker's assets).
import fs from "node:fs";

const cfg = JSON.parse(fs.readFileSync(new URL("./site.config.json", import.meta.url), "utf8"));
const SUPPORT = "hello@elab-studio.com";
const UPDATED = "November 22, 2026";

const header = `<header><div class="wrap"><a class="brand" href="/"><span class="logo">✦</span>Vault Tidy</a><nav><a href="/#features">Features</a><a href="/#pricing">Pricing</a><a href="/support/">Support</a></nav></div></header>`;
const footer = `<footer><div class="wrap"><div>© 2026 E:LAB. Vault Tidy is an independent plugin and is not affiliated with Obsidian.</div><div><a href="/terms/">Terms of Service</a> · <a href="/privacy/">Privacy Policy</a> · <a href="/refund/">Refund Policy</a> · <a href="/support/">Contact</a></div></div></footer>`;

const page = (title, desc, body, extraHead = "") => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title><meta name="description" content="${desc}"><link rel="stylesheet" href="/site.css">
<meta property="og:title" content="${title}"><meta property="og:description" content="${desc}"><meta property="og:image" content="/img/free-tags.png">${extraHead}</head>
<body>${header}${body}${footer}</body></html>`;

const paddleHead = cfg.paddleClientToken
	? `<script src="https://cdn.paddle.com/paddle/v2/paddle.js"></script><script>
${cfg.environment === "sandbox" ? 'Paddle.Environment.set("sandbox");' : ""}
Paddle.Initialize({ token: ${JSON.stringify(cfg.paddleClientToken)}, eventCallback: function (e) {
  if (e.name === "checkout.completed" && e.data && e.data.transaction_id) location.href = "/thanks/?txn=" + encodeURIComponent(e.data.transaction_id);
}});
function buy(priceId){ Paddle.Checkout.open({ items: [{ priceId: priceId, quantity: 1 }], settings: { displayMode: "overlay", theme: "dark" } }); }
</script>`
	: `<script>function buy(){ alert("Checkout opens very soon. Thanks for your interest!"); }</script>`;

const home = page(
	"Vault Tidy: clean up tags and properties in Obsidian",
	"Rename, merge and delete tags, bulk-edit properties and find & replace across your Obsidian vault. Preview every change, undo anything. Optional AI Pro.",
	`<main>
<div class="wrap hero"><h1>Your Obsidian vault,<br>finally tidy.</h1>
<p>Rename, merge and delete tags, bulk-edit properties and find &amp; replace across every note. See a preview of every change before it happens, and undo any batch with one click.</p>
<a class="btn primary" href="https://community.obsidian.md/plugins/vault-tidy">Get it free in Obsidian</a> <a class="btn" href="#pricing">See Pro</a>
<div class="shot"><img src="/img/free-tags.png" alt="Vault Tidy tag manager in Obsidian"></div></div>
<section id="features"><div class="wrap"><h2>Free forever</h2><div class="grid">
<div class="card"><h3>Tag manager</h3><p>Every tag with usage counts. Rename (nested tags follow), merge several into one, or delete. Frontmatter and inline tags, code blocks skipped.</p></div>
<div class="card"><h3>Duplicate finder</h3><p>Spots #Book vs #books, #to-read vs #toread and typos like #produtivity, then merges them in one go.</p></div>
<div class="card"><h3>Properties</h3><p>Rename or delete a property across the vault, replace a value, or set a property on every note in a folder. Your YAML formatting is kept.</p></div>
<div class="card"><h3>Find &amp; replace</h3><p>Plain text or regex with groups, whole word, case and folder scope. Skips code blocks by default.</p></div>
<div class="card"><h3>Preview, then apply</h3><p>A diff of every affected note. Untick anything you want to keep.</p></div>
<div class="card"><h3>One-click undo</h3><p>Every batch is saved locally. Undo it from History, even days later.</p></div>
</div></div></section>
<section id="pricing"><div class="wrap"><h2>Vault Tidy Pro</h2><p style="color:var(--muted);margin-top:-12px">AI that understands what your tags mean. No API key, nothing to set up.</p>
<div class="price">
<div class="card"><div class="tag">Most popular</div><div class="amount">$${cfg.yearlyPrice} <small>/ year</small></div><ul><li>AI synonym and duplicate tag finder</li><li>Auto-tag untagged notes</li><li>Up to 3 devices</li><li>Save ${Math.round((1 - cfg.yearlyPrice / (cfg.monthlyPrice * 12)) * 100)}% vs monthly</li></ul><a class="btn primary" href="#pricing" onclick="event.preventDefault();buy('${cfg.priceYearly || ""}')">Get Pro yearly</a></div>
<div class="card"><div class="amount">$${cfg.monthlyPrice} <small>/ month</small></div><ul><li>Everything in Pro</li><li>Cancel anytime</li><li>Up to 3 devices</li></ul><a class="btn" href="#pricing" onclick="event.preventDefault();buy('${cfg.priceMonthly || ""}')">Get Pro monthly</a></div>
</div>
<p style="color:var(--muted);font-size:14px;margin-top:16px">Prices in USD. Taxes may apply depending on your country. ${cfg.refundDays}-day money-back guarantee. Our order process is conducted by our online reseller Paddle.com, the Merchant of Record for all orders.</p>
<div class="shot" style="max-width:860px;margin-left:0"><img src="/img/pro-ai.png" alt="Vault Tidy Pro AI tools"></div>
</div></section>
<section class="faq"><div class="wrap"><h2>FAQ</h2>
<details><summary>How do I activate Pro?</summary><p>After checkout your license key appears on the confirmation page. You can recover it anytime on the Support page with your email and order ID. In Obsidian open Settings → Vault Tidy → Enter license key.</p></details>
<details><summary>What data is sent to the AI?</summary><p>Only tag names with counts, or the title and first 1,500 characters of the notes you choose to tag. Nothing is stored and nothing is used for training.</p></details>
<details><summary>Can I cancel?</summary><p>Yes, anytime from the link in your receipt email. Pro keeps working until the end of the paid period.</p></details>
<details><summary>Lost your license key?</summary><p><a href="/support/">Recover it here</a> with the email you used at checkout.</p></details>
</div></section></main>`,
	paddleHead,
);

const legal = (title, html) => page(`${title} · Vault Tidy`, `${title} for Vault Tidy`, `<main class="wrap legal"><h1>${title}</h1><p><em>Last updated: ${UPDATED}</em></p>${html}</main>`);

const terms = legal(
	"Terms of Service",
	`<p>These terms govern your use of Vault Tidy, an Obsidian plugin and related services ("the Service") provided by E:LAB, a sole proprietorship registered in the Republic of Korea ("we", "us"). By installing the plugin or purchasing a Pro license you agree to these terms.</p>
<h2>1. The plugin</h2><p>The core plugin is free and open source under the MIT license. It edits files in your Obsidian vault only when you confirm a previewed change. You are responsible for keeping backups of your notes.</p>
<h2>2. Pro licenses</h2><p>Vault Tidy Pro is a subscription billed monthly or yearly. A license may be activated on up to 3 devices for personal use and may not be shared or resold. AI features are subject to a fair-use daily limit.</p>
<h2>3. Payments</h2><p>Our order process is conducted by our online reseller Paddle.com. Paddle.com is the Merchant of Record for all our orders. Paddle provides all customer service inquiries related to payment and handles returns. Subscriptions renew automatically until cancelled; you can cancel anytime and keep access until the end of the paid period.</p>
<h2>4. Refunds</h2><p>See our <a href="/refund/">Refund Policy</a>.</p>
<h2>5. Acceptable use</h2><p>Do not attempt to bypass licensing, overload or reverse engineer the AI service, or use the Service for unlawful purposes.</p>
<h2>6. Availability and changes</h2><p>We aim to keep the AI service available but do not guarantee uninterrupted operation. We may update features and these terms; material changes will be announced on this site.</p>
<h2>7. Disclaimer and liability</h2><p>The Service is provided "as is" without warranties. To the extent permitted by law, our total liability is limited to the amount you paid in the 12 months before the claim.</p>
<h2>8. Contact</h2><p>E:LAB, Republic of Korea · <a href="mailto:${SUPPORT}">${SUPPORT}</a></p>`,
);

const privacy = legal(
	"Privacy Policy",
	`<p>This policy explains what data Vault Tidy ("we", E:LAB) processes.</p>
<h2>Free plugin</h2><p>The free features run entirely on your device. No data leaves your computer, and there is no telemetry or analytics.</p>
<h2>Pro features</h2><p>When you use an AI feature, the plugin sends to our API (hosted on Cloudflare) only: tag names with usage counts, or the title and the first 1,500 characters of the notes you selected. This content is processed by Cloudflare Workers AI to produce suggestions and is not stored or used for training. We keep a daily usage counter per license for fair use.</p>
<h2>Licensing and payments</h2><p>Payments are processed by Paddle.com as Merchant of Record; see Paddle's privacy policy. We receive your email, country and subscription status to issue and validate your license key, and store a random device identifier for each activation.</p>
<h2>Retention</h2><p>License records are kept while your subscription is active and up to 2 years after for tax and support purposes. You can ask us to delete them at any time.</p>
<h2>Your rights</h2><p>You can request access, correction or deletion of your data by emailing <a href="mailto:${SUPPORT}">${SUPPORT}</a>.</p>`,
);

const refund = legal(
	"Refund Policy",
	`<p>We offer a <strong>${cfg.refundDays}-day money-back guarantee</strong> on all Vault Tidy Pro purchases, including renewals.</p>
<p>If Pro is not right for you, email <a href="mailto:${SUPPORT}">${SUPPORT}</a> or contact Paddle (our reseller and Merchant of Record) via the link in your receipt within ${cfg.refundDays} days of the charge, and we will refund it in full. No questions asked.</p>
<p>After a refund the license key is deactivated. Cancelling a subscription stops future renewals; it does not refund past periods unless requested within ${cfg.refundDays} days.</p>`,
);

const support = page(
	"Support · Vault Tidy",
	"Get help with Vault Tidy or recover your license key.",
	`<main class="wrap legal"><h1>Support</h1>
<p>Questions, bugs or refund requests: <a href="mailto:${SUPPORT}">${SUPPORT}</a>. We usually reply within 1–2 business days. Bug reports are also welcome on <a href="https://github.com/didrod205/vault-tidy/issues">GitHub</a>.</p>
<h2>Recover your license key</h2><p>Enter the email you used at checkout. If an active license exists, it will be shown below.</p>
<form id="f"><input id="email" type="email" required placeholder="you@example.com"><br><input id="order" required placeholder="Order / transaction ID from your receipt (txn_… or invoice number)"><br><button class="btn primary" type="submit">Find my key</button></form><div id="out"></div>
<script>document.getElementById('f').onsubmit=async function(e){e.preventDefault();const o=document.getElementById('out');o.textContent='Looking…';
const r=await fetch('/v1/license/recover',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:email.value,order:order.value})});const j=await r.json();
o.innerHTML=j.key?'<div class="key">'+j.key+'</div>':'<p>'+(j.error||'Not found')+'</p>';};</script></main>`,
);

const thanks = page(
	"Thank you · Vault Tidy Pro",
	"Your Vault Tidy Pro license key",
	`<main class="wrap legal"><h1>Thank you!</h1><p>Your payment went through. Here is your Vault Tidy Pro license key:</p><div id="key" class="key">Preparing your key…</div>
<p>In Obsidian: <strong>Settings → Vault Tidy → Enter license key</strong>, paste it, done. Keep this key; you can also recover it later on the <a href="/support/">Support page</a>.</p>
<script>(async function(){const p=new URLSearchParams(location.search);const t=p.get('txn')||p.get('_ptxn');const el=document.getElementById('key');if(!t){el.textContent='Missing order id. Check your email or contact support.';return;}
for(let i=0;i<20;i++){const r=await fetch('/v1/license/by-transaction?txn='+encodeURIComponent(t));const j=await r.json();if(j.key){el.textContent=j.key;return;}await new Promise(s=>setTimeout(s,3000));}
el.textContent='Your key is taking longer than usual. Refresh in a minute or contact ${SUPPORT}.';})();</script></main>`,
);

const out = new URL("./public/", import.meta.url);
const w = (p, s) => {
	fs.mkdirSync(new URL(p.replace(/[^/]*$/, ""), out), { recursive: true });
	fs.writeFileSync(new URL(p, out), s);
};
w("index.html", home);
w("terms/index.html", terms);
w("privacy/index.html", privacy);
w("refund/index.html", refund);
w("support/index.html", support);
w("thanks/index.html", thanks);
console.log("site built", cfg.environment || "no-paddle");
