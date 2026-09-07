# Test report

Date: 2026-09-03

## Passed in the build environment

- Pydantic strategy validation
- Duplicate-symbol rejection
- Weight-sum rejection
- Symbol normalization
- Semantic hashing independent of asset order and display name
- bt compilation-plan generation
- CSV dataset loading and validation
- Missing-symbol rejection
- Max-drawdown calculation
- XIRR sanity test
- FastAPI health endpoint
- FastAPI strategy-validation endpoint
- JSON Schema endpoint
- Dataset-list endpoint
- Python bytecode compilation

Result: 11 tests passed.

## Intentionally not executed here

The `bt` integration test was skipped because this build environment cannot resolve external package hosts, so `bt==1.2.0` could not be installed. The integration test and full smoke script are included and will execute automatically after the project is installed with the `bt` extra or built with Docker.

## First external acceptance criterion

The following command must finish successfully in an internet-connected Linux environment:

```bash
./scripts/doctor.sh
```

Expected summary:

```text
tests=0 validate=0 backtest=0
```

The generated result must contain positive final value, at least 12 recurring cash-flow rows, and transaction records.
