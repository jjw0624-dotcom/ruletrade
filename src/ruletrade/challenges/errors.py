class ChallengeSubmissionError(Exception):
    code = "challenge_submission_error"


class ChallengeNotFoundError(ChallengeSubmissionError):
    code = "challenge_not_found"


class ChallengeSubmissionNotFoundError(ChallengeSubmissionError):
    code = "challenge_submission_not_found"


class ChallengeSubmissionPersistenceError(ChallengeSubmissionError):
    code = "challenge_submission_persistence_failure"


class InvalidChallengeSubmissionError(ChallengeSubmissionError):
    code = "invalid_challenge_submission"
