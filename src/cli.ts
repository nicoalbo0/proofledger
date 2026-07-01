#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { Store } from "./store/store.js";
import { systemClock } from "./util/clock.js";
import { renderLedgerMd } from "./store/render.js";
import { RegistrationTamperError } from "./domain/integrity.js";
import { initRepo } from "./commands/init.js";
import { addHypothesis } from "./commands/hypothesis.js";
import { registerBet } from "./commands/register.js";
import { verifyStub, type StubBatch } from "./commands/verify.js";
import { runDecay } from "./commands/decay.js";
import { runSignalScreen } from "./commands/signal.js";
import { runExperiment, pollExperiment } from "./commands/experiment.js";
import { runPaymentVerification } from "./commands/verify-payment.js";
import { PublicSignalAdapter } from "./adapters/signal.js";
import { StripePaymentAdapter } from "./adapters/stripe.js";
import { CloudflarePagesAdapter } from "./adapters/host.js";
import { MetaAdAdapter } from "./adapters/ad.js";
import { gatingAssumption } from "./domain/verdict.js";
import { resolveSecrets, secretKey, type SecretsProvider } from "./secrets/secrets.js";
import { gateCheck, recordOverride } from "./domain/gate.js";
import type { CmpOp, Metric } from "./domain/types.js";

function flags(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const val = argv[i + 1] && !argv[i + 1]!.startsWith("--") ? argv[++i]! : "true";
      out[key] = val;
    }
  }
  return out;
}

function requireInit(store: Store): void {
  if (!store.isInitialized()) throw new Error("not initialized — run `pl init` first");
}

/** Fetch a required secret or fail with a clear "connect this provider" message. */
async function need(secrets: SecretsProvider, provider: string, name: string): Promise<string> {
  const v = await secrets.get(secretKey(provider, name));
  if (!v) throw new Error(`missing ${provider}.${name} — run \`pl connect ${provider} --${name} <value>\``);
  return v;
}

async function main(argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv;
  const store = new Store(process.cwd());
  const clock = systemClock;

  switch (cmd) {
    case undefined:
    case "help":
    case "--help":
      console.log(
        "pl <command>\n\n" +
          "  init [motivation]\n" +
          "  connect <provider> --<key> <value> ...\n" +
          "  hypothesis \"<claim>\"\n" +
          "  register --metric <m> --sample <n> --pass <x> --kill <y> [--assumption <id>]\n" +
          "  signal --assumption <id> --keywords a,b --competitors c,d\n" +
          "  experiment run --assumption <id> --price <n> --headline <s> --keywords a,b --daily <n> --days <n> [--activate true]\n" +
          "  verify --experiment <id> | --file <batches.json>\n" +
          "  decay\n" +
          "  status\n" +
          "  gate check <path> | gate --override \"<reason>\"",
      );
      return 0;

    case "connect": {
      const provider = rest[0];
      if (!provider) throw new Error("usage: pl connect <provider> --<key> <value>");
      const f = flags(rest.slice(1));
      const secrets = await resolveSecrets();
      for (const [k, v] of Object.entries(f)) await secrets.set(secretKey(provider, k), v);
      console.log(`stored ${Object.keys(f).length} secret(s) for ${provider}.`);
      return 0;
    }

    case "signal": {
      requireInit(store);
      const f = flags(rest);
      if (!f.assumption) throw new Error("usage: pl signal --assumption <id> --keywords a,b --competitors c,d");
      const score = await runSignalScreen(
        store,
        new PublicSignalAdapter(),
        {
          assumptionId: f.assumption,
          query: {
            keywords: (f.keywords ?? "").split(",").filter(Boolean),
            competitorKeywords: (f.competitors ?? "").split(",").filter(Boolean),
          },
        },
        clock,
      );
      console.log(`signal score ${score.final}/100${score.redOcean ? " (RED OCEAN)" : ""}. Run \`pl status\`.`);
      return 0;
    }

    case "init": {
      const r = initRepo(store, rest.join(" ") || "(unspecified)", clock);
      console.log(r.alreadyInitialized ? "already initialized" : "initialized .proofledger/");
      return 0;
    }

    case "hypothesis": {
      requireInit(store);
      const claim = rest.filter((a) => !a.startsWith("--")).join(" ");
      if (!claim) throw new Error('usage: pl hypothesis "<claim>"');
      const h = addHypothesis(store, claim, clock);
      console.log(`created ${h.id} with ${h.assumptions.length} assumptions; gate locked.`);
      return 0;
    }

    case "register": {
      requireInit(store);
      const f = flags(rest);
      const reg = registerBet(
        store,
        {
          metric: f.metric as Metric,
          sampleTarget: Number(f.sample),
          passIf: { op: (f.passOp as CmpOp) ?? ">=", value: Number(f.pass) },
          killIf: { op: (f.killOp as CmpOp) ?? "<", value: Number(f.kill) },
          ...(f.assumption ? { assumptionId: f.assumption } : {}),
        },
        clock,
      );
      console.log(`froze ${reg.id} (${reg.hash.slice(0, 22)}…) — bet is now immutable.`);
      return 0;
    }

    case "experiment": {
      requireInit(store);
      if (rest[0] !== "run") throw new Error("usage: pl experiment run --assumption <id> --price <n> ...");
      const f = flags(rest.slice(1));
      const secrets = await resolveSecrets();
      const assumptionId = f.assumption ?? gatingAssumption(store.readHypothesis(store.readLedger().activeHypothesisId!))?.id;
      if (!assumptionId) throw new Error("no assumption to run");
      const res = await runExperiment(
        store,
        {
          payment: new StripePaymentAdapter(await need(secrets, "stripe", "secret")),
          host: new CloudflarePagesAdapter(await need(secrets, "cloudflare", "account"), await need(secrets, "cloudflare", "token")),
          ad: new MetaAdAdapter(await need(secrets, "meta", "token"), await need(secrets, "meta", "adaccount")),
        },
        {
          assumptionId,
          priceUsd: Number(f.price ?? 0),
          stripePublishableKey: await need(secrets, "stripe", "publishable"),
          headline: f.headline ?? "Coming soon",
          subhead: f.subhead ?? "",
          ctaLabel: f.cta ?? "Reserve your spot",
          targeting: { keywords: (f.keywords ?? "").split(",").filter(Boolean), dailyBudgetUsd: Number(f.daily ?? 0), days: Number(f.days ?? 0) },
          confirmActivation: f.activate === "true",
        },
        clock,
      );
      console.log(`experiment ${res.experimentId} live at ${res.publicUrl}${res.activated ? " (ads ACTIVE)" : " (ads paused)"}`);
      return 0;
    }

    case "verify": {
      requireInit(store);
      const f = flags(rest);
      if (f.experiment) {
        const secrets = await resolveSecrets();
        const adapter = new StripePaymentAdapter(await need(secrets, "stripe", "secret"));
        const r = await runPaymentVerification(store, adapter, { experimentId: f.experiment, capture: f.capture === "true" }, clock);
        console.log(`counted ${r.counted} verified pre-auths, rejected ${r.rejected.length}, voided ${r.voided.length}.`);
        return 0;
      }
      if (!f.file) throw new Error("usage: pl verify --experiment <id> | --file <batches.json>");
      const batches = JSON.parse(readFileSync(f.file, "utf8")) as StubBatch[];
      verifyStub(store, batches, clock);
      console.log("verified; ledger recomputed. Run `pl status`.");
      return 0;
    }

    case "decay": {
      requireInit(store);
      runDecay(store, clock);
      console.log(`decay recomputed; gate is ${store.readLedger().gate.state}.`);
      return 0;
    }

    case "status": {
      requireInit(store);
      console.log(renderLedgerMd(store.readLedger(), store.listHypotheses()));
      return 0;
    }

    case "gate": {
      requireInit(store);
      const f = flags(rest);
      if (f.override) {
        recordOverride(store, f.override, process.env.USER ?? "unknown", clock);
        console.log("override recorded to audit.log.");
        return 0;
      }
      if (rest[0] === "check" && rest[1]) {
        const d = gateCheck(store, rest[1]);
        console.log(`${d.decision.toUpperCase()}: ${d.reason}`);
        return d.decision === "allow" ? 0 : 1;
      }
      console.log(`gate is ${store.readLedger().gate.state}: ${store.readLedger().gate.reason}`);
      return 0;
    }

    default:
      console.error(`unknown command: ${cmd}`);
      return 2;
  }
}

main(process.argv.slice(2))
  .then((code) => process.exit(code))
  .catch((err) => {
    if (err instanceof RegistrationTamperError) {
      console.error(`INTEGRITY FAILURE: ${err.message}\nGate hard-locked. Investigate before proceeding.`);
      process.exit(3);
    }
    console.error(`error: ${(err as Error).message}`);
    process.exit(1);
  });
