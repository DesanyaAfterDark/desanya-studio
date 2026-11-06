#!/usr/bin/env python3
"""Static checks for the payment-terms page and its placements.

Does not call PayPal, submit a form, or change a price.
"""
import hashlib
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
CANCEL = (
    "To cancel a monthly service, email desanyaafterdark@gmail.com before the next "
    "service period begins. Include your name and the service you want to cancel. "
    "We monitor this inbox for cancellation requests. Cancellation stops future "
    "service periods and invoices; an unpaid invoice does not by itself commit you "
    "to another period. Refunds for the current paid period follow the cancellation "
    "and refund terms below."
)
BANNED = (
    "llc",
    "effective date",
    "not legal advice",
    "attorney",
    "complies with",
    "tennessee law",
    "proposed default",
    "this draft",
)
ANCHORS = (
    "checkout-and-quotes",
    "invoices",
    "monthly-services",
    "cancellation",
    "refunds",
    "scope-pause",
    "changes",
    "contact",
)
HASHES = {
    "createOrder": "81579c6e3ec33778e0beaf7b5a3074a7d7a0a3ae4cbd491da1f4ebf3a519a7ea",
    "rushAmount": "49887eccfa56b65a3f7fb136519c17332fb091a936d2beae73b05719b5f70b62",
    "getPayableTotal": "83b2201d0b805aec5b6fd5ff6268eeb25015e3b665701809e02e0df8bfd71c5c",
    "discountAmount": "24bc5405c1a6a62f26147a2d8a3c4b38cfd3ec8bfb1d17ebfb3a86f760c4bba8",
    "eligibleAmount": "8d6268eea7ebec928f376f0142863aff6c91511424963de50dc912778a83cd4d",
}

failures = []


def fail(msg):
    failures.append(msg)
    print("FAIL", msg)


def ok(msg):
    print("OK  ", msg)


def sha(text):
    return hashlib.sha256(text.encode()).hexdigest()


policy_path = ROOT / "payment-terms.html"
if not policy_path.exists():
    fail("payment-terms.html is missing")
    sys.exit(1)
policy = policy_path.read_text()
main = policy.split("<main", 1)[1].split("</main>", 1)[0]

if CANCEL not in policy:
    fail("exact cancellation clause is missing")
else:
    ok("exact cancellation clause")

low = main.lower()
for phrase in BANNED:
    if phrase in low:
        fail(f"customer page contains banned phrase: {phrase}")
if not any(phrase in low for phrase in BANNED):
    ok("no internal or compliance-claim phrases in the article")

if "Niota, TN" not in main:
    fail("city Niota, TN missing")
else:
    ok("city only: Niota, TN")

if re.search(r"\b\d{1,5}\s+[A-Z][a-z]+ (Street|St|Road|Rd|Avenue|Ave|Lane|Ln|Drive|Dr)\b", main):
    fail("street address appears in the article")
else:
    ok("no street address in the article")

if re.search(r"\(\d{3}\)\s*\d{3}-\d{4}|tel:", main):
    fail("phone number appears in the article")
else:
    ok("no phone number in the article")

levels = [int(n) for n in re.findall(r"<h([1-6])\b", main)]
if levels.count(1) != 1 or levels[0] != 1:
    fail(f"expected one h1 first, got {levels}")
elif any(b - a > 1 for a, b in zip(levels, levels[1:])):
    fail(f"heading level skipped: {levels}")
else:
    ok(f"heading outline {levels}")

for anchor in ANCHORS:
    if f'id="{anchor}"' not in main:
        fail(f"missing anchor #{anchor}")
else:
    if all(f'id="{anchor}"' in main for anchor in ANCHORS):
        ok("in-page anchors")

for target in ("services.html", "contact.html", "index.html", "mailto:desanyaafterdark@gmail.com"):
    if target not in main:
        fail(f"article missing link {target}")
else:
    if all(target in main for target in ("services.html", "contact.html", "index.html")):
        ok("article links to services, contact, and home")

checkout = (ROOT / "checkout.html").read_text()
pay_at = checkout.find('id="pay-disclosure"')
button_at = checkout.find('id="paypal-buttons"')
if pay_at < 0 or button_at < 0 or pay_at > button_at:
    fail("checkout disclosure is not before the PayPal buttons")
else:
    ok("checkout disclosure is before #paypal-buttons")

if "var PAYPAL_MODE = 'live'" not in checkout:
    fail("PayPal live mode marker changed")
else:
    ok("PayPal mode remains live")

start = checkout.index("createOrder: function")
end = checkout.index("onApprove: function")
if sha(checkout[start:end]) != HASHES["createOrder"]:
    fail("createOrder source changed")
else:
    ok("createOrder source hash unchanged")

cart = (ROOT / "assets" / "cart.js").read_text()
slices = {
    "rushAmount": cart[cart.index("function rushAmount()"):cart.index("function linePrice")],
    "getPayableTotal": cart[cart.index("function getPayableTotal()"):cart.index("function getCount")],
    "discountAmount": cart[cart.index("function discountAmount()"):cart.index("function sha256Hex")],
    "eligibleAmount": cart[cart.index("function eligibleAmount()"):cart.index("function discountAmount")],
}
for name, body in slices.items():
    if sha(body) != HASHES[name]:
        fail(f"{name} source changed")
    else:
        ok(f"{name} source hash unchanged")

footer_pages = list((ROOT).rglob("*.html"))
missing_footer = []
for path in footer_pages:
    text = path.read_text()
    if "footer-links" not in text:
        continue
    if "payment-terms.html" not in text:
        missing_footer.append(str(path.relative_to(ROOT)))
if missing_footer:
    fail("footer missing payment terms: " + ", ".join(missing_footer))
else:
    ok(f"payment-terms link in {sum(1 for p in footer_pages if 'footer-links' in p.read_text())} footers")

missing_privacy = []
for path in footer_pages:
    text = path.read_text()
    if "footer-links" not in text:
        continue
    if "privacy.html" not in text:
        missing_privacy.append(str(path.relative_to(ROOT)))
if missing_privacy:
    fail("footer missing privacy page: " + ", ".join(missing_privacy))
else:
    ok("privacy link in every footer")

home_first = re.search(
    r'data-nav="home".*?data-nav="blog".*?data-nav="contact".*?data-nav="esports".*?data-nav="gallery".*?data-nav="payment".*?data-nav="privacy".*?data-nav="process".*?data-nav="services".*?data-nav="work"',
    (ROOT / "partials" / "footer.html").read_text(),
    re.S,
)
if not home_first:
    fail("footer page list is not Home, then A-Z")
else:
    ok("footer pages are Home, then A-Z")

sitemap = (ROOT / "sitemap.xml").read_text()
if "https://desanya.tech/payment-terms.html" not in sitemap:
    fail("sitemap missing payment-terms.html")
else:
    ok("sitemap lists payment-terms.html")

if "https://desanya.tech/privacy.html" not in sitemap:
    fail("sitemap missing privacy.html")
else:
    ok("sitemap lists privacy.html")

game_policy = (ROOT / "firefly-hollow" / "privacy" / "index.html").read_text()
if "[date of v1.0 release]" in game_policy or "<mark>" in game_policy:
    fail("Firefly policy still has a raw date placeholder")
elif "Release date:</strong> To be determined." not in game_policy:
    fail("Firefly policy does not say the release date is to be determined")
elif re.search(r"Effective:\s*</strong>\s*[^<]*\d{4}", game_policy):
    fail("Firefly policy invents an effective date")
else:
    ok("Firefly release date is to be determined, with no invented effective date")

privacy_path = ROOT / "privacy.html"
if not privacy_path.exists():
    fail("privacy.html is missing")
else:
    privacy_main = privacy_path.read_text().split("<main", 1)[1].split("</main>", 1)[0]
    plow = privacy_main.lower()
    if "llc" in plow:
        fail("privacy page calls the studio an LLC")
    else:
        ok("privacy page does not call the studio an LLC")
    if "Niota, TN" not in privacy_main:
        fail("privacy page missing Niota, TN")
    else:
        ok("privacy page city only")
    if "release date is still to be determined" not in plow:
        fail("website privacy page does not say the game release date is to be determined")
    else:
        ok("website privacy page says the game release date is to be determined")
    if "firefly-hollow/privacy/" not in privacy_main:
        fail("privacy page does not point at the separate game policy")
    else:
        ok("website privacy stays separate from the game policy")
    if "desanya_last_order" not in privacy_main or "thanks/#receipt" not in privacy_main:
        fail("privacy page does not describe the receipt gate")
    else:
        ok("privacy page describes the receipt gate")
    invented = [phrase for phrase in ("we retain analytics", "complies with", "retention period of") if phrase in plow]
    if invented:
        fail("privacy page states an unsupported retention or compliance claim: " + ", ".join(invented))
    else:
        ok("privacy page does not invent a retention period")

if not (ROOT / "services.html").exists() or not (ROOT / "contact.html").exists():
    fail("an existing page is missing")
else:
    ok("services and contact pages still exist")

print()
if failures:
    print(f"{len(failures)} failure(s)")
    sys.exit(1)
print("payment policy static checks passed")
