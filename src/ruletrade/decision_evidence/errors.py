class DecisionEvidenceError(ValueError):
    """A generated machine-evidence stream violated its versioned contract."""


class DecisionEventNotFoundError(LookupError):
    code = "decision_event_not_found"

