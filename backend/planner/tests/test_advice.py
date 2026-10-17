from planner.domain.checkpoints import RiskSummary
from planner.domain.recommend import RouteScore
from planner.services.plan_service import advice_gain


def score(severe=0.0, high=0.0, avg=0.5, total=36000.0):
    miles = {"low": 100.0, "moderate": 0.0, "high": high, "severe": severe, "no_travel": 0.0, "unknown": 0.0}
    return RouteScore("A", 0, total, RiskSummary(miles, avg, 1.0, 1))


def test_advice_names_first_improving_key():
    assert advice_gain(score(severe=25), score(severe=0)) == "Severe miles 25 → 0"
    assert advice_gain(score(high=50), score(high=10)) == "High miles 50 → 10"
    assert advice_gain(score(avg=0.42), score(avg=0.1)) == "average risk 0.42 → 0.10"
    assert advice_gain(score(total=36000), score(total=34200)) == "30 min faster"
