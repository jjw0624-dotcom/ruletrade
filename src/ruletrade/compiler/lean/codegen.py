from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import date
from decimal import Decimal

from ruletrade.compiler.lean.plan import (
    LeanDailyEvent,
    LeanPlan,
    LeanQuarterlyEvent,
    LeanRandomSelection,
    normalize_lean_plan,
)


@dataclass(frozen=True)
class CSharpGenerationSettings:
    algorithm_class: str = "RuleTradeGeneratedAlgorithm"
    start_date: date = date(2024, 1, 1)
    end_date: date = date(2024, 12, 31)
    initial_cash: Decimal = Decimal("100000")


def _csharp_string(value: str) -> str:
    return json.dumps(value, ensure_ascii=True)


def _decimal_literal(value: Decimal) -> str:
    literal = f'{format(value.normalize(), "f")}m'
    # Member access binds before unary minus in C#. Parenthesize negative literals
    # so both arithmetic use and generated ``literal.ToString(...)`` remain numeric.
    return f"({literal})" if value < 0 else literal


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
    snapshot_indexes = {
        snapshot.id: index for index, snapshot in enumerate(plan.target_snapshots)
    }
    cooldown_indexes = {
        state.id: index for index, state in enumerate(plan.cooldown_states)
    }
    scheduled_events = tuple(
        sorted(
            (*plan.daily_events, *plan.monthly_events, *plan.quarterly_events),
            key=lambda item: item.id,
        )
    )
    has_source_sleeves = bool(plan.target_snapshots) or any(
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
        "    private int _decisionEvidenceSequence;",
    ])
    if plan.momentum_selections:
        history_capacity = max(item.lookback_bars for item in plan.momentum_selections) + 1
        lines.append(
            "    private readonly Dictionary<string, RollingWindow<decimal>> "
            "_dailyCloses = new Dictionary<string, RollingWindow<decimal>>();"
        )
    for index in range(len(scheduled_events)):
        lines.append(f"    private string _pendingEvent{index};")
    for index in range(len(plan.target_snapshots)):
        lines.extend(
            (
                f"    private Dictionary<string, decimal> _targetSnapshot{index};",
                f"    private string _targetSnapshotTimestamp{index};",
            )
        )
    if plan.cooldown_states:
        lines.extend(
            (
                "    private int _tradingSessionIndex = -1;",
                "    private DateTime _lastTradingSessionDate = DateTime.MinValue;",
            )
        )
    for index in range(len(plan.cooldown_states)):
        lines.extend(
            (
                f"    private readonly Dictionary<string, int> _lastExitSession{index} = new Dictionary<string, int>();",
                f"    private readonly Dictionary<string, string> _lastExitDate{index} = new Dictionary<string, string>();",
                f"    private readonly Dictionary<string, decimal> _previousTargets{index} = new Dictionary<string, decimal>();",
            )
        )
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
    for index, event in enumerate(scheduled_events):
        anchor = _csharp_string(event.anchor_symbol)
        date_rule = (
            f"DateRules.EveryDay(_symbols[{anchor}])"
            if isinstance(event, LeanDailyEvent)
            else f"DateRules.MonthStart(_symbols[{anchor}], {event.day - 1})"
        )
        lines.append(
            f"        Schedule.On({date_rule}, "
            f"TimeRules.AfterMarketOpen(_symbols[{anchor}], 1), QueueEvent{index});"
        )
    lines.extend(
        (
            "    }",
            "",
            "    private void EmitDecisionEvidence(string session, string phase, string kind, params string[] fields)",
            "    {",
            "        if (fields.Length % 2 != 0) throw new ArgumentException(\"Evidence fields must be key/value pairs.\");",
            "        _decisionEvidenceSequence++;",
            "        var parts = new List<string>",
            "        {",
            "            \"sequence=\" + _decisionEvidenceSequence.ToString(CultureInfo.InvariantCulture),",
            "            \"session=\" + Uri.EscapeDataString(session),",
            "            \"phase=\" + Uri.EscapeDataString(phase),",
            "            \"kind=\" + Uri.EscapeDataString(kind)",
            "        };",
            "        for (var index = 0; index < fields.Length; index += 2)",
            "        {",
            "            parts.Add(Uri.EscapeDataString(fields[index]) + \"=\" + Uri.EscapeDataString(fields[index + 1] ?? \"\"));",
            "        }",
            "        Debug(\"RULETRADE_EVIDENCE_V2|\" + string.Join(\"|\", parts));",
            "    }",
            "",
            "    private static string EvidenceRanks(IEnumerable<string> ranked)",
            "    {",
            "        return string.Join(\",\", ranked.Select((asset, index) => asset + \"=\" + (index + 1).ToString(CultureInfo.InvariantCulture)));",
            "    }",
            "",
            "    private static string EvidenceSelectionStops(IEnumerable<string> ranked, IEnumerable<string> candidates, bool primaryComplete, bool fallbackConfigured)",
            "    {",
            "        var candidateSet = new HashSet<string>(candidates, StringComparer.Ordinal);",
            "        return string.Join(\",\", ranked.Select(asset =>",
            "        {",
            "            if (!candidateSet.Contains(asset)) return asset + \"=rank_cutoff\";",
            "            if (!primaryComplete) return asset + (fallbackConfigured ? \"=fallback_replacement\" : \"=primary_selection_incomplete\");",
            "            return null;",
            "        }).Where(item => item != null));",
            "    }",
            "",
        )
    )

    for event_index, event in enumerate(scheduled_events):
        lines.extend(
            (
                f"    private void QueueEvent{event_index}()",
                "    {",
                *(
                    ("        if ((Time.Month - 1) % 3 != 0) return;",)
                    if isinstance(event, LeanQuarterlyEvent)
                    else ()
                ),
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
    if plan.cooldown_states:
        calendar_symbols = {item.calendar_symbol for item in plan.cooldown_states}
        if len(calendar_symbols) != 1:
            raise ValueError("cooldown v0 requires one shared exchange calendar")
        calendar_symbol = _csharp_string(next(iter(calendar_symbols)))
        lines.extend(
            (
                "        if (_lastTradingSessionDate != Time.Date",
                f"            && Securities[_symbols[{calendar_symbol}]].Exchange.Hours.IsDateOpen(Time.Date, false))",
                "        {",
                "            _tradingSessionIndex++;",
                "            _lastTradingSessionDate = Time.Date;",
                "        }",
            )
        )
    if plan.target_snapshots:
        for event_index in range(len(scheduled_events)):
            lines.append(f"        string readyEvent{event_index} = null;")
        for event_index in range(len(scheduled_events)):
            lines.extend(
                (
                    f"        if (_pendingEvent{event_index} != null && Event{event_index}DataIsReady(slice))",
                    "        {",
                    f"            readyEvent{event_index} = _pendingEvent{event_index};",
                    f"            _pendingEvent{event_index} = null;",
                    "        }",
                )
            )
        for event_index, event in enumerate(scheduled_events):
            if event.refresh_ids:
                lines.append(
                    f"        if (readyEvent{event_index} != null) RefreshEvent{event_index}(readyEvent{event_index});"
                )
        for event_index, event in enumerate(scheduled_events):
            if event.rebalance_ids:
                lines.append(
                    f"        if (readyEvent{event_index} != null) ExecuteEvent{event_index}(readyEvent{event_index});"
                )
    else:
        for event_index in range(len(scheduled_events)):
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

    for event_index, event in enumerate(scheduled_events):
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

    for snapshot_index, snapshot in enumerate(plan.target_snapshots):
        if len(snapshot.sleeve_ids) != 1:
            raise ValueError("LEAN target snapshot v0 requires exactly one local target sleeve")
        sleeve = sleeves[snapshot.sleeve_ids[0]]
        variable = f"snapshotSelection{snapshot_index}"
        lines.extend(
            (
                f"    private void RefreshSnapshot{snapshot_index}(string eventIdentity, string scheduleName, string scheduleComponent)",
                "    {",
            )
        )
        if sleeve.selection_id is None:
            symbols = ", ".join(_csharp_string(item) for item in sleeve.symbols)
            lines.append(f"        var {variable} = new List<string> {{ {symbols} }};")
        else:
            selection = momentum_selections.get(sleeve.selection_id)
            if selection is None:
                raise ValueError("retained target snapshot v0 requires Momentum Top N")
            symbols = ", ".join(_csharp_string(item) for item in selection.symbols)
            threshold = _decimal_literal(selection.filter_threshold or Decimal(0))
            lines.extend(
                (
                    "        var scores = new Dictionary<string, decimal>();",
                    f"        foreach (var ticker in new[] {{ {symbols} }})",
                    "        {",
                    "            var window = _dailyCloses[ticker];",
                    f"            if (window.Count >= {selection.lookback_bars + 1} && window[{selection.lookback_bars}] != 0m)",
                    "            {",
                    f"                scores[ticker] = window[0] / window[{selection.lookback_bars}] - 1m;",
                    "            }",
                    "        }",
                    f"        var eligible = scores.Where(item => item.Value > {threshold})",
                    "            .ToDictionary(item => item.Key, item => item.Value);",
                    f'        Debug("RULETRADE_FILTER|" + eventIdentity + "|threshold=" + {threshold}.ToString("G29", CultureInfo.InvariantCulture)',
                    '            + "|eligible=" + string.Join(",", eligible.Keys.OrderBy(item => item))',
                    '            + "|rejected=" + string.Join(",", scores.Keys.Except(eligible.Keys).OrderBy(item => item)));',
                    '        EmitDecisionEvidence(eventIdentity, "evaluation", "filter",',
                    f'            "filter_component", {_csharp_string(selection.filter_component_id or "")}, "filter_field", "config.threshold", "operator", "gt",',
                    f'            "threshold", {threshold}.ToString("G29", CultureInfo.InvariantCulture),',
                    f'            "decision_universe", string.Join(",", new[] {{ {symbols} }}),',
                    '            "scores", string.Join(",", scores.OrderBy(item => item.Key).Select(item => item.Key + "=" + item.Value.ToString("G29", CultureInfo.InvariantCulture))),',
                    '            "eligible", string.Join(",", eligible.Keys.OrderBy(item => item)),',
                    '            "rejected", string.Join(",", scores.Keys.Except(eligible.Keys).OrderBy(item => item)));',
                    "        var ranked = eligible.OrderByDescending(item => item.Value)",
                    "            .ThenBy(item => item.Key, StringComparer.Ordinal).ToList();",
                    f"        var {variable} = ranked.Take({selection.count}).Select(item => item.Key).ToList();",
                    '        Debug("RULETRADE_MOMENTUM|" + eventIdentity',
                    '            + "|scores=" + string.Join(",", scores.OrderBy(item => item.Key)',
                    '                .Select(item => item.Key + "=" + item.Value.ToString("G29", CultureInfo.InvariantCulture)))',
                    '            + "|ranked=" + string.Join(",", ranked.Select(item => item.Key))',
                    f'            + "|candidate=" + string.Join(",", {variable})',
                    f'            + "|selected=" + ({variable}.Count == {selection.count} ? string.Join(",", {variable}) : "")',
                    f'            + "|decision=" + ({variable}.Count == {selection.count} ? "executed" : "insufficient"));',
                    '        EmitDecisionEvidence(eventIdentity, "selection", "selection",',
                    f'            "score_component", {_csharp_string(selection.score_component_id)}, "score_field", "config.lookback_bars",',
                    f'            "rank_component", {_csharp_string(selection.rank_component_id)}, "rank_field", "config.direction",',
                    f'            "selection_component", {_csharp_string(selection.selection_component_id)}, "selection_field", "config.count",',
                    '            "scores", string.Join(",", scores.OrderBy(item => item.Key).Select(item => item.Key + "=" + item.Value.ToString("G29", CultureInfo.InvariantCulture))),',
                    '            "ranked", string.Join(",", ranked.Select(item => item.Key)),',
                    f'            "candidates", string.Join(",", {variable}),',
                    f'            "primary_selected", ({variable}.Count == {selection.count} ? string.Join(",", {variable}) : ""),',
                    f'            "required_count", "{selection.count}", "evaluated", string.Join(",", ranked.Select(item => item.Key)),',
                    f'            "signal_present", string.Join(",", {variable}), "signal_absent", string.Join(",", ranked.Select(item => item.Key).Except({variable})),',
                    f'            "ranks", EvidenceRanks(ranked.Select(item => item.Key)), "stops", EvidenceSelectionStops(ranked.Select(item => item.Key), {variable}, {variable}.Count == {selection.count}, {str(bool(sleeve.fallback_symbols)).lower()}),',
                    f'            "decision", ({variable}.Count == {selection.count} ? "executed" : "insufficient"));',
                )
            )
            if sleeve.fallback_symbols:
                fallback_symbol = _csharp_string(sleeve.fallback_symbols[0])
                fallback_component = _csharp_string(sleeve.fallback_component_id or "")
                lines.extend(
                    (
                        f"        var fallbackActivated = {variable}.Count < {selection.count};",
                        "        if (fallbackActivated)",
                        "        {",
                        f"            {variable} = new List<string> {{ {fallback_symbol} }};",
                        f'            Debug("RULETRADE_FALLBACK|" + eventIdentity + "|component=" + {fallback_component} + "|asset=" + {fallback_symbol} + "|decision=activated");',
                        f'            EmitDecisionEvidence(eventIdentity, "selection", "fallback", "fallback_component", {fallback_component}, "asset", {fallback_symbol}, "activated", "true");',
                        "        }",
                        "        else",
                        "        {",
                        f'            Debug("RULETRADE_FALLBACK|" + eventIdentity + "|component=" + {fallback_component} + "|asset=" + {fallback_symbol} + "|decision=not_activated");',
                        f'            EmitDecisionEvidence(eventIdentity, "selection", "fallback", "fallback_component", {fallback_component}, "asset", {fallback_symbol}, "activated", "false");',
                        "        }",
                        f'        Debug("RULETRADE_FINAL|" + eventIdentity + "|selected=" + string.Join(",", {variable})',
                        '            + "|decision=executed|source=" + (fallbackActivated ? "fallback" : "primary"));',
                        '        EmitDecisionEvidence(eventIdentity, "selection", "final_selection",',
                        f'            "selection_component", (fallbackActivated ? {fallback_component} : {_csharp_string(selection.selection_component_id)}),',
                        f'            "selected", string.Join(",", {variable}), "source", (fallbackActivated ? "fallback" : "primary"));',
                    )
                )
            else:
                lines.append(f"        if ({variable}.Count < {selection.count}) return;")
        total = _decimal_literal(sleeve.total_weight)
        source_sleeve = _csharp_string(snapshot.source_sleeve_component_id)
        lines.extend(
            (
                f"        var localWeight = {total} / {variable}.Count;",
                f"        _targetSnapshot{snapshot_index} = {variable}.ToDictionary(item => item, item => localWeight);",
                f"        _targetSnapshotTimestamp{snapshot_index} = eventIdentity;",
                f'        Debug("RULETRADE_REFRESH|" + eventIdentity + "|sleeve=" + {source_sleeve}',
                '            + "|schedule=" + scheduleName',
                f'            + "|local_targets=" + string.Join(",", _targetSnapshot{snapshot_index}.OrderBy(item => item.Key)',
                '                .Select(item => item.Key + "=" + item.Value.ToString("G29", CultureInfo.InvariantCulture)))',
                '            + "|snapshot=" + eventIdentity);',
                '        EmitDecisionEvidence(eventIdentity, "snapshot_commit", "snapshot_refresh",',
                f'            "sleeve_component", {source_sleeve}, "schedule_component", scheduleComponent, "schedule", scheduleName,',
                f'            "local_targets", string.Join(",", _targetSnapshot{snapshot_index}.OrderBy(item => item.Key).Select(item => item.Key + "=" + item.Value.ToString("G29", CultureInfo.InvariantCulture))),',
                '            "snapshot_session", eventIdentity);',
                "    }",
                "",
            )
        )

    for event_index, event in enumerate(scheduled_events):
        if not event.refresh_ids:
            continue
        schedule_name = "quarterly" if isinstance(event, LeanQuarterlyEvent) else "monthly"
        lines.extend(
            (
                f"    private void RefreshEvent{event_index}(string eventIdentity)",
                "    {",
            )
        )
        for snapshot_id in event.refresh_ids:
            lines.append(
                f"        RefreshSnapshot{snapshot_indexes[snapshot_id]}(eventIdentity, {_csharp_string(schedule_name)}, {_csharp_string(event.id)});"
            )
        lines.extend(("    }", ""))

    for event_index, event in enumerate(scheduled_events):
        if not event.rebalance_ids:
            continue
        event_schedule = "quarterly" if isinstance(event, LeanQuarterlyEvent) else "monthly"
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
            if rebalance.snapshot_allocations:
                missing = " || ".join(
                    f"_targetSnapshot{snapshot_indexes[item.snapshot_id]} == null"
                    for item in rebalance.snapshot_allocations
                )
                snapshot_times = ", ".join(
                    (
                        f'{_csharp_string(item.source_sleeve_component_id)} + "=" + '
                        f"_targetSnapshotTimestamp{snapshot_indexes[item.snapshot_id]}"
                    )
                    for item in rebalance.snapshot_allocations
                )
                lines.extend(
                    (
                        f"        if ({missing})",
                        "        {",
                        '            Debug("RULETRADE_PORTFOLIO_EVENT|" + eventIdentity',
                        f'                + "|schedule={event_schedule}|snapshots=|decision=skipped");',
                        f'            EmitDecisionEvidence(eventIdentity, "portfolio_execution", "snapshot_usage", "schedule_component", {_csharp_string(event.id)}, "schedule", "{event_schedule}", "snapshots", "", "executed", "false");',
                        "            return;",
                        "        }",
                        '        Debug("RULETRADE_PORTFOLIO_EVENT|" + eventIdentity',
                        f'            + "|schedule={event_schedule}|snapshots=" + string.Join(",", new[] {{ {snapshot_times} }})',
                        '            + "|decision=executed");',
                        '        EmitDecisionEvidence(eventIdentity, "portfolio_execution", "snapshot_usage",',
                        f'            "schedule_component", {_csharp_string(event.id)}, "schedule", "{event_schedule}",',
                        f'            "snapshots", string.Join(",", new[] {{ {snapshot_times} }}), "executed", "true");',
                    )
                )
                for allocation in rebalance.snapshot_allocations:
                    snapshot_index = snapshot_indexes[allocation.snapshot_id]
                    factor = _decimal_literal(allocation.factor)
                    sleeve_component = _csharp_string(
                        allocation.source_sleeve_component_id
                    )
                    lines.extend(
                        (
                            f"        foreach (var item in _targetSnapshot{snapshot_index})",
                            "        {",
                            "            var symbol = _symbols[item.Key];",
                            f"            var contribution = item.Value * {factor};",
                            f"            {targets_variable}[symbol] = {targets_variable}.ContainsKey(symbol)",
                            f"                ? {targets_variable}[symbol] + contribution : contribution;",
                            "        }",
                            f'        Debug("RULETRADE_SLEEVE|" + eventIdentity + "|sleeve=" + {sleeve_component}',
                            f'            + "|local_selected=" + string.Join(",", _targetSnapshot{snapshot_index}.Keys.OrderBy(item => item))',
                            f'            + "|local_weights=" + string.Join(",", _targetSnapshot{snapshot_index}.OrderBy(item => item.Key)',
                            '                .Select(item => item.Key + "=" + item.Value.ToString("G29", CultureInfo.InvariantCulture)))',
                            f'            + "|allocation=" + {factor}.ToString("G29", CultureInfo.InvariantCulture)',
                            f'            + "|scaled=" + string.Join(",", _targetSnapshot{snapshot_index}.OrderBy(item => item.Key)',
                            f'                .Select(item => item.Key + "=" + (item.Value * {factor}).ToString("G29", CultureInfo.InvariantCulture))));',
                            '        EmitDecisionEvidence(eventIdentity, "portfolio_execution", "sleeve_contribution",',
                            f'            "sleeve_component", {sleeve_component}, "allocation_component", {_csharp_string(sleeve.id)},',
                            f'            "local_selected", string.Join(",", _targetSnapshot{snapshot_index}.Keys.OrderBy(item => item)),',
                            f'            "local_targets", string.Join(",", _targetSnapshot{snapshot_index}.OrderBy(item => item.Key).Select(item => item.Key + "=" + item.Value.ToString("G29", CultureInfo.InvariantCulture))),',
                            f'            "allocation", {factor}.ToString("G29", CultureInfo.InvariantCulture),',
                            f'            "scaled_targets", string.Join(",", _targetSnapshot{snapshot_index}.OrderBy(item => item.Key).Select(item => item.Key + "=" + (item.Value * {factor}).ToString("G29", CultureInfo.InvariantCulture))));',
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
                        lines.extend(
                            (
                                '        EmitDecisionEvidence(eventIdentity, "selection", "random_selection",',
                                f'            "selection_component", {_csharp_string(selection.component_id)}, "selection_field", "config.count",',
                                f'            "universe", string.Join(",", new[] {{ {symbols} }}),',
                                f'            "selected", string.Join(",", {variable}), "resample", "{selection.resample}",',
                                f'            "required_count", "{selection.count}");',
                            )
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
                                    '        EmitDecisionEvidence(eventIdentity, "evaluation", "filter",',
                                    f'            "filter_component", {_csharp_string(selection.filter_component_id or "")}, "filter_field", "config.threshold", "operator", "gt",',
                                    f'            "threshold", {threshold}.ToString("G29", CultureInfo.InvariantCulture),',
                                    f'            "decision_universe", string.Join(",", new[] {{ {symbols} }}),',
                                    f'            "scores", string.Join(",", {scores_variable}.OrderBy(item => item.Key).Select(item => item.Key + "=" + item.Value.ToString("G29", CultureInfo.InvariantCulture))),',
                                    f'            "eligible", string.Join(",", {eligible_variable}.Keys.OrderBy(item => item)),',
                                    f'            "rejected", string.Join(",", {scores_variable}.Keys.Except({eligible_variable}.Keys).OrderBy(item => item)));',
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
                        if selection.cooldown_state_id is not None:
                            state = next(
                                item
                                for item in plan.cooldown_states
                                if item.id == selection.cooldown_state_id
                            )
                            state_index = cooldown_indexes[state.id]
                            candidate_variable = f"signalCandidate{event_index}_{rebalance_index}_{sleeve_index}"
                            cooldown_eligible = f"cooldownEligible{event_index}_{rebalance_index}_{sleeve_index}"
                            component_id = _csharp_string(state.component_id)
                            lines.extend(
                                (
                                    f"        var {candidate_variable} = {variable}.ToList();",
                                    '        Debug("RULETRADE_SIGNAL|" + eventIdentity',
                                    f'            + "|scores=" + string.Join(",", {scores_variable}.OrderBy(item => item.Key)',
                                    '                .Select(item => item.Key + "=" + item.Value.ToString("G29", CultureInfo.InvariantCulture)))',
                                    f'            + "|ranked=" + string.Join(",", {ranked_variable}.Select(item => item.Key))',
                                    f'            + "|candidate=" + string.Join(",", {candidate_variable}));',
                                    '        EmitDecisionEvidence(eventIdentity, "selection", "selection",',
                                    f'            "score_component", {_csharp_string(selection.score_component_id)}, "score_field", "config.lookback_bars",',
                                    f'            "rank_component", {_csharp_string(selection.rank_component_id)}, "rank_field", "config.direction",',
                                    f'            "selection_component", {_csharp_string(selection.selection_component_id)}, "selection_field", "config.count",',
                                    f'            "scores", string.Join(",", {scores_variable}.OrderBy(item => item.Key).Select(item => item.Key + "=" + item.Value.ToString("G29", CultureInfo.InvariantCulture))),',
                                    f'            "ranked", string.Join(",", {ranked_variable}.Select(item => item.Key)),',
                                    f'            "candidates", string.Join(",", {candidate_variable}), "primary_selected", "",',
                                    f'            "required_count", "{selection.count}", "evaluated", string.Join(",", {ranked_variable}.Select(item => item.Key)),',
                                    f'            "signal_present", string.Join(",", {candidate_variable}), "signal_absent", string.Join(",", {ranked_variable}.Select(item => item.Key).Except({candidate_variable})),',
                                    f'            "ranks", EvidenceRanks({ranked_variable}.Select(item => item.Key)), "stops", EvidenceSelectionStops({ranked_variable}.Select(item => item.Key), {candidate_variable}, true, false),',
                                    f'            "decision", "signal");',
                                    f"        var {cooldown_eligible} = new List<string>();",
                                    f"        foreach (var ticker in {candidate_variable})",
                                    "        {",
                                    f"            var hasLastExit = _lastExitSession{state_index}.TryGetValue(ticker, out var lastExitSession);",
                                    "            var elapsed = hasLastExit ? _tradingSessionIndex - lastExitSession : -1;",
                                    f"            var allowed = !hasLastExit || elapsed >= {state.required_completed_sessions};",
                                    f"            if (allowed) {cooldown_eligible}.Add(ticker);",
                                    f'            Debug("RULETRADE_COOLDOWN|" + eventIdentity + "|component=" + {component_id}',
                                    '                + "|asset=" + ticker + "|candidate=true|last_exit="',
                                    f'                + (hasLastExit ? _lastExitDate{state_index}[ticker] : "none")',
                                    '                + "|elapsed_trading_days=" + (hasLastExit ? elapsed.ToString(CultureInfo.InvariantCulture) : "none")',
                                    f'                + "|required={state.required_completed_sessions}|decision=" + (allowed ? "eligible" : "blocked"));',
                                    '            EmitDecisionEvidence(eventIdentity, "selection", "cooldown",',
                                    f'                "cooldown_component", {component_id}, "cooldown_field", "config.duration", "asset", ticker, "signal_candidate", "true",',
                                    f'                "last_exit", (hasLastExit ? _lastExitDate{state_index}[ticker] : "none"),',
                                    '                "elapsed_sessions", (hasLastExit ? elapsed.ToString(CultureInfo.InvariantCulture) : "none"),',
                                    f'                "required_sessions", "{state.required_completed_sessions}", "eligible", (allowed ? "true" : "false"),',
                                    '                "stopping_stage", (allowed ? "" : "cooldown"));',
                                    "        }",
                                    f"        {variable} = {cooldown_eligible};",
                                    '        EmitDecisionEvidence(eventIdentity, "selection", "final_selection",',
                                    f'            "selection_component", {component_id}, "selected", string.Join(",", {variable}), "source", "primary");',
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
                                    '        EmitDecisionEvidence(eventIdentity, "selection", "selection",',
                                    f'            "score_component", {_csharp_string(selection.score_component_id)}, "score_field", "config.lookback_bars",',
                                    f'            "rank_component", {_csharp_string(selection.rank_component_id)}, "rank_field", "config.direction",',
                                    f'            "selection_component", {_csharp_string(selection.selection_component_id)}, "selection_field", "config.count",',
                                    f'            "scores", string.Join(",", {scores_variable}.OrderBy(item => item.Key).Select(item => item.Key + "=" + item.Value.ToString("G29", CultureInfo.InvariantCulture))),',
                                    f'            "ranked", string.Join(",", {ranked_variable}.Select(item => item.Key)),',
                                    f'            "candidates", string.Join(",", {variable}),',
                                    f'            "primary_selected", ({variable}.Count == {selection.count} ? string.Join(",", {variable}) : ""),',
                                    f'            "required_count", "{selection.count}", "evaluated", string.Join(",", {ranked_variable}.Select(item => item.Key)),',
                                    f'            "signal_present", string.Join(",", {variable}), "signal_absent", string.Join(",", {ranked_variable}.Select(item => item.Key).Except({variable})),',
                                    f'            "ranks", EvidenceRanks({ranked_variable}.Select(item => item.Key)), "stops", EvidenceSelectionStops({ranked_variable}.Select(item => item.Key), {variable}, {variable}.Count == {selection.count}, {str(bool(sleeve.fallback_symbols)).lower()}),',
                                    f'            "decision", ({variable}.Count == {selection.count} ? "executed" : "{insufficient_decision}"));',
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
                                    f'            EmitDecisionEvidence(eventIdentity, "selection", "fallback", "fallback_component", {fallback_component}, "asset", {fallback_symbol}, "activated", "true");',
                                    "        }",
                                    "        else",
                                    "        {",
                                    f'            Debug("RULETRADE_FALLBACK|" + eventIdentity + "|component=" + {fallback_component} + "|asset=" + {fallback_symbol} + "|decision=not_activated");',
                                    f'            EmitDecisionEvidence(eventIdentity, "selection", "fallback", "fallback_component", {fallback_component}, "asset", {fallback_symbol}, "activated", "false");',
                                    "        }",
                                    f'        Debug("RULETRADE_FINAL|" + eventIdentity + "|selected=" + string.Join(",", {variable})',
                                    f'            + "|decision=executed|source=" + ({fallback_activated} ? "fallback" : "primary"));',
                                    '        EmitDecisionEvidence(eventIdentity, "selection", "final_selection",',
                                    f'            "selection_component", ({fallback_activated} ? {fallback_component} : {_csharp_string(selection.selection_component_id)}),',
                                    f'            "selected", string.Join(",", {variable}), "source", ({fallback_activated} ? "fallback" : "primary"));',
                                )
                            )
                        elif selection.cooldown_state_id is None:
                            lines.extend(
                                (
                                    f"        if ({variable}.Count < {selection.count})",
                                    "        {",
                                    f'            Debug("RULETRADE_MOMENTUM_SKIPPED|" + eventIdentity + "|eligible=" + {eligible_count_variable}.Count + "|required={selection.count}");',
                                    "            return;",
                                    "        }",
                                )
                            )
                        if (
                            selection.filter_threshold is None
                            and selection.cooldown_state_id is None
                        ):
                            lines.extend(
                                (
                                    '        Debug("RULETRADE_MOMENTUM|" + eventIdentity',
                                    f'            + "|scores=" + string.Join(",", {scores_variable}.OrderBy(item => item.Key)',
                                    '                .Select(item => item.Key + "=" + item.Value.ToString("G29", CultureInfo.InvariantCulture)))',
                                    f'            + "|ranked=" + string.Join(",", {ranked_variable}.Select(item => item.Key))',
                                    f'            + "|selected=" + string.Join(",", {variable}));',
                                    '        EmitDecisionEvidence(eventIdentity, "selection", "selection",',
                                    f'            "score_component", {_csharp_string(selection.score_component_id)}, "score_field", "config.lookback_bars",',
                                    f'            "rank_component", {_csharp_string(selection.rank_component_id)}, "rank_field", "config.direction",',
                                    f'            "selection_component", {_csharp_string(selection.selection_component_id)}, "selection_field", "config.count",',
                                    f'            "scores", string.Join(",", {scores_variable}.OrderBy(item => item.Key).Select(item => item.Key + "=" + item.Value.ToString("G29", CultureInfo.InvariantCulture))),',
                                    f'            "ranked", string.Join(",", {ranked_variable}.Select(item => item.Key)),',
                                    f'            "candidates", string.Join(",", {variable}), "primary_selected", string.Join(",", {variable}),',
                                    f'            "required_count", "{selection.count}", "evaluated", string.Join(",", {ranked_variable}.Select(item => item.Key)),',
                                    f'            "signal_present", string.Join(",", {variable}), "signal_absent", string.Join(",", {ranked_variable}.Select(item => item.Key).Except({variable})),',
                                    f'            "ranks", EvidenceRanks({ranked_variable}.Select(item => item.Key)), "stops", EvidenceSelectionStops({ranked_variable}.Select(item => item.Key), {variable}, true, false),',
                                    f'            "decision", "executed");',
                                )
                            )
                    lines.append(f"        {selected_variable}.AddRange({variable});")
                weight = _decimal_literal(sleeve.total_weight)
                cooldown_selection = (
                    momentum_selections.get(sleeve.selection_id)
                    if sleeve.selection_id is not None
                    else None
                )
                has_cooldown = (
                    cooldown_selection is not None
                    and cooldown_selection.cooldown_state_id is not None
                )
                if has_cooldown:
                    lines.extend((f"        if ({variable}.Count > 0)", "        {"))
                indent = "    " if has_cooldown else ""
                lines.extend(
                    (
                        f"{indent}        var {weight_variable} = {weight} / {variable}.Count();",
                        f"{indent}        foreach (var ticker in {variable})",
                        f"{indent}        {{",
                        f"{indent}            var symbol = _symbols[ticker];",
                        (
                            f"{indent}            {targets_variable}[symbol] = "
                            f"{targets_variable}.ContainsKey(symbol) ? "
                            f"{targets_variable}[symbol] + {weight_variable} : {weight_variable};"
                        ),
                        f"{indent}        }}",
                    )
                )
                if has_cooldown:
                    lines.append("        }")
                if sleeve.source_sleeve_component_id is not None:
                    if has_cooldown:
                        raise ValueError("cooldown v0 does not support portfolio sleeves")
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
                            '        EmitDecisionEvidence(eventIdentity, "portfolio_execution", "sleeve_contribution",',
                            f'            "sleeve_component", {sleeve_component}, "allocation_component", {_csharp_string(sleeve.id)},',
                            f'            "local_selected", string.Join(",", {variable}.OrderBy(item => item)),',
                            f'            "local_targets", string.Join(",", {variable}.OrderBy(item => item).Select(item => item + "=" + {local_weight_variable}.ToString("G29", CultureInfo.InvariantCulture))),',
                            f'            "allocation", {allocation}.ToString("G29", CultureInfo.InvariantCulture),',
                            f'            "scaled_targets", string.Join(",", {variable}.OrderBy(item => item).Select(item => item + "=" + {weight_variable}.ToString("G29", CultureInfo.InvariantCulture))));',
                        )
                    )
            for state_id in rebalance.exit_state_ids:
                state = next(item for item in plan.cooldown_states if item.id == state_id)
                state_index = cooldown_indexes[state_id]
                state_symbols = ", ".join(_csharp_string(item) for item in state.symbols)
                component_id = _csharp_string(state.component_id)
                lines.extend(
                    (
                        f"        foreach (var ticker in new[] {{ {state_symbols} }})",
                        "        {",
                        f"            var hadTarget = _previousTargets{state_index}.TryGetValue(ticker, out var oldTarget) && oldTarget > 0m;",
                        f"            var hasTarget = {targets_variable}.TryGetValue(_symbols[ticker], out var newTarget) && newTarget > 0m;",
                        "            if (hadTarget && !hasTarget)",
                        "            {",
                        f"                var oldExit = _lastExitDate{state_index}.TryGetValue(ticker, out var priorExit) ? priorExit : \"none\";",
                        f"                _lastExitSession{state_index}[ticker] = _tradingSessionIndex;",
                        f"                _lastExitDate{state_index}[ticker] = eventIdentity;",
                        f'                Debug("RULETRADE_STATE|" + eventIdentity + "|component=" + {component_id}',
                        '                    + "|asset=" + ticker + "|state=last_exit|old=" + oldExit',
                        '                    + "|new=" + eventIdentity + "|cause=target_exit");',
                        '                EmitDecisionEvidence(eventIdentity, "state_mutation", "state_mutation",',
                        f'                    "state_component", {component_id}, "asset", ticker, "state", "last_exit",',
                        '                    "old_value", oldExit, "new_value", eventIdentity, "cause", "target_exit");',
                        "            }",
                        f"            _previousTargets{state_index}[ticker] = hasTarget ? newTarget : 0m;",
                        "        }",
                    )
                )
            final_selected_expression = (
                f"{targets_variable}.Where(item => item.Value != 0m)"
                ".Select(item => item.Key.Value)"
                if has_source_sleeves
                else selected_variable
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
                    '        EmitDecisionEvidence(eventIdentity, "portfolio_execution", "final_targets",',
                    f'            "rebalance_component", {_csharp_string(rebalance.id)},',
                    f'            "selected", string.Join(",", {final_selected_expression}.OrderBy(item => item, StringComparer.Ordinal)),',
                    f'            "targets", string.Join(",", {targets_variable}.OrderBy(item => item.Key.Value).Select(item => item.Key.Value + "=" + item.Value.ToString("G29", CultureInfo.InvariantCulture))));',
                )
            )
        lines.extend(("    }", ""))

    lines.append("}")
    if plan.random_selections:
        lines.extend(("", _random_helper_source(), ""))
    else:
        lines.append("")
    return "\n".join(lines)
