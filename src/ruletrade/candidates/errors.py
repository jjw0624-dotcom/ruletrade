from __future__ import annotations


class CandidateDomainError(Exception):
    code = "candidate_error"


class CandidateNotFoundError(CandidateDomainError):
    code = "candidate_not_found"


class InvalidCandidateChangeError(CandidateDomainError):
    code = "invalid_candidate_change"


class CandidateExpectedValueMismatchError(CandidateDomainError):
    code = "candidate_expected_value_mismatch"


class CandidateArchivedStrategyError(CandidateDomainError):
    code = "candidate_archived_strategy"


class CandidatePersistenceError(CandidateDomainError):
    code = "candidate_persistence_failure"


class CandidateAdoptionLineageError(CandidateDomainError):
    code = "candidate_adoption_lineage_mismatch"
