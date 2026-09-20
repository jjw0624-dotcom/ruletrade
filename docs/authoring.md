# RuleTrade authoring contract

**Status: CURRENT.** This document describes the implemented authoring boundary.
Canonical and the [living architecture](architecture.md) remain authoritative.

## Contract

All currently supported Strategy mutations use the existing endpoints:

- `POST /v1/canonical/strategies/authoring/capabilities`
- `POST /v1/canonical/strategies/authoring/apply`

Capabilities answer which explicit operations are valid for the supplied
Canonical and exact target. They include current values, choices, and narrow
constraints required by today's controls. They are not a generic form schema.

Apply is stateless and atomic:

```text
working Canonical
  → typed semantic operation
  → Registry and domain validation
  → standard Canonical validation
  → validated Canonical response
```

On success, the shared frontend authoring client replaces the working Canonical
and Structure, Summary, Guide, and Flow reproject. On rejection, it retains the
previous Canonical. Apply does not save a Revision or execute LEAN; Save remains
the immutable Revision boundary.

## Supported operations

Structural operations cover group rename, one qualification add/remove, Choose
transformation, fallback add/remove, and explicit Growth/Defensive transformation.

Typed operations cover:

- referenced asset-universe membership;
- trailing-return lookback;
- the supported qualification threshold;
- Top N or random-selection count and existing random resampling;
- the complete allocation vector for the supported two-sleeve portfolio;
- Daily, Monthly, and Quarterly schedules (period schedules execute on day 1);
- fallback choice among existing single-asset definitions;
- duration of an existing Cooldown in completed trading days.

Operations preserve surviving Canonical component IDs. A change that cannot
produce a valid supported Canonical is rejected without partial mutation.

## Deliberate limits

The contract is an explicit union of product operations, not JSON Patch, a
mutation DSL, or a UI-schema system. It does not provide primitive CRUD, free
wiring, generic Group CRUD, arbitrary nested portfolios, multiple conditions,
unrestricted boolean expressions, or Cooldown creation.

Future Builder representations can call the same operations without reproducing
domain eligibility or validation, but no Blocky, Rules, Code, or AI consumer is
implemented today.
