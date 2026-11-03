import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def load(path: str) -> dict:
    return json.loads((ROOT / path).read_text())


def test_architecture_contract_artifacts_are_versioned_and_traceable() -> None:
    paths = [
        "docs/architecture/semantic-model-map.json",
        "docs/architecture/semantic-operation-registry.json",
        "docs/architecture/perspective-capability-matrix.json",
        "docs/architecture/bidirectional-perspective-contract.json",
        "docs/architecture/execution-mapping.json",
        "docs/architecture/architecture-gap-analysis.json",
        "corpus/perspective-roundtrip-corpus.json",
    ]
    for path in paths:
        artifact = load(path)
        assert artifact["schema"].startswith("ruletrade.dev/")
        assert artifact["audited_commit"] == "5ceaeda56bbe5012bf755d28c580dc848814492c"


def test_operation_registry_covers_every_discriminated_v2_operation() -> None:
    source = (ROOT / "src/ruletrade/strategy/v2/authoring.py").read_text()
    registered = set(load("docs/architecture/semantic-operation-registry.json")["canonical_operations"])
    declared = set()
    for line in source.splitlines():
        marker = 'kind: Literal["'
        if marker in line:
            declared.add(line.split(marker, 1)[1].split('"', 1)[0])
    # `_SelectionSubject(kind="asset")` is an internal traversal helper, not a
    # member of the discriminated V2AuthoringOperation union.
    declared.remove("asset")
    assert registered == declared


def test_roundtrip_corpus_has_required_positive_and_negative_ids() -> None:
    cases = load("corpus/perspective-roundtrip-corpus.json")["cases"]
    ids = {case["id"] for case in cases}
    assert all(any(item.startswith(f"RT-{letter}-") for item in ids) for letter in "ABCDEFGHIJ")
    assert all(any(item.startswith(f"RT-N{index}-") for item in ids) for index in range(1, 10))


def test_unsupported_draft_semantics_are_not_claimed_executable() -> None:
    features = {item["id"]: item for item in load("docs/architecture/execution-mapping.json")["features"]}
    for feature in ("fixed_money_quantity_orders", "signals_loops_functions"):
        assert features[feature]["lowerable"] is False
        assert features[feature]["docker_verified"] is False
        assert features[feature]["api"] is False
