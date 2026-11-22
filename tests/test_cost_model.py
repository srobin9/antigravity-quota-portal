"""Unit tests for cost modeling, hinge points, and credit mechanics."""

from app.core.cost_model import (
    calculate_blended_rate_per_million,
    calculate_model_spend,
    calculate_total_usage_costs,
    find_fallback_models,
    match_model_pricing,
    match_model_pricing_with_meta,
)
from app.db.models import DEFAULT_MODEL_PRICING, load_default_model_pricing


def test_load_default_model_pricing_from_external_config():
    pricing_map = load_default_model_pricing()
    assert len(pricing_map) == 17
    assert "gemini-4-carbon" in pricing_map
    assert "gemini-4-neon" in pricing_map
    assert "gemini-4-argon" in pricing_map
    assert "gemini-4-hydrogen" in pricing_map
    assert "gemini-3-pro" in pricing_map
    assert "gemini-3.8-flash" in pricing_map
    assert "claude-opus-5.5" in pricing_map
    assert "claude-sonnet-5.5" in pricing_map
    assert pricing_map["gemini-4-carbon"].display_name == "Gemini 4 Carbon"
    assert pricing_map["gemini-4-carbon"].log_pattern == "%4-carbon%"
    assert pricing_map["gemini-4-carbon"].input_price_per_million == 2.00
    assert pricing_map["gemini-4-carbon"].output_price_per_million == 10.00
    assert pricing_map["gemini-4-carbon"].cached_price_per_million == 0.10
    assert pricing_map["gemini-4-neon"].display_name == "Gemini 4 Neon"
    assert pricing_map["gemini-4-neon"].log_pattern == "%4-neon%"
    assert pricing_map["gemini-4-neon"].input_price_per_million == 3.00
    assert pricing_map["gemini-4-neon"].output_price_per_million == 15.00
    assert pricing_map["gemini-4-neon"].cached_price_per_million == 0.15
    assert pricing_map["gemini-4-argon"].display_name == "Gemini 4 Argon"
    assert pricing_map["gemini-4-argon"].log_pattern == "%4-argon%"
    assert pricing_map["gemini-4-argon"].input_price_per_million == 1.25
    assert pricing_map["gemini-4-argon"].output_price_per_million == 10.00
    assert pricing_map["gemini-4-argon"].cached_price_per_million == 0.125
    assert pricing_map["gemini-4-hydrogen"].display_name == "Gemini 4 Hydrogen"
    assert pricing_map["gemini-4-hydrogen"].log_pattern == "%4-hydrogen%"
    assert pricing_map["gemini-4-hydrogen"].input_price_per_million == 1.50
    assert pricing_map["gemini-4-hydrogen"].output_price_per_million == 7.50
    assert pricing_map["gemini-4-hydrogen"].cached_price_per_million == 0.075
    assert pricing_map["gemini-3-pro"].input_price_per_million == 2.00
    assert pricing_map["gemini-3-pro"].input_price_gt_threshold_per_million == 4.00
    assert pricing_map["gemini-3.8-flash"].input_price_per_million == 0.75
    assert pricing_map["gemini-3.8-flash"].input_price_gt_threshold_per_million is None


def test_match_model_pricing():
    # Exact and pattern matching tests
    pricing_carbon = match_model_pricing("models/gemini-4-carbon-high", DEFAULT_MODEL_PRICING)
    assert pricing_carbon.display_name == "Gemini 4 Carbon"
    assert pricing_carbon.input_price_per_million == 2.00
    assert pricing_carbon.output_price_per_million == 10.00
    assert pricing_carbon.cached_price_per_million == 0.10

    pricing_neon = match_model_pricing("gemini-4-neon-xhigh", DEFAULT_MODEL_PRICING)
    assert pricing_neon.display_name == "Gemini 4 Neon"
    assert pricing_neon.input_price_per_million == 3.00
    assert pricing_neon.output_price_per_million == 15.00
    assert pricing_neon.cached_price_per_million == 0.15

    pricing_argon = match_model_pricing("models/gemini-4-argon-medium", DEFAULT_MODEL_PRICING)
    assert pricing_argon.display_name == "Gemini 4 Argon"
    assert pricing_argon.input_price_per_million == 1.25
    assert pricing_argon.output_price_per_million == 10.00
    assert pricing_argon.cached_price_per_million == 0.125

    pricing_hydrogen = match_model_pricing("models/gemini-4-hydrogen-preview", DEFAULT_MODEL_PRICING)
    assert pricing_hydrogen.display_name == "Gemini 4 Hydrogen"
    assert pricing_hydrogen.input_price_per_million == 1.50
    assert pricing_hydrogen.output_price_per_million == 7.50
    assert pricing_hydrogen.cached_price_per_million == 0.075

    pricing = match_model_pricing("gemini-3-pro", DEFAULT_MODEL_PRICING)
    assert pricing.display_name == "Gemini 3.1 Pro / 3.0 Pro"

    pricing_31_pro = match_model_pricing("models/gemini-3.1-pro-preview", DEFAULT_MODEL_PRICING)
    assert pricing_31_pro.display_name == "Gemini 3.1 Pro / 3.0 Pro"

    pricing_30_pro = match_model_pricing("gemini-3.0-pro", DEFAULT_MODEL_PRICING)
    assert pricing_30_pro.display_name == "Gemini 3.1 Pro / 3.0 Pro"

    pricing_30_flash = match_model_pricing("gemini-3.0-flash", DEFAULT_MODEL_PRICING)
    assert pricing_30_flash.display_name == "Gemini 3 Flash"

    pricing_38 = match_model_pricing("models/gemini-3.8-flash-high", DEFAULT_MODEL_PRICING)
    assert pricing_38.display_name == "Gemini 3.8 Flash"

    pricing_37 = match_model_pricing("models/gemini-3.7-flash-medium", DEFAULT_MODEL_PRICING)
    assert pricing_37.display_name == "Gemini 3.7 Flash"

    pricing_flash = match_model_pricing("models/gemini-3.6-flash-preview", DEFAULT_MODEL_PRICING)
    assert pricing_flash.display_name == "Gemini 3.6 Flash"

    pricing_opus = match_model_pricing("claude-opus-5.5-high", DEFAULT_MODEL_PRICING)
    assert pricing_opus.display_name == "Claude Opus 5.5"

    pricing_fallback = match_model_pricing("unknown-custom-model", DEFAULT_MODEL_PRICING)
    assert pricing_fallback.display_name == "Default Model Fallback"


def test_calculate_blended_rate():
    pricing = DEFAULT_MODEL_PRICING["gemini-3-pro"]
    # 0.70 * 2.00 + 0.20 * 12.00 + 0.10 * 0.20 = 1.40 + 2.40 + 0.02 = 3.82
    rate = calculate_blended_rate_per_million(pricing)
    assert round(rate, 3) == 3.82


def test_calculate_model_spend():
    pricing = DEFAULT_MODEL_PRICING["gemini-3-pro"]
    # 1,000,000 tokens of gemini-3-pro (fallback blended rate)
    gross_spend, breakdown = calculate_model_spend(1_000_000, pricing)
    assert gross_spend == 3.82
    assert breakdown.input_spend_usd == 1.40
    assert breakdown.output_spend_usd == 2.40
    assert breakdown.cached_spend_usd == 0.02


def test_calculate_total_usage_costs_under_quota():
    tokens = {
        "gemini-3-pro": 2_000_000,  # 2M * 3.82 = $7.64
    }
    quota = 10.00
    overage = 2.00
    (
        gross_spend,
        remaining_credit,
        net_billable,
        breakdown,
        spend_by_model,
        utilization_pct,
        is_throttled,
    ) = calculate_total_usage_costs(tokens, DEFAULT_MODEL_PRICING, quota, overage)

    assert gross_spend == 7.64
    assert remaining_credit == 2.36
    assert net_billable == 0.00
    assert utilization_pct == 76.4
    assert is_throttled is False


def test_calculate_total_usage_costs_in_overage_buffer():
    tokens = {
        "gemini-3-pro": 3_000_000,  # 3M * 3.82 = $11.46
    }
    quota = 10.00
    overage = 2.00  # Hard limit is $12.00
    (
        gross_spend,
        remaining_credit,
        net_billable,
        breakdown,
        spend_by_model,
        utilization_pct,
        is_throttled,
    ) = calculate_total_usage_costs(tokens, DEFAULT_MODEL_PRICING, quota, overage)

    assert gross_spend == 11.46
    assert remaining_credit == 0.00
    assert net_billable == 1.46
    assert utilization_pct == 114.6
    assert is_throttled is False  # $11.46 < $12.00


def test_calculate_total_usage_costs_hard_breach():
    tokens = {
        "gemini-3-pro": 4_000_000,  # 4M * 3.82 = $15.28
    }
    quota = 10.00
    overage = 2.00  # Hard limit is $12.00
    (
        gross_spend,
        remaining_credit,
        net_billable,
        breakdown,
        spend_by_model,
        utilization_pct,
        is_throttled,
    ) = calculate_total_usage_costs(tokens, DEFAULT_MODEL_PRICING, quota, overage)

    assert gross_spend == 15.28
    assert remaining_credit == 0.00
    assert net_billable == 5.28
    assert is_throttled is True  # $15.28 >= $12.00


def test_calculate_model_spend_with_granular_tokens():
    pricing = DEFAULT_MODEL_PRICING["gemini-3-pro"]
    # promptTokenCount=800_000 (includes 100_000 cached), candidatesTokenCount=150_000, thoughtsTokenCount=50_000
    # Effective Input = 800k - 100k = 700k * $2.00 / 1M = $1.40
    # Output + Thoughts = 150k + 50k = 200k * $12.00 / 1M = $2.40
    # Cached = 100k * $0.20 / 1M = $0.02
    # Total = $3.82
    gross_spend, breakdown = calculate_model_spend(
        token_count=1_000_000,
        pricing=pricing,
        prompt_tokens=800_000,
        candidates_tokens=150_000,
        cached_tokens=100_000,
        thoughts_tokens=50_000,
        fallback_tokens=0,
    )
    assert gross_spend == 3.82
    assert breakdown.input_spend_usd == 1.40
    assert breakdown.output_spend_usd == 2.40
    assert breakdown.cached_spend_usd == 0.02
    assert breakdown.input_tokens == 700_000
    assert breakdown.output_tokens == 200_000
    assert breakdown.cached_tokens == 100_000
    assert breakdown.thoughts_tokens == 50_000


def test_calculate_model_spend_with_gt_200k_context_tier():
    pricing = DEFAULT_MODEL_PRICING["gemini-3-pro"]
    # Suppose 1,000,000 total tokens split evenly between <=200k calls and >200k calls:
    # - <=200k: 350k uncached in ($2/1M = $0.70), 50k cached ($0.20/1M = $0.01), 100k out ($12/1M = $1.20) -> $1.91
    # - >200k:  350k uncached in ($4/1M = $1.40), 50k cached ($0.40/1M = $0.02), 100k out ($18/1M = $1.80) -> $3.22
    # Total expected = $5.13
    gross_spend, breakdown = calculate_model_spend(
        token_count=1_000_000,
        pricing=pricing,
        prompt_tokens=800_000,
        candidates_tokens=150_000,
        cached_tokens=100_000,
        thoughts_tokens=50_000,
        prompt_tokens_gt_200k=400_000,
        candidates_tokens_gt_200k=75_000,
        cached_tokens_gt_200k=50_000,
        thoughts_tokens_gt_200k=25_000,
        fallback_tokens=0,
    )
    assert gross_spend == 5.13
    assert breakdown.input_spend_usd == 2.10
    assert breakdown.output_spend_usd == 3.00
    assert breakdown.cached_spend_usd == 0.03


def test_gemini_4_argon_spend_calculation():
    pricing = DEFAULT_MODEL_PRICING["gemini-4-argon"]
    # Blended rate: 0.70 * 1.25 + 0.20 * 10.00 + 0.10 * 0.125 = 0.875 + 2.00 + 0.0125 = 2.8875
    rate = calculate_blended_rate_per_million(pricing)
    assert round(rate, 4) == 2.8875
    gross_spend, breakdown = calculate_model_spend(
        token_count=1_000_000,
        pricing=pricing,
        prompt_tokens=800_000,
        candidates_tokens=150_000,
        cached_tokens=100_000,
        thoughts_tokens=50_000,
        fallback_tokens=0,
    )
    # Effective input = 700k * 1.25 / 1M = 0.875
    # Output + thoughts = 200k * 10.00 / 1M = 2.00
    # Cached = 100k * 0.125 / 1M = 0.0125
    assert gross_spend == 2.8875
    assert breakdown.input_spend_usd == 0.875
    assert breakdown.output_spend_usd == 2.00
    assert breakdown.cached_spend_usd == 0.0125


def test_gemini_4_carbon_neon_hydrogen_spend_calculation():
    # Carbon: 0.70*2.00 + 0.20*10.00 + 0.10*0.10 = 1.40 + 2.00 + 0.01 = 3.41
    carbon_pricing = DEFAULT_MODEL_PRICING["gemini-4-carbon"]
    assert round(calculate_blended_rate_per_million(carbon_pricing), 4) == 3.41
    carbon_spend, _ = calculate_model_spend(
        token_count=1_000_000,
        pricing=carbon_pricing,
        prompt_tokens=800_000,
        candidates_tokens=150_000,
        cached_tokens=100_000,
        thoughts_tokens=50_000,
        fallback_tokens=0,
    )
    assert carbon_spend == 3.41

    # Neon: 0.70*3.00 + 0.20*15.00 + 0.10*0.15 = 2.10 + 3.00 + 0.015 = 5.115
    neon_pricing = DEFAULT_MODEL_PRICING["gemini-4-neon"]
    assert round(calculate_blended_rate_per_million(neon_pricing), 4) == 5.115
    neon_spend, _ = calculate_model_spend(
        token_count=1_000_000,
        pricing=neon_pricing,
        prompt_tokens=800_000,
        candidates_tokens=150_000,
        cached_tokens=100_000,
        thoughts_tokens=50_000,
        fallback_tokens=0,
    )
    assert neon_spend == 5.115

    # Hydrogen: 0.80*1.50 + 0.15*7.50 + 0.05*0.075 = 1.20 + 1.125 + 0.00375 = 2.32875
    hydrogen_pricing = DEFAULT_MODEL_PRICING["gemini-4-hydrogen"]
    assert round(calculate_blended_rate_per_million(hydrogen_pricing), 5) == 2.32875


def test_match_model_pricing_with_meta_and_find_fallback_models(caplog):
    pricing_carbon, used_fb_carbon = match_model_pricing_with_meta(
        "models/gemini-4-carbon", DEFAULT_MODEL_PRICING
    )
    assert pricing_carbon.display_name == "Gemini 4 Carbon"
    assert used_fb_carbon is False

    pricing_unknown, used_fb_unknown = match_model_pricing_with_meta(
        "gemini-4-xenon", DEFAULT_MODEL_PRICING
    )
    assert pricing_unknown.display_name == "Default Model Fallback"
    assert used_fb_unknown is True

    _, used_fb_explicit = match_model_pricing_with_meta("default_fallback", DEFAULT_MODEL_PRICING)
    assert used_fb_explicit is True

    fallbacks = find_fallback_models(
        {
            "gemini-4-carbon": 500_000,
            "gemini-4-xenon": 200_000,
            "zero-token-unknown": 0,
            "models/custom-mystery-model": 100_000,
        },
        DEFAULT_MODEL_PRICING,
    )
    assert fallbacks == ["gemini-4-xenon", "models/custom-mystery-model"]

    with caplog.at_level("WARNING", logger="app.core.cost_model"):
        calculate_total_usage_costs(
            {"gemini-4-xenon": 100_000, "gemini-4-carbon": 100_000},
            DEFAULT_MODEL_PRICING,
            quota_credits=10.0,
            overage_buffer=2.0,
        )
    assert "gemini-4-xenon" in caplog.text
    assert "default_fallback" in caplog.text
    assert "gemini-4-carbon" not in caplog.text




