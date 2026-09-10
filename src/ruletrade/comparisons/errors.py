class ComparisonDomainError(Exception):
    code = "comparison_error"


class ComparisonNotFoundError(ComparisonDomainError):
    code = "comparison_not_found"


class IncomparableRunsError(ComparisonDomainError):
    code = "incomparable_runs"


class ComparisonEvidenceUnsupportedError(ComparisonDomainError):
    code = "comparison_evidence_unsupported"


class ComparisonPersistenceError(ComparisonDomainError):
    code = "comparison_persistence_failure"
