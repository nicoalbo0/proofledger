import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from "node:fs";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import type {
  Config,
  Evidence,
  Experiment,
  Hypothesis,
  Ledger,
  Registration,
} from "../domain/types.js";

export const DIR = ".proofledger";

/** Filesystem layout under <root>/.proofledger. */
function paths(root: string) {
  const base = join(root, DIR);
  return {
    base,
    config: join(base, "config.json"),
    ledger: join(base, "ledger.json"),
    ledgerMd: join(base, "ledger.md"),
    audit: join(base, "audit.log"),
    hypotheses: join(base, "hypotheses"),
    registrations: join(base, "registrations"),
    experiments: join(base, "experiments"),
    evidence: join(base, "evidence"),
  };
}

/** Atomic JSON write: temp file + rename, so a crash never leaves a half file. */
function writeJson(file: string, data: unknown): void {
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n", "utf8");
  renameSync(tmp, file);
}

function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(file, "utf8")) as T;
}

/**
 * Store owns all disk IO for a repo's ledger. It is dumb on purpose: it does not
 * enforce invariants (that lives in the domain layer). It just reads and writes
 * typed entities atomically.
 */
export class Store {
  private p: ReturnType<typeof paths>;
  constructor(private root: string = process.cwd()) {
    this.p = paths(root);
  }

  isInitialized(): boolean {
    return existsSync(this.p.config);
  }

  /** Create the directory skeleton. Idempotent. */
  scaffold(): void {
    for (const d of [
      this.p.base,
      this.p.hypotheses,
      this.p.registrations,
      this.p.experiments,
      this.p.evidence,
    ]) {
      mkdirSync(d, { recursive: true });
    }
  }

  // ---- Config ----
  readConfig(): Config {
    return readJson<Config>(this.p.config);
  }
  writeConfig(c: Config): void {
    writeJson(this.p.config, c);
  }

  // ---- Ledger index ----
  readLedger(): Ledger {
    return readJson<Ledger>(this.p.ledger);
  }
  writeLedger(l: Ledger): void {
    writeJson(this.p.ledger, l);
  }

  // ---- Entities (one JSON file each) ----
  readHypothesis(id: string): Hypothesis {
    return readJson<Hypothesis>(join(this.p.hypotheses, `${id}.json`));
  }
  writeHypothesis(h: Hypothesis): void {
    writeJson(join(this.p.hypotheses, `${h.id}.json`), h);
  }
  listHypotheses(): Hypothesis[] {
    return this.readDir<Hypothesis>(this.p.hypotheses);
  }

  readRegistration(id: string): Registration {
    return readJson<Registration>(join(this.p.registrations, `${id}.json`));
  }
  writeRegistration(r: Registration): void {
    writeJson(join(this.p.registrations, `${r.id}.json`), r);
  }

  readExperiment(id: string): Experiment {
    return readJson<Experiment>(join(this.p.experiments, `${id}.json`));
  }
  writeExperiment(x: Experiment): void {
    writeJson(join(this.p.experiments, `${x.id}.json`), x);
  }
  listExperimentsFor(assumptionId: string): Experiment[] {
    return this.readDir<Experiment>(this.p.experiments).filter(
      (x) => x.assumptionId === assumptionId,
    );
  }

  readEvidence(id: string): Evidence {
    return readJson<Evidence>(join(this.p.evidence, `${id}.json`));
  }
  writeEvidence(e: Evidence): void {
    writeJson(join(this.p.evidence, `${e.id}.json`), e);
  }
  listEvidenceFor(assumptionId: string): Evidence[] {
    return this.readDir<Evidence>(this.p.evidence).filter(
      (e) => e.assumptionId === assumptionId,
    );
  }

  // ---- Audit log (append-only JSONL) ----
  appendAudit(event: Record<string, unknown>): void {
    writeFileSync(this.p.audit, JSON.stringify(event) + "\n", { flag: "a" });
  }

  // ---- Rendered mirror ----
  writeLedgerMd(md: string): void {
    writeFileSync(this.p.ledgerMd, md, "utf8");
  }

  private readDir<T>(dir: string): T[] {
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => readJson<T>(join(dir, f)));
  }
}
