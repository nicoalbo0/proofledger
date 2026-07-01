# Live smoke tests

Prove the network adapters work against the real APIs. Do them **in order** —
each is cheaper/safer than the next. None require real money if you stop after
step 2; step 3 is optional and costs a few dollars (or nothing in a sandbox).

Prereq: `npm install && npm run build`.

---

## 1. Stripe — TEST MODE (free, do this first)

Validates the whole verification moat: create manual-capture holds → re-fetch →
dedupe by card fingerprint → void. Test cards only, **no real money**.

1. Get your **test** secret key from the Stripe Dashboard (toggle *Test mode* ON):
   Developers → API keys → *Secret key* → starts with `sk_test_`.
2. Run:
   ```bash
   PL_LIVE_STRIPE=sk_test_xxx npm run smoke:stripe
   ```

**Pass looks like:** the test creates 3 holds (2 Visa + 1 Mastercard), the filter
counts **2** (one Visa deduped), and all holds end up `canceled`. Green = the
real Stripe path works. The suite refuses to run with a live `sk_live_` key.

Nothing to clean up — every hold is voided by the test.

---

## 2. Cloudflare — free Worker

Deploys a real landing page and fetches it back publicly, then deletes it.

1. Find your **Account ID**: Cloudflare dashboard → Workers & Pages → right sidebar.
2. Create an **API token**: My Profile → API Tokens → Create Token → template
   *Edit Cloudflare Workers* (or a custom token with **Workers Scripts: Edit**).
3. Make sure your account has a **workers.dev subdomain** (Workers & Pages →
   Subdomain — set one once if prompted).
4. Run:
   ```bash
   PL_LIVE_CF_ACCOUNT=<account-id> PL_LIVE_CF_TOKEN=<token> npm run smoke:cf
   ```

**Pass looks like:** deploys to `pl-x-smoke-….<sub>.workers.dev`, fetches it, sees
the marker HTML, then deletes the Worker. (First fetch may retry a few seconds
for propagation.)

### Manual variant (recommended once)
Do a real end-to-end page check by hand:
```bash
proofledger init "smoke"
proofledger connect stripe --secret sk_test_xxx --publishable pk_test_xxx
proofledger connect cloudflare --account <id> --token <token>
proofledger connect meta --token t --adaccount a --page p     # placeholders ok for now
proofledger hypothesis "people will pre-pay \$9/mo for X"
proofledger register --metric preauth_conversion --sample 100 --pass 0.05 --kill 0.02
# run WITHOUT --activate so no ad spends; deploys the page + wires Stripe:
proofledger experiment run --assumption <pay-id> --price 9 --headline "X" --keywords a,b --daily 5 --days 3
```
Open the printed URL, pay with test card `4242 4242 4242 4242` (any future
expiry/CVC), then:
```bash
proofledger verify --experiment <id>   # should count your test pre-auth and void it
proofledger status                     # gate opens if the bet clears
```

---

## 3. Meta — last, smallest

Two options. Start with the **sandbox** (no spend, no delivery) to confirm the
API sequence; only go live if you want real clicks.

### Automated connectivity check (recommended first)
Creates the full campaign→adset→creative→ad chain **PAUSED** (no spend), reads
insights, then deletes the campaign:
```bash
PL_LIVE_META_TOKEN=<token> PL_LIVE_META_ADACCOUNT=<digits> PL_LIVE_META_PAGE=<page-id> \
  npm run smoke:meta
```
Token needs `ads_management`; the ad account may need a payment method attached
even for paused ads (it is never charged while paused). Pass = the whole ad
sequence works against the real Graph API.

### Manual variant
1. Get a **user access token** with `ads_management` (Graph API Explorer).
2. Get your **ad account id** (digits only) and a **Facebook Page id**.
3. Connect + run paused (nothing delivers):
   ```bash
   proofledger connect meta --token <token> --adaccount <act-id-digits> --page <page-id>
   proofledger experiment run --assumption <pay-id> --price 9 --headline "X" \
     --keywords a,b --daily 5 --days 3        # no --activate
   ```
   Success = campaign → ad set → creative → ad all created **PAUSED**, no errors.

### Real delivery (optional, costs money)
Add `--activate true` with a tiny budget (`--daily 2 --days 1`), let it run ~1
hour, then:
```bash
proofledger verify --experiment <id>    # pull real clicks + verified pre-auths
```
Pause/delete the campaign in Ads Manager when done.

> Reminder: ProofLedger runs on **your** accounts. It never spends without
> `--activate`, and it caps spend at `budget.perExperimentUsdCap` in
> `.proofledger/config.json`.
