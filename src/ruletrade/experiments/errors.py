class ResearchExperimentError(Exception):
    code = "research_experiment_error"


class InvalidExperimentSpecError(ResearchExperimentError):
    code = "invalid_experiment_spec"


class ExperimentNotFoundError(ResearchExperimentError):
    code = "experiment_not_found"
