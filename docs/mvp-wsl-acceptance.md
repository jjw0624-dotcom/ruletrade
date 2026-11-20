# MVP WSL acceptance

**Status: CURRENT — authoritative final handoff before owner acceptance**

Use this procedure after the fixed-strategy MVP implementation is merged. It is
the single acceptance path for the ten capabilities in
[MVP completion plan](mvp-completion-plan.md). Historical Builder acceptance
documents do not replace it.

The automated suite proves repository, Docker/LEAN, persisted API, and real
Chrome contracts. The owner journey then proves that the actual product is
understandable and usable. Neither result substitutes for the other.

## 1. Freeze the revision under test

From the WSL clone:

```bash
git switch main
git pull --ff-only
git status --short
git rev-parse HEAD
```

The status output must be empty. Save the SHA with the screenshots and logs.
Do not change branches or pull again during the run.

## 2. Prerequisites

The supported toolchain is Python 3.12 through `uv`, Node 24, npm, Docker, and
Chrome. Docker Desktop must expose its daemon to the WSL distribution.

```bash
uv --version
node --version
npm --version
docker version
google-chrome --version
```

If Chrome has another path, export it before running the suite:

```bash
export CHROME_BIN=/path/to/google-chrome
```

For licensed/operator-provisioned real market data, point RuleTrade at the LEAN
data directory. The repository never downloads or purchases this data.

```bash
export RULETRADE_LEAN_DATA_DIR="$HOME/dev/ruletrade/experiments/lean-spike/data"
```

## 3. Run automated acceptance

Run the complete local contract when the data cache is available:

```bash
./scripts/check_mvp_wsl.sh all
```

Without real data, run the deterministic core first:

```bash
./scripts/check_mvp_wsl.sh core
```

Later, after setting `RULETRADE_LEAN_DATA_DIR`:

```bash
./scripts/check_mvp_wsl.sh real-data
```

The runner performs locked installation, full repository validation, all
maintained generated-C# LEAN compilations, the persisted V2 Docker/LEAN API
journey, and the real-Chrome product harness. Real-data mode additionally runs
data inspection, a QQQ smoke test, and the maintained real-data comparison
journey.

A successful run ends with `PASS`. Logs are written to
`.acceptance/mvp/`; Chrome screenshots are written to
`build/browser-acceptance/`. A missing data cache, Docker daemon, Chrome
binary, compilation, execution, persistence assertion, or browser assertion is
a failure, not a waiver.

## 4. Start the product

Keep the exact same checkout. Start these in separate WSL terminals:

```bash
make api
```

```bash
make frontend
```

Open `http://127.0.0.1:5173` from Windows. Use a normal browser profile or a
fresh private window. Capture the browser viewport and the WSL SHA.

## 5. Owner journey

Use one `growth_defensive` catalog Strategy for the main journey unless a step
explicitly calls for another artifact. Give artifacts recognizable names, for
example `WSL MVP <date> Growth Defensive`.

Record one screenshot for every numbered section and copy any visible Run or
experiment ID into the result notes.

### A. Strategy-first creation and Quick BT

1. Start from the strategy/idea entry.
2. Open Rules creation and choose **Growth + Defensive**.
3. Set Growth assets to QQQ, VGT, SOXX, and SCHG; Defensive to IEF; keep a
   monthly cadence and save.
4. Leave the Strategy, reopen it from the saved Strategy repository, and confirm
   the same parameters.
5. Run **Test** / Quick BT.
6. Confirm a persisted successful Run, Result metrics, and Decision Evidence.
7. Open one Decision, inspect Why/Why-not, navigate to the responsible Rule,
   then return to the same Result.

Pass: the Strategy is a saved immutable Revision, Quick BT uses LEAN, and
Result-to-Rule navigation retains exact provenance.

### B. Detailed BT

1. From the saved Strategy, open **Detailed BT**.
2. Set one explicit date range, starting cash, and an implemented data setting.
3. Run it once.
4. Leave the page, reopen the saved Detailed experiment from Research, and
   confirm the config, Run, metrics, and provenance are unchanged.

Pass: this is one unchanged-Revision ordinary high-fidelity backtest. It is not
a parameter sweep. Unsupported FX, fees, slippage, or interval controls must
not appear as if implemented.

### C. Hidden BT

1. Open **Hidden BT** for the same saved Revision.
2. Add at least two bounded values to supported catalog parameters (for example,
   lookback and Top N count) without creating an unbounded search.
3. Run calibration and inspect every candidate's visible-range metric.
4. Confirm exactly one selected winner proceeds to Hidden evaluation.
5. Confirm no losing candidate exposes a hidden-range result.
6. Leave and reopen the Hidden experiment from Research.

Pass: policy, candidate grid, calibration results, selected candidate, final
holdout Run, source hashes, and phase ranges recover unchanged. Parameter Sweep
belongs here, not in Detailed BT.

### D. Robustness and random baseline

1. Open **Tests** and run the supported timing/parameter robustness suite with a
   recorded seed.
2. Run the random baseline under the displayed universe, capital, period, and
   trade constraints.
3. Inspect the distribution/failure cases rather than only the best result.
4. Leave and reopen each saved Test experiment from Research.

Pass: variants and random behavior are evaluation policy around the same
Revision; seed, configuration, Runs, and outcomes persist.

### E. Forward

1. Activate Forward for the saved Revision and record its start timestamp.
2. Leave the page and reopen the Forward evaluation.
3. Refresh/revisit it after data is available.

Pass: the exact Revision and start time remain pinned and history is not
rewritten. Immediately after activation, an honest “no post-activation
observation yet” state is acceptable; invented performance is not. Forward is
paper evaluation, not broker execution.

### F. Problem-first Learning

1. Return Home and enter Learning.
2. Open one supplied problem.
3. Confirm its allowed strategy family, asset universe, and required/locked
   parameters are visible in Rules creation.
4. Create and save a compliant Strategy, run its available evaluation, submit
   it, leave, and reopen the submission.
5. Attempt one prohibited parameter or asset change.

Pass: the prohibited choice is absent or rejected by backend preflight, and the
saved submission identifies the exact Revision and policy version.

### G. Competition

1. Enter one Competition and read its objective, dataset policy, trading limits,
   and allowed assets.
2. Create or select a compliant catalog Strategy and submit it.
3. Attempt one deliberately non-compliant choice.
4. Leave and reopen the Competition submission.

Pass: authoring and evaluation enforce the same immutable policy; the invalid
submission cannot be accepted; the valid submission recovers by exact Revision.

### H. Supported change, compare, keep/discard

Candidate v0 is intentionally narrower than the V2 catalog. Use a saved
compatibility Strategy that visibly offers **Try Change**; do not interpret the
absence of that action on a catalog Strategy as generic V2 parameter editing.

1. Open **Try Change**, change the supported filter threshold, and run Candidate.
2. Open Comparison and verify Original and Candidate lineage.
3. Exercise **Return to original** once.
4. Create the change again, choose **Keep change**, and confirm the intended
   immutable Revision becomes current.
5. Run the current Strategy again.

Pass: Candidate research never mutates the Strategy before Keep; discard keeps
the original; Keep creates or reuses the intended Revision; stale lineage is
rejected. Generalized V2 Candidate editing remains outside this MVP.

### I. Recovery sweep

Leave the Builder completely, then recover from product navigation:

- both catalog Strategies and their current Revisions;
- Quick and Detailed Runs;
- Hidden experiment including final holdout Run;
- robustness and random Test experiments;
- Forward activation and latest paper result/state;
- Learning and Competition submissions;
- Candidate Comparison and adopted/original lineage.

Pass: all saved objects reopen without relying on browser memory or recreating
inputs.

## 6. Evidence to return

Send back:

- `git rev-parse HEAD`;
- the final `PASS` lines and any failure section from
  `.acceptance/mvp/automated-*.log`;
- screenshots A through I;
- visible artifact/Run IDs where available;
- the first failing action, expected result, actual result, and browser console
  error for every failure.

Do not rerun or work around a failure before recording it. That first state is
the most useful diagnostic.

## Acceptance boundary

The fixed-strategy research MVP is under acceptance. The unrestricted visual
Builder is not: Flow and Blocky remain experimental projections while their
independent track continues. V2 Canonical, immutable Revisions, shared LEAN
execution, persisted research artifacts, Learning/Competition policy, and the
fixed Rules catalog are the supported foundation. Decorative controls for
unsupported execution fidelity are forbidden.
