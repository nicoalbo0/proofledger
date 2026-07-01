import type { Clock } from "../util/clock.js";
import type { Store } from "../store/store.js";
import { newId } from "../util/id.js";
import { renderLanding } from "../domain/landing.js";
import { projectedSpendUsd, type AdAdapter, type AdTargeting } from "../adapters/ad.js";
import type { HostAdapter } from "../adapters/host.js";
import type { PaymentAdapter } from "../adapters/payment.js";
import type { Experiment } from "../domain/types.js";

export interface ExperimentDeps {
  payment: PaymentAdapter;
  host: HostAdapter;
  ad: AdAdapter;
}

export interface ExperimentOpts {
  assumptionId: string;
  priceUsd: number;
  stripePublishableKey: string;
  headline: string;
  subhead: string;
  ctaLabel: string;
  targeting: AdTargeting;
  /** Ads are created PAUSED; must be explicitly confirmed to spend money. */
  confirmActivation?: boolean;
}

export class BudgetExceededError extends Error {}

export interface ExperimentResult {
  experimentId: string;
  publicUrl: string;
  campaignId: string;
  activated: boolean;
}

/**
 * `pl experiment run` — the Tier-2 saga. Each external creation is guarded by the
 * providerRef it produces, so a re-run reconciles (resumes) instead of
 * duplicating a campaign or landing page. Money is never spent without an
 * explicit confirmActivation (and the config's requireActivationConfirm).
 *
 * Adapters are injected, so this is fully testable with fakes. The CLI builds
 * real adapters from connected secrets.
 */
export async function runExperiment(
  store: Store,
  deps: ExperimentDeps,
  opts: ExperimentOpts,
  clock: Clock,
): Promise<ExperimentResult> {
  const cap = store.readConfig().budget.perExperimentUsdCap;
  const projected = projectedSpendUsd(opts.targeting);
  if (projected > cap) {
    throw new BudgetExceededError(
      `projected spend $${projected} exceeds per-experiment cap $${cap}`,
    );
  }

  const exp = findOrCreate(store, opts.assumptionId, clock);
  const tag = exp.id;

  // 1. Pre-auth intent (manual capture). Tagged so verification can re-fetch it.
  let clientSecret = "";
  if (!exp.providerRefs.stripeMetadataTag) {
    const setup = await deps.payment.setupPreauth(Math.round(opts.priceUsd * 100), tag);
    clientSecret = setup.clientSecret;
    exp.providerRefs.stripeMetadataTag = tag;
    exp.status = "deploying";
    store.writeExperiment(exp);
  }

  // 2 + 3. Render + deploy the landing page to the founder's host.
  if (!exp.providerRefs.landingUrl) {
    if (!clientSecret) {
      // Re-run after tag set but before deploy: mint a fresh secret to render.
      const setup = await deps.payment.setupPreauth(Math.round(opts.priceUsd * 100), tag);
      clientSecret = setup.clientSecret;
    }
    const html = renderLanding({
      headline: opts.headline,
      subhead: opts.subhead,
      priceUsd: opts.priceUsd,
      ctaLabel: opts.ctaLabel,
      experimentTag: tag,
      stripePublishableKey: opts.stripePublishableKey,
      clientSecret,
    });
    const dep = await deps.host.deploy(tag, html);
    exp.providerRefs.landingUrl = dep.publicUrl;
    exp.providerRefs.hostDeployId = dep.deployId;
    store.writeExperiment(exp);
  }

  // 4. Create the ad campaign PAUSED.
  if (!exp.providerRefs.adCampaignId) {
    const campaignId = await deps.ad.createCampaign(exp.providerRefs.landingUrl, opts.targeting);
    exp.providerRefs.adCampaignId = campaignId;
    exp.status = "running";
    store.writeExperiment(exp);
  }

  // 5. Activation is opt-in and confirmed — this is the only step that spends.
  let activated = false;
  if (opts.confirmActivation) {
    await deps.ad.activate(exp.providerRefs.adCampaignId);
    activated = true;
    exp.startedAt = clock.iso();
    store.writeExperiment(exp);
    store.appendAudit({
      t: clock.iso(),
      kind: "ad_activate",
      experimentId: exp.id,
      budgetUsd: projected,
    });
  }

  return {
    experimentId: exp.id,
    publicUrl: exp.providerRefs.landingUrl!,
    campaignId: exp.providerRefs.adCampaignId!,
    activated,
  };
}

/** Pull real clicks + spend into the experiment counters (informational). */
export async function pollExperiment(
  store: Store,
  ad: AdAdapter,
  experimentId: string,
  clock: Clock,
): Promise<void> {
  const exp = store.readExperiment(experimentId);
  if (!exp.providerRefs.adCampaignId) return;
  const ins = await ad.insights(exp.providerRefs.adCampaignId);
  exp.counters.clicks = ins.clicks;
  exp.counters.spendUsd = ins.spendUsd;
  exp.counters.polledAt = clock.iso();
  store.writeExperiment(exp);
}

function findOrCreate(store: Store, assumptionId: string, clock: Clock): Experiment {
  const existing = store
    .listExperimentsFor(assumptionId)
    .find((x) => x.tier === 2 && x.status !== "closed");
  if (existing) return existing;
  const exp: Experiment = {
    id: newId("x"),
    assumptionId,
    registrationId: "",
    tier: 2,
    status: "draft",
    providerRefs: {},
    counters: {},
    startedAt: undefined,
  };
  store.writeExperiment(exp);
  return exp;
}
