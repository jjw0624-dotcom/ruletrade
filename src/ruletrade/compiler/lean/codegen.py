from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import date
from decimal import Decimal

from ruletrade.compiler.lean.plan import LeanPlan, LeanRandomSelection, normalize_lean_plan


@dataclass(frozen=True)
class CSharpGenerationSettings:
    algorithm_class: str = "RuleTradeGeneratedAlgorithm"
    start_date: date = date(2024, 1, 1)
    end_date: date = date(2024, 12, 31)
    initial_cash: Decimal = Decimal("100000")


def _csharp_string(value: str) -> str:
    return json.dumps(value, ensure_ascii=True)


def _decimal_literal(value: Decimal) -> str:
    return f'{format(value.normalize(), "f")}m'


def _seed_expression(plan: LeanPlan, selection: LeanRandomSelection) -> str:
    event_argument = "eventIdentity"
    if selection.resample == "once":
        event_argument = "null"
    return (
        "RuleTradeRandom.Seed("
        f"{_csharp_string(plan.strategy_identity)}, "
        f"{_csharp_string(selection.component_id)}, "
        f"{_csharp_string(selection.parameter_bindings_json)}, "
        f"{event_argument}, "
        f"{str(selection.resample == 'per_event').lower()})"
    )


def _random_helper_source() -> str:
    # This intentionally ports only the CPython operations used by
    # random.Random(seed).sample(pool, k): MT19937, getrandbits and _randbelow.
    return r'''
internal static class RuleTradeRandom
{
    public static ulong Seed(
        string strategyIdentity,
        string componentIdentity,
        string parameterBindingsJson,
        string eventIdentity,
        bool perEvent)
    {
        var eventPart = perEvent
            ? ",\"event_identity\":" + JsonSerializer.Serialize(eventIdentity)
            : "";
        var material = "{\"component_id\":" + JsonSerializer.Serialize(componentIdentity)
            + eventPart
            + ",\"parameter_bindings\":" + parameterBindingsJson
            + ",\"strategy\":" + JsonSerializer.Serialize(strategyIdentity) + "}";
        using (var sha = SHA256.Create())
        {
            var digest = sha.ComputeHash(Encoding.UTF8.GetBytes(material));
            return ((ulong)digest[0] << 56) | ((ulong)digest[1] << 48)
                | ((ulong)digest[2] << 40) | ((ulong)digest[3] << 32)
                | ((ulong)digest[4] << 24) | ((ulong)digest[5] << 16)
                | ((ulong)digest[6] << 8) | digest[7];
        }
    }

    public static List<string> Sample(string[] population, int count, ulong seed)
    {
        if (count < 0 || count > population.Length)
        {
            throw new ArgumentOutOfRangeException(nameof(count));
        }
        var random = new PythonRandom(seed);
        var pool = (string[])population.Clone();
        var result = new List<string>(count);
        for (var i = 0; i < count; i++)
        {
            var index = random.RandBelow(population.Length - i);
            result.Add(pool[index]);
            pool[index] = pool[population.Length - i - 1];
        }
        result.Sort(StringComparer.Ordinal);
        return result;
    }

    private sealed class PythonRandom
    {
        private const int N = 624;
        private const int M = 397;
        private readonly uint[] state = new uint[N];
        private int index = N;

        public PythonRandom(ulong seed)
        {
            var key = seed > uint.MaxValue
                ? new[] { (uint)seed, (uint)(seed >> 32) }
                : new[] { (uint)seed };
            InitByArray(key);
        }

        public int RandBelow(int upperExclusive)
        {
            var bits = BitLength(upperExclusive);
            uint value;
            do
            {
                value = GetRandBits(bits);
            }
            while (value >= upperExclusive);
            return (int)value;
        }

        private static int BitLength(int value)
        {
            var bits = 0;
            while (value != 0)
            {
                bits++;
                value >>= 1;
            }
            return bits;
        }

        private uint GetRandBits(int bits)
        {
            return NextUInt32() >> (32 - bits);
        }

        private void InitGenRand(uint seed)
        {
            state[0] = seed;
            for (index = 1; index < N; index++)
            {
                state[index] = unchecked(1812433253U * (state[index - 1] ^ (state[index - 1] >> 30))
                    + (uint)index);
            }
        }

        private void InitByArray(uint[] key)
        {
            InitGenRand(19650218U);
            var i = 1;
            var j = 0;
            var rounds = Math.Max(N, key.Length);
            for (; rounds > 0; rounds--)
            {
                state[i] = unchecked((state[i] ^ ((state[i - 1] ^ (state[i - 1] >> 30)) * 1664525U))
                    + key[j] + (uint)j);
                i++;
                j++;
                if (i >= N) { state[0] = state[N - 1]; i = 1; }
                if (j >= key.Length) { j = 0; }
            }
            for (var rounds2 = N - 1; rounds2 > 0; rounds2--)
            {
                state[i] = unchecked((state[i] ^ ((state[i - 1] ^ (state[i - 1] >> 30)) * 1566083941U))
                    - (uint)i);
                i++;
                if (i >= N) { state[0] = state[N - 1]; i = 1; }
            }
            state[0] = 0x80000000U;
            index = N;
        }

        private uint NextUInt32()
        {
            if (index >= N)
            {
                for (var i = 0; i < N; i++)
                {
                    var y = (state[i] & 0x80000000U) | (state[(i + 1) % N] & 0x7fffffffU);
                    state[i] = state[(i + M) % N] ^ (y >> 1) ^ ((y & 1U) == 0 ? 0U : 0x9908b0dfU);
                }
                index = 0;
            }
            var value = state[index++];
            value ^= value >> 11;
            value ^= (value << 7) & 0x9d2c5680U;
            value ^= (value << 15) & 0xefc60000U;
            value ^= value >> 18;
            return value;
        }
    }
}'''.strip()


def generate_csharp(
    plan: LeanPlan,
    settings: CSharpGenerationSettings = CSharpGenerationSettings(),
) -> str:
    """Generate a classic QCAlgorithm from a normalized, LEAN-specific plan."""

    plan = normalize_lean_plan(plan)
    if not settings.algorithm_class.isidentifier():
        raise ValueError("algorithm_class must be a valid identifier")

    selections = {item.id: item for item in plan.random_selections}
    momentum_selections = {item.id: item for item in plan.momentum_selections}
    sleeves = {item.id: item for item in plan.target_sleeves}
    rebalances = {item.id: item for item in plan.rebalances}
    has_source_sleeves = any(
        item.source_sleeve_component_id is not None for item in plan.target_sleeves
    )
    history_symbols = frozenset(
        symbol for selection in plan.momentum_selections for symbol in selection.symbols
    )
    has_subscription_only_assets = history_symbols != frozenset(
        subscription.symbol for subscription in plan.subscriptions
    )
    lines = [
        "using System;",
        "using System.Collections.Generic;",
        "using System.Globalization;",
        "using System.Linq;",
        "using QuantConnect;",
        "using QuantConnect.Algorithm;",
        "using QuantConnect.Data;",
    ]
    if plan.momentum_selections:
        lines.append("using QuantConnect.Indicators;")
    if plan.random_selections:
        lines[4:4] = [
            "using System.Security.Cryptography;",
            "using System.Text;",
            "using System.Text.Json;",
        ]
    lines.extend([
        "",
        f"public class {settings.algorithm_class} : QCAlgorithm",
        "{",
        "    private readonly Dictionary<string, Symbol> _symbols = new Dictionary<string, Symbol>();",
    ])
    if plan.momentum_selections:
        history_capacity = max(item.lookback_bars for item in plan.momentum_selections) + 1
        lines.append(
            "    private readonly Dictionary<string, RollingWindow<decimal>> "
            "_dailyCloses = new Dictionary<string, RollingWindow<decimal>>();"
        )
    for index in range(len(plan.monthly_events)):
        lines.append(f"    private string _pendingEvent{index};")
    lines.extend(
        (
            "",
            "    public override void Initialize()",
            "    {",
            (
                f"        SetStartDate({settings.start_date.year}, {settings.start_date.month}, "
                f"{settings.start_date.day});"
            ),
            (
                f"        SetEndDate({settings.end_date.year}, {settings.end_date.month}, "
                f"{settings.end_date.day});"
            ),
            f"        SetCash({_decimal_literal(settings.initial_cash)});",
        )
    )
    for subscription_index, subscription in enumerate(plan.subscriptions):
        ticker = _csharp_string(subscription.symbol)
        if plan.momentum_selections:
            security_variable = f"security{subscription_index}"
            lines.extend(
                (
                    f"        var {security_variable} = AddEquity({ticker}, Resolution.Daily, "
                    "dataNormalizationMode: DataNormalizationMode.Adjusted);",
                    f"        _symbols[{ticker}] = {security_variable}.Symbol;",
                )
            )
            if subscription.symbol in history_symbols:
                lines.append(
                    f"        _dailyCloses[{ticker}] = "
                    f"new RollingWindow<decimal>({history_capacity});"
                )
        else:
            lines.append(f"        _symbols[{ticker}] = AddEquity({ticker}, Resolution.Daily).Symbol;")
    if plan.momentum_selections:
        warm_up_bars = max(item.lookback_bars for item in plan.momentum_selections)
        lines.append(f"        SetWarmUp({warm_up_bars}, Resolution.Daily);")
    for index, event in enumerate(plan.monthly_events):
        anchor = _csharp_string(event.anchor_symbol)
        lines.append(
            "        Schedule.On("
            f"DateRules.MonthStart(_symbols[{anchor}], {event.day - 1}), "
            f"TimeRules.AfterMarketOpen(_symbols[{anchor}], 1), QueueEvent{index});"
        )
    lines.extend(("    }", ""))

    for event_index, event in enumerate(plan.monthly_events):
        lines.extend(
            (
                f"    private void QueueEvent{event_index}()",
                "    {",
                (
                    f"        _pendingEvent{event_index} = "
                    'Time.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);'
                ),
                "    }",
                "",
            )
        )

    lines.extend(("    public override void OnData(Slice slice)", "    {"))
    if plan.momentum_selections:
        if has_subscription_only_assets:
            tickers = ", ".join(_csharp_string(item) for item in sorted(history_symbols))
            lines.extend(
                (
                    f"        foreach (var ticker in new[] {{ {tickers} }})",
                    "        {",
                    "            var symbol = _symbols[ticker];",
                    "            if (slice.Bars.TryGetValue(symbol, out var bar))",
                    "            {",
                    "                _dailyCloses[ticker].Add(bar.Close);",
                    "            }",
                    "        }",
                    "        if (IsWarmingUp) return;",
                )
            )
        else:
            lines.extend(
                (
                    "        foreach (var item in _symbols)",
                    "        {",
                    "            if (slice.Bars.TryGetValue(item.Value, out var bar))",
                    "            {",
                    "                _dailyCloses[item.Key].Add(bar.Close);",
                    "            }",
                    "        }",
                    "        if (IsWarmingUp) return;",
                )
            )
    for event_index in range(len(plan.monthly_events)):
        lines.extend(
            (
                (
                    f"        if (_pendingEvent{event_index} != null "
                    f"&& Event{event_index}DataIsReady(slice))"
                ),
                "        {",
                f"            var eventIdentity = _pendingEvent{event_index};",
                f"            _pendingEvent{event_index} = null;",
                f"            ExecuteEvent{event_index}(eventIdentity);",
                "        }",
            )
        )
    lines.extend(("    }", ""))

    for event_index, event in enumerate(plan.monthly_events):
        tickers = ", ".join(_csharp_string(item) for item in event.execution.required_symbols)
        lines.extend(
            (
                f"    private bool Event{event_index}DataIsReady(Slice slice)",
                "    {",
                f"        return new[] {{ {tickers} }}.All(ticker =>",
                "        {",
                "            var symbol = _symbols[ticker];",
                (
                    "            return slice.Bars.ContainsKey(symbol) "
                    "&& Securities[symbol].HasData && Securities[symbol].Price > 0m;"
                ),
                "        });",
                "    }",
                "",
            )
        )

    for event_index, event in enumerate(plan.monthly_events):
        lines.extend((f"    private void ExecuteEvent{event_index}(string eventIdentity)", "    {"))
        for rebalance_index, rebalance_id in enumerate(event.rebalance_ids):
            rebalance = rebalances[rebalance_id]
            targets_variable = f"targets{event_index}_{rebalance_index}"
            selected_variable = f"selectedTickers{event_index}_{rebalance_index}"
            lines.extend(
                (
                    f"        var {targets_variable} = new Dictionary<Symbol, decimal>();",
                    f"        var {selected_variable} = new List<string>();",
                )
            )
            for sleeve_index, sleeve_id in enumerate(rebalance.sleeve_ids):
                sleeve = sleeves[sleeve_id]
                variable = f"sleeve{event_index}_{rebalance_index}_{sleeve_index}"
                weight_variable = f"weight{event_index}_{rebalance_index}_{sleeve_index}"
                if sleeve.selection_id is None:
                    symbols = ", ".join(_csharp_string(item) for item in sleeve.symbols)
                    lines.append(f"        var {variable} = new[] {{ {symbols} }};")
                else:
                    if sleeve.selection_id in selections:
                        selection = selections[sleeve.selection_id]
                        symbols = ", ".join(_csharp_string(item) for item in selection.symbols)
                        lines.append(
                            f"        var {variable} = RuleTradeRandom.Sample("
                            f"new[] {{ {symbols} }}, {selection.count}, {_seed_expression(plan, selection)});"
                        )
                    else:
                        selection = momentum_selections[sleeve.selection_id]
                        symbols = ", ".join(_csharp_string(item) for item in selection.symbols)
                        scores_variable = f"scores{event_index}_{rebalance_index}_{sleeve_index}"
                        ranked_variable = f"ranked{event_index}_{rebalance_index}_{sleeve_index}"
                        lines.extend(
                            (
                                f"        var {scores_variable} = new Dictionary<string, decimal>();",
                                f"        foreach (var ticker in new[] {{ {symbols} }})",
                                "        {",
                                "            var window = _dailyCloses[ticker];",
                                f"            if (window.Count >= {selection.lookback_bars + 1} && window[{selection.lookback_bars}] != 0m)",
                                "            {",
                                f"                {scores_variable}[ticker] = window[0] / window[{selection.lookback_bars}] - 1m;",
                                "            }",
                                "        }",
                            )
                        )
                        ranking_input = scores_variable
                        if selection.filter_threshold is not None:
                            eligible_variable = (
                                f"eligibleScores{event_index}_{rebalance_index}_{sleeve_index}"
                            )
                            threshold = _decimal_literal(selection.filter_threshold)
                            lines.extend(
                                (
                                    f"        var {eligible_variable} = {scores_variable}",
                                    f"            .Where(item => item.Value > {threshold})",
                                    "            .ToDictionary(item => item.Key, item => item.Value);",
                                    f'        Debug("RULETRADE_FILTER|" + eventIdentity + "|threshold=" + {threshold}.ToString("G29", CultureInfo.InvariantCulture)',
                                    f'            + "|eligible=" + string.Join(",", {eligible_variable}.Keys.OrderBy(item => item))',
                                    f'            + "|rejected=" + string.Join(",", {scores_variable}.Keys.Except({eligible_variable}.Keys).OrderBy(item => item)));',
                                )
                            )
                            ranking_input = eligible_variable
                        lines.extend(
                            (
                                f"        var {ranked_variable} = {ranking_input}",
                                "            .OrderByDescending(item => item.Value)",
                                "            .ThenBy(item => item.Key, StringComparer.Ordinal)",
                                "            .ToList();",
                                f"        var {variable} = {ranked_variable}.Take({selection.count}).Select(item => item.Key).ToList();",
                            )
                        )
                        eligible_count_variable = (
                            ranking_input
                            if selection.filter_threshold is not None
                            else variable
                        )
                        if selection.filter_threshold is not None:
                            insufficient_decision = (
                                "insufficient" if sleeve.fallback_symbols else "skipped"
                            )
                            lines.extend(
                                (
                                    '        Debug("RULETRADE_MOMENTUM|" + eventIdentity',
                                    f'            + "|scores=" + string.Join(",", {scores_variable}.OrderBy(item => item.Key)',
                                    '                .Select(item => item.Key + "=" + item.Value.ToString("G29", CultureInfo.InvariantCulture)))',
                                    f'            + "|ranked=" + string.Join(",", {ranked_variable}.Select(item => item.Key))',
                                    f'            + "|candidate=" + string.Join(",", {variable})',
                                    f'            + "|selected=" + ({variable}.Count == {selection.count} ? string.Join(",", {variable}) : "")',
                                    f'            + "|decision=" + ({variable}.Count == {selection.count} ? "executed" : "{insufficient_decision}"));',
                                )
                            )
                        if sleeve.fallback_symbols:
                            fallback_symbol = _csharp_string(sleeve.fallback_symbols[0])
                            fallback_component = _csharp_string(
                                sleeve.fallback_component_id or ""
                            )
                            fallback_activated = (
                                f"fallbackActivated{event_index}_{rebalance_index}_{sleeve_index}"
                            )
                            lines.extend(
                                (
                                    f"        var {fallback_activated} = {variable}.Count < {selection.count};",
                                    f"        if ({fallback_activated})",
                                    "        {",
                                    f"            {variable} = new List<string> {{ {fallback_symbol} }};",
                                    f'            Debug("RULETRADE_FALLBACK|" + eventIdentity + "|component=" + {fallback_component} + "|asset=" + {fallback_symbol} + "|decision=activated");',
                                    "        }",
                                    "        else",
                                    "        {",
                                    f'            Debug("RULETRADE_FALLBACK|" + eventIdentity + "|component=" + {fallback_component} + "|asset=" + {fallback_symbol} + "|decision=not_activated");',
                                    "        }",
                                    f'        Debug("RULETRADE_FINAL|" + eventIdentity + "|selected=" + string.Join(",", {variable})',
                                    f'            + "|decision=executed|source=" + ({fallback_activated} ? "fallback" : "primary"));',
                                )
                            )
                        else:
                            lines.extend(
                                (
                                    f"        if ({variable}.Count < {selection.count})",
                                    "        {",
                                    f'            Debug("RULETRADE_MOMENTUM_SKIPPED|" + eventIdentity + "|eligible=" + {eligible_count_variable}.Count + "|required={selection.count}");',
                                    "            return;",
                                    "        }",
                                )
                            )
                        if selection.filter_threshold is None:
                            lines.extend(
                                (
                                    '        Debug("RULETRADE_MOMENTUM|" + eventIdentity',
                                    f'            + "|scores=" + string.Join(",", {scores_variable}.OrderBy(item => item.Key)',
                                    '                .Select(item => item.Key + "=" + item.Value.ToString("G29", CultureInfo.InvariantCulture)))',
                                    f'            + "|ranked=" + string.Join(",", {ranked_variable}.Select(item => item.Key))',
                                    f'            + "|selected=" + string.Join(",", {variable}));',
                                )
                            )
                    lines.append(f"        {selected_variable}.AddRange({variable});")
                weight = _decimal_literal(sleeve.total_weight)
                lines.extend(
                    (
                        f"        var {weight_variable} = {weight} / {variable}.Count();",
                        f"        foreach (var ticker in {variable})",
                        "        {",
                        "            var symbol = _symbols[ticker];",
                        (
                            f"            {targets_variable}[symbol] = "
                            f"{targets_variable}.ContainsKey(symbol) ? "
                            f"{targets_variable}[symbol] + {weight_variable} : {weight_variable};"
                        ),
                        "        }",
                    )
                )
                if sleeve.source_sleeve_component_id is not None:
                    local_total = _decimal_literal(
                        sleeve.local_total_weight or Decimal(1)
                    )
                    allocation = _decimal_literal(
                        sleeve.source_allocation or Decimal(1)
                    )
                    local_weight_variable = (
                        f"localWeight{event_index}_{rebalance_index}_{sleeve_index}"
                    )
                    sleeve_component = _csharp_string(
                        sleeve.source_sleeve_component_id
                    )
                    lines.extend(
                        (
                            f"        var {local_weight_variable} = {local_total} / {variable}.Count();",
                            f'        Debug("RULETRADE_SLEEVE|" + eventIdentity + "|sleeve=" + {sleeve_component}',
                            f'            + "|local_selected=" + string.Join(",", {variable}.OrderBy(item => item))',
                            f'            + "|local_weights=" + string.Join(",", {variable}.OrderBy(item => item)',
                            f'                .Select(item => item + "=" + {local_weight_variable}.ToString("G29", CultureInfo.InvariantCulture)))',
                            f'            + "|allocation=" + {allocation}.ToString("G29", CultureInfo.InvariantCulture)',
                            f'            + "|scaled=" + string.Join(",", {variable}.OrderBy(item => item)',
                            f'                .Select(item => item + "=" + {weight_variable}.ToString("G29", CultureInfo.InvariantCulture))));',
                        )
                    )
            lines.extend(
                (
                    "        foreach (var holding in Portfolio.Values.Where(item => item.Invested))",
                    "        {",
                    (
                        f"            if (!{targets_variable}.ContainsKey(holding.Symbol)) "
                        "Liquidate(holding.Symbol);"
                    ),
                    "        }",
                    (
                        f"        foreach (var target in {targets_variable}) "
                        "SetHoldings(target.Key, target.Value);"
                    ),
                    (
                        '        Debug("RULETRADE_TARGETS|" + eventIdentity'
                    ),
                    (
                        f'            + "|selected=" + string.Join(",", '
                        + (
                            f"{targets_variable}.Where(item => item.Value != 0m)"
                            ".Select(item => item.Key.Value)"
                            if has_source_sleeves
                            else selected_variable
                        )
                        + ".OrderBy(item => item, StringComparer.Ordinal))"
                    ),
                    (
                        f'            + "|weights=" + string.Join(",", {targets_variable}'
                        ".OrderBy(item => item.Key.Value)"
                    ),
                    (
                        '                .Select(item => item.Key.Value + "=" + '
                        "item.Value.ToString(CultureInfo.InvariantCulture))));"
                    ),
                )
            )
        lines.extend(("    }", ""))

    lines.append("}")
    if plan.random_selections:
        lines.extend(("", _random_helper_source(), ""))
    else:
        lines.append("")
    return "\n".join(lines)
