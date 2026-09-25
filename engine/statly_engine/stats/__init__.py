"""Statly statistics engine (SPEC §8). See stats/README.md for how to add an analysis."""
from statly_engine.stats import anova, posthoc_param  # noqa: E402,F401  (registers the ANOVA family)
from statly_engine.stats import categorical, correlation, reliability  # noqa: E402,F401  (registers correlation, categorical, reliability)
from statly_engine.stats import nonparametric, posthoc_rank  # noqa: E402,F401  (registers the nonparametric family)
