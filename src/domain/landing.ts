// Pure landing-page generator. Produces a single static HTML file (no server
// code) that any static host can serve. The Stripe pre-auth is wired client-side
// with the founder's PUBLISHABLE key; the manual-capture intent is created from
// the CLI with the secret key, never exposed to the page.

export interface LandingInput {
  headline: string;
  subhead: string;
  priceUsd: number;
  ctaLabel: string;
  experimentTag: string;
  stripePublishableKey: string;
  /** Client secret of a pre-created manual-capture PaymentIntent. */
  clientSecret: string;
  /** Disclosure — required so this is a real waitlist reserve, not a dark-pattern charge. */
  disclosure?: string;
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function renderLanding(input: LandingInput): string {
  const disclosure =
    input.disclosure ??
    "You are reserving a spot. Your card is authorized to confirm intent and is NOT charged.";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(input.headline)}</title>
<meta name="pl-experiment" content="${esc(input.experimentTag)}" />
<script src="https://js.stripe.com/v3/"></script>
<style>
  body { font: 16px/1.5 system-ui, sans-serif; max-width: 40rem; margin: 4rem auto; padding: 0 1rem; }
  h1 { font-size: 2rem; }
  .cta { font-size: 1.1rem; padding: .8rem 1.4rem; border: 0; border-radius: .5rem; background: #111; color: #fff; cursor: pointer; }
  .disclosure { color: #666; font-size: .85rem; margin-top: 1rem; }
  #email { padding: .6rem; width: 100%; margin: 1rem 0; font-size: 1rem; }
</style>
</head>
<body>
  <h1>${esc(input.headline)}</h1>
  <p>${esc(input.subhead)}</p>
  <input id="email" type="email" placeholder="you@email.com" />
  <button class="cta" id="reserve">${esc(input.ctaLabel)} — $${input.priceUsd}/mo</button>
  <p class="disclosure">${esc(disclosure)}</p>
  <script>
    const stripe = Stripe(${JSON.stringify(input.stripePublishableKey)});
    const clientSecret = ${JSON.stringify(input.clientSecret)};
    document.getElementById("reserve").addEventListener("click", async () => {
      const email = document.getElementById("email").value;
      const { error } = await stripe.confirmCardPayment(clientSecret, {
        payment_method: { card: { token: "tok_visa" }, billing_details: { email } },
      });
      document.getElementById("reserve").textContent = error ? "Try again" : "Reserved ✓";
    });
  </script>
</body>
</html>`;
}
