# 169-case Blocky expressiveness review

This is a case-level reconciliation of the supplied natural-language fragments. A fragment is not counted as an executable strategy, and a graph marked draftable is not claimed lowerable or Docker-verified.

## Recomputed classification

| Class | Meaning | Cases |
|---|---|---:|
| A | Expressible with current grammar | 0 |
| B | Expressible after parameter definition | 23 |
| C | Requires common compositional grammar | 71 |
| D | Requires finance-specific type/lifecycle | 66 |
| E | Requires external judgment/unprovided semantics | 9 |

## Per-case evidence

| ID | Class | Source interpretation | Primary blockers | Composition status |
|---|---:|---|---|---|
| NL001 | E | Opening-range breakout -> retest -> candle/pressure confirmation -> entry; stop outside wick/range; target 2R. | event_order, event_relative_time, undefined_user_parameter, external_judgment | unresolved_natural_language_meaning |
| NL002 | C | Session-defined range derived from first bar, treated as support/resistance context. | event_order, event_relative_time, undefined_user_parameter | proposed_graph_requiring_new_grammar |
| NL003 | C | Conditional stop rule: wick-based stop if rejection wick exists, else range-candle stop. | undefined_user_parameter, asset_set_composition | proposed_graph_requiring_new_grammar |
| NL004 | C | Session volume-profile range -> close-confirmed breakout -> retest of VAH/VAL -> pressure confirmation -> enter at close. | event_order, state_or_memory, event_relative_time, undefined_user_parameter | proposed_graph_requiring_new_grammar |
| NL005 | C | Event-relative entry/stop/target anchored to the confirming candle. | event_order, state_or_memory, event_relative_time, undefined_user_parameter | proposed_graph_requiring_new_grammar |
| NL006 | E | Breakout -> first pullback only -> retracement <50% -> relative volume low -> hold confirmation -> entry. | event_order, state_or_memory, event_relative_time, undefined_user_parameter, external_judgment | unresolved_natural_language_meaning |
| NL007 | C | Level validity requires touch_count >=2; then breakout event; then retest entry. | event_order, state_or_memory, event_relative_time, undefined_user_parameter | proposed_graph_requiring_new_grammar |
| NL008 | B | Interchangeable structural-level definitions feeding same breakout/retest workflow. | undefined_user_parameter | parameterized_graph_requiring_user_input |
| NL009 | C | Level detector -> decisive break -> retest -> one-of several confirmations -> entry. | multi_clock_context, undefined_user_parameter | proposed_graph_requiring_new_grammar |
| NL010 | C | Breakout -> retest proximity -> directional close + low-volume pullback -> one-bar delayed entry. | multi_clock_context, undefined_user_parameter | proposed_graph_requiring_new_grammar |
| NL011 | C | Lower-timeframe setup gated by higher-timeframe trend state. | multi_clock_context, event_order, state_or_memory, event_relative_time, undefined_user_parameter | proposed_graph_requiring_new_grammar |
| NL012 | C | N-of-N multi-timeframe oscillator confirmation. | multi_clock_context, event_order, undefined_user_parameter | proposed_graph_requiring_new_grammar |
| NL013 | C | HTF oversold/context state -> LTF reversal/shift event -> entry. | multi_clock_context, event_order, state_or_memory, event_relative_time, undefined_user_parameter | proposed_graph_requiring_new_grammar |
| NL014 | D | Finite-state loop: CASH -> SHORT_PUT -> ASSIGNED_SHARES -> SHORT_CALL -> CASH. | option_contract_or_lifecycle, event_order, event_relative_time, undefined_user_parameter, external_judgment | unsupported_semantic_or_data_requirement |
| NL015 | D | ASSIGNED state with optional WAIT_FOR_RECOVERY before call-writing. | option_contract_or_lifecycle, event_order, state_or_memory, event_relative_time, undefined_user_parameter | unsupported_semantic_or_data_requirement |
| NL016 | D | After assignment, contract selection depends on recovery allowance and DTE. | option_contract_or_lifecycle, undefined_user_parameter | unsupported_semantic_or_data_requirement |
| NL017 | D | Dynamic strike constraint derived from path-dependent effective basis and desired exit. | option_contract_or_lifecycle, undefined_user_parameter, external_judgment | unsupported_semantic_or_data_requirement |
| NL018 | D | WAIT state can terminate on IV condition rather than price condition. | option_contract_or_lifecycle, undefined_user_parameter | unsupported_semantic_or_data_requirement |
| NL019 | D | Contract-selection policy parameterized by user objective. | option_contract_or_lifecycle, undefined_user_parameter | unsupported_semantic_or_data_requirement |
| NL020 | D | CALL selector changes semantics based on KEEP vs EXIT objective. | option_contract_or_lifecycle, undefined_user_parameter, external_judgment | unsupported_semantic_or_data_requirement |
| NL021 | B | Position-management policy branches on goal and net stock cost relative to spot. | undefined_user_parameter | parameterized_graph_requiring_user_input |
| NL022 | D | EXIT state -> aggressive call strike -> repeat until called away. | option_contract_or_lifecycle, multi_clock_context, event_order, state_or_memory, event_relative_time, undefined_user_parameter, external_judgment | unsupported_semantic_or_data_requirement |
| NL023 | D | ASSIGNED_LOSS state with mutually competing recovery policies. | option_contract_or_lifecycle, undefined_user_parameter | unsupported_semantic_or_data_requirement |
| NL024 | D | Short-call lifecycle with delta/DTE selector and proximity-triggered roll. | option_contract_or_lifecycle, undefined_user_parameter | unsupported_semantic_or_data_requirement |
| NL025 | E | Precommitted management policy vs discretionary override after adverse event. | undefined_user_parameter, external_judgment | unresolved_natural_language_meaning |
| NL026 | C | Two competing stateful recovery policies for underwater assigned stock. | undefined_user_parameter, asset_set_composition | proposed_graph_requiring_new_grammar |
| NL027 | D | Multi-leg option structure selected around event calendar with neutrality constraint and event-relative exit. | option_contract_or_lifecycle, specialized_finance_or_model_data, undefined_user_parameter | unsupported_semantic_or_data_requirement |
| NL028 | D | Event-relative entry/exit around earnings; thesis targets volatility rather than direction. | option_contract_or_lifecycle, specialized_finance_or_model_data, event_order, state_or_memory, event_relative_time, undefined_user_parameter, external_judgment | unsupported_semantic_or_data_requirement |
| NL029 | D | Volatility-target strategy with approximate neutrality that changes over time and may require adjustment. | option_contract_or_lifecycle, event_order, state_or_memory, event_relative_time, undefined_user_parameter, external_judgment | unsupported_semantic_or_data_requirement |
| NL030 | D | Contract selection combines event-history distribution, implied expected move, and assignment preference. | option_contract_or_lifecycle, specialized_finance_or_model_data, undefined_user_parameter | unsupported_semantic_or_data_requirement |
| NL031 | D | Entry allowed only outside tail-risk regimes; active position has underlying-relative stop. | option_contract_or_lifecycle, undefined_user_parameter | unsupported_semantic_or_data_requirement |
| NL032 | E | Generate intentionally degraded variants to expose tail behavior rather than optimize best case. | undefined_user_parameter, external_judgment | unresolved_natural_language_meaning |
| NL033 | D | Time-window regime observation -> directional option structure -> strike derived from implied move proxy. | option_contract_or_lifecycle, event_order, state_or_memory, event_relative_time, undefined_user_parameter | unsupported_semantic_or_data_requirement |
| NL034 | D | Option strategy gated by underlying trend and external volatility index. | option_contract_or_lifecycle, undefined_user_parameter | unsupported_semantic_or_data_requirement |
| NL035 | B | State-triggered rebalance with configurable destination: target vs midpoint. | undefined_user_parameter | parameterized_graph_requiring_user_input |
| NL036 | C | Drawdown-tiered allocation schedule with staged actions and maximum risk cap. | undefined_user_parameter, asset_set_composition | proposed_graph_requiring_new_grammar |
| NL037 | B | Asymmetric upper/lower tolerance bands around target allocation. | undefined_user_parameter | parameterized_graph_requiring_user_input |
| NL038 | C | Cross-sectional momentum pipeline with market regime gate, per-asset eligibility, composite score, risk sizing, dual schedules. | multi_clock_context, undefined_user_parameter | proposed_graph_requiring_new_grammar |
| NL039 | D | Strategy-of-strategies allocation driven by relative sub-strategy performance. | specialized_finance_or_model_data, event_order, state_or_memory, undefined_user_parameter | unsupported_semantic_or_data_requirement |
| NL040 | C | Continuous regime-dependent position sizing based on relative risk level. | undefined_user_parameter, asset_set_composition | proposed_graph_requiring_new_grammar |
| NL041 | D | Fundamental/liquidity universe -> risk-adjusted rank -> trend gate -> leverage -> volatility-adjusted structural stop. | specialized_finance_or_model_data, multi_clock_context, undefined_user_parameter | unsupported_semantic_or_data_requirement |
| NL042 | C | Two distinct entry pathways (new momentum vs add-on pullback), shared portfolio caps, path-dependent metrics and cooldowns. | multi_clock_context, event_order, state_or_memory, event_relative_time, undefined_user_parameter | proposed_graph_requiring_new_grammar |
| NL043 | B | Execution method branches on urgency/volatility context. | undefined_user_parameter | parameterized_graph_requiring_user_input |
| NL044 | C | Exit policy combines hard downside stop with open-ended trailing profit management. | undefined_user_parameter, asset_set_composition | proposed_graph_requiring_new_grammar |
| NL045 | D | Meta-strategy chooses child strategy based on regime classification. | option_contract_or_lifecycle, specialized_finance_or_model_data, event_order, state_or_memory, undefined_user_parameter | unsupported_semantic_or_data_requirement |
| NL046 | D | Same named strategy has incompatible management semantics; rolling must be an explicit policy rather than implied by strategy name. | option_contract_or_lifecycle, undefined_user_parameter | unsupported_semantic_or_data_requirement |
| NL047 | C | Lock the session opening range after 15 minutes; entries before formation are prohibited. | event_order, event_relative_time, exception_policy | proposed_graph_requiring_new_grammar |
| NL048 | C | Breakout is only a precursor; a later retest is required before entry evaluation. | event_order, state_or_memory, event_relative_time, undefined_user_parameter | proposed_graph_requiring_new_grammar |
| NL049 | C | Retest must be followed by directional candle confirmation. | event_order, state_or_memory, undefined_user_parameter | proposed_graph_requiring_new_grammar |
| NL050 | C | Optional stricter confirmation requires two consecutive confirming bars. | event_order, state_or_memory, undefined_user_parameter, exception_policy | proposed_graph_requiring_new_grammar |
| NL051 | C | Primary opening-range event is conditioned by levels derived from other session/time horizons. | multi_clock_context | proposed_graph_requiring_new_grammar |
| NL052 | C | Risk boundary is derived from the structural retest level. | undefined_user_parameter, asset_set_composition | proposed_graph_requiring_new_grammar |
| NL053 | D | Underlying eligibility depends on a discretionary ownership-acceptance predicate. | option_contract_or_lifecycle, undefined_user_parameter, external_judgment | unsupported_semantic_or_data_requirement |
| NL054 | D | Assignment changes strategy state; covered-call transition may be delayed by a rebound condition. | option_contract_or_lifecycle, undefined_user_parameter, exception_policy, external_judgment | unsupported_semantic_or_data_requirement |
| NL055 | D | Post-assignment transition can be gated by IV recovery instead of price recovery. | option_contract_or_lifecycle, undefined_user_parameter, exception_policy | unsupported_semantic_or_data_requirement |
| NL056 | D | Contract selection changes conditionally when the call is opened immediately after assignment. | option_contract_or_lifecycle, state_or_memory, event_relative_time, exception_policy | unsupported_semantic_or_data_requirement |
| NL057 | D | Strike constraint depends on path-dependent cost basis, not just current price. | option_contract_or_lifecycle | unsupported_semantic_or_data_requirement |
| NL058 | D | Covered-call strike policy depends on recovery state and prior entry economics. | option_contract_or_lifecycle, state_or_memory, undefined_user_parameter, exception_policy | unsupported_semantic_or_data_requirement |
| NL059 | D | Underwater assigned state triggers repeated short-DTE call cycle using delta-based strike selection. | option_contract_or_lifecycle, event_order, state_or_memory, undefined_user_parameter | unsupported_semantic_or_data_requirement |
| NL060 | D | Recovery event can trigger a roll transition on an existing covered call. | option_contract_or_lifecycle, event_order, state_or_memory, event_relative_time, undefined_user_parameter | unsupported_semantic_or_data_requirement |
| NL061 | D | Underwater state selects lower-delta contract as a different recovery policy. | option_contract_or_lifecycle, state_or_memory, undefined_user_parameter, exception_policy | unsupported_semantic_or_data_requirement |
| NL062 | C | Strategy can suspend one module, switch to hold/trailing-stop mode, then reactivate it after recovery. | event_order, state_or_memory, undefined_user_parameter, exception_policy | proposed_graph_requiring_new_grammar |
| NL063 | D | Remain in short-put state and repeat expirations until assignment event. | option_contract_or_lifecycle, event_order, state_or_memory, event_relative_time | unsupported_semantic_or_data_requirement |
| NL064 | D | Assignment is a state transition that changes the active strategy module. | option_contract_or_lifecycle | unsupported_semantic_or_data_requirement |
| NL065 | D | Call-away event closes the shares state and loops back to initial module. | option_contract_or_lifecycle, event_order, state_or_memory, event_relative_time | unsupported_semantic_or_data_requirement |
| NL066 | D | Market-regime event can override the normal strategy loop and enter a paused mode. | option_contract_or_lifecycle, undefined_user_parameter, exception_policy, external_judgment | unsupported_semantic_or_data_requirement |
| NL067 | E | Paused mode exits only after fuzzy bottom/strength confirmation. | undefined_user_parameter, external_judgment | unresolved_natural_language_meaning |
| NL068 | D | Crisis context modifies the normal post-assignment transition timing. | option_contract_or_lifecycle, undefined_user_parameter, exception_policy | unsupported_semantic_or_data_requirement |
| NL069 | E | Daily state enforces a maximum of one accepted trade after a subjective conviction gate. | undefined_user_parameter, exception_policy, external_judgment | unresolved_natural_language_meaning |
| NL070 | C | Session-time exclusion overrides otherwise valid entries. | undefined_user_parameter, exception_policy, asset_set_composition | proposed_graph_requiring_new_grammar |
| NL071 | C | Entry requires confluence of trend and structural-level context. | undefined_user_parameter, asset_set_composition | proposed_graph_requiring_new_grammar |
| NL072 | C | Entry automatically creates mutually exclusive exit orders. | event_order, state_or_memory | proposed_graph_requiring_new_grammar |
| NL073 | D | Instrument/contract policy restricts expression to directional long options. | option_contract_or_lifecycle, exception_policy | unsupported_semantic_or_data_requirement |
| NL074 | C | Entry window is relative to session-open event. | event_order, event_relative_time, undefined_user_parameter, exception_policy | proposed_graph_requiring_new_grammar |
| NL075 | B | Event calendar provides a global no-trade override. | exception_policy | parameterized_graph_requiring_user_input |
| NL076 | D | Option structure selection is a sequence of contract constraints. | option_contract_or_lifecycle | unsupported_semantic_or_data_requirement |
| NL077 | B | Execution method is constrained by a price derived from current quote. | exception_policy | parameterized_graph_requiring_user_input |
| NL078 | D | Stop can be expressed relative to trade-specific economics rather than price. | option_contract_or_lifecycle | unsupported_semantic_or_data_requirement |
| NL079 | D | A pre-entry observation window classifies morning direction and selects put-spread vs call-spread module. | option_contract_or_lifecycle, undefined_user_parameter | unsupported_semantic_or_data_requirement |
| NL080 | D | Contract strike is calculated from another option-market observation. | option_contract_or_lifecycle | unsupported_semantic_or_data_requirement |
| NL081 | E | External event context can override the core mechanical strategy. | undefined_user_parameter, exception_policy, external_judgment | unresolved_natural_language_meaning |
| NL082 | D | Directional/volatility regime filters gate an option-income module. | option_contract_or_lifecycle, multi_clock_context | unsupported_semantic_or_data_requirement |
| NL083 | D | Exit policy is explicitly chosen from prior strategy-level evidence, not a fixed generic rule. | option_contract_or_lifecycle, exception_policy, external_judgment | unsupported_semantic_or_data_requirement |
| NL084 | D | Entry requires proximity to an externally derived structural zone. | option_contract_or_lifecycle, specialized_finance_or_model_data, undefined_user_parameter, exception_policy | unsupported_semantic_or_data_requirement |
| NL085 | D | Risk boundary is selected from external options-positioning structure. | option_contract_or_lifecycle, specialized_finance_or_model_data, undefined_user_parameter | unsupported_semantic_or_data_requirement |
| NL086 | D | Session-level external statistic creates a no-trade state. | option_contract_or_lifecycle, specialized_finance_or_model_data, undefined_user_parameter, exception_policy | unsupported_semantic_or_data_requirement |
| NL087 | C | Structural touch creates a pending setup, not an immediate entry. | event_order, state_or_memory, undefined_user_parameter | proposed_graph_requiring_new_grammar |
| NL088 | C | Same local event is interpreted differently based on path and higher-timeframe context. | multi_clock_context, undefined_user_parameter | proposed_graph_requiring_new_grammar |
| NL089 | C | Rejection confirmation combines structural reversal with contemporaneous volume evidence. | undefined_user_parameter, asset_set_composition | proposed_graph_requiring_new_grammar |
| NL090 | C | A level is one feature in a configurable confluence rule. | undefined_user_parameter, asset_set_composition | proposed_graph_requiring_new_grammar |
| NL091 | C | Higher timeframe supplies setup state; lower timeframe supplies transition event. | multi_clock_context, event_order, state_or_memory, undefined_user_parameter | proposed_graph_requiring_new_grammar |
| NL092 | C | Context timeframe is constrained to a parent horizon relative to execution timeframe. | multi_clock_context, undefined_user_parameter, exception_policy | proposed_graph_requiring_new_grammar |
| NL093 | E | Event type overrides the normal top-down confirmation sequence. | multi_clock_context, undefined_user_parameter, exception_policy, external_judgment | unresolved_natural_language_meaning |
| NL094 | C | Two child strategies execute simultaneously as regime sensors. | multi_clock_context, state_or_memory | proposed_graph_requiring_new_grammar |
| NL095 | D | Strategy performance itself becomes a time series input to another model. | specialized_finance_or_model_data, multi_clock_context, event_order, state_or_memory | unsupported_semantic_or_data_requirement |
| NL096 | C | Indicator over strategy-level performance selects active child module. | multi_clock_context | proposed_graph_requiring_new_grammar |
| NL097 | B | Meta-strategy is motivated by regime-dependent failure modes of child strategies. | undefined_user_parameter | parameterized_graph_requiring_user_input |
| NL098 | C | Regime classifier routes control to different strategy modules. | state_or_memory, undefined_user_parameter, exception_policy | proposed_graph_requiring_new_grammar |
| NL099 | D | Parent market state controls child strategy eligibility. | specialized_finance_or_model_data, multi_clock_context, undefined_user_parameter | unsupported_semantic_or_data_requirement |
| NL100 | C | Regime state aggregates multi-market and higher-timeframe features. | multi_clock_context | proposed_graph_requiring_new_grammar |
| NL101 | D | Regime classifier consumes heterogeneous feature families before routing strategy behavior. | specialized_finance_or_model_data, multi_clock_context | unsupported_semantic_or_data_requirement |
| NL102 | C | Each timeframe has its own state machine; the parent view aggregates states. | multi_clock_context, state_or_memory | proposed_graph_requiring_new_grammar |
| NL103 | B | Cross-asset observations are grouped into macro pressure dimensions. | fragment_requires_explicit_context | parameterized_graph_requiring_user_input |
| NL104 | B | Multiple semantic modules feed a composite score and discrete state. | fragment_requires_explicit_context | parameterized_graph_requiring_user_input |
| NL105 | C | Different score thresholds trigger graded actions rather than one Boolean entry. | exception_policy, asset_set_composition | proposed_graph_requiring_new_grammar |
| NL106 | B | Context module modifies downstream strategy without owning entries. | exception_policy | parameterized_graph_requiring_user_input |
| NL107 | C | Factor families are evaluated per timeframe and normalized into comparable scores. | multi_clock_context | proposed_graph_requiring_new_grammar |
| NL108 | C | The weight of a signal is conditional on another classifier state. | multi_clock_context, exception_policy | proposed_graph_requiring_new_grammar |
| NL109 | B | Signal weight depends on symbol-specific trailing performance of that signal. | fragment_requires_explicit_context | parameterized_graph_requiring_user_input |
| NL110 | C | Exhaustion is an exception that reduces an otherwise strong composite signal. | multi_clock_context, undefined_user_parameter, exception_policy | proposed_graph_requiring_new_grammar |
| NL111 | C | Cross-timeframe disagreement is represented as its own transitional state. | multi_clock_context, undefined_user_parameter | proposed_graph_requiring_new_grammar |
| NL112 | C | Several heterogeneous observations contribute weighted points/bonuses to a score. | fragment_requires_explicit_context, asset_set_composition | proposed_graph_requiring_new_grammar |
| NL113 | C | Threshold crossing creates a pending state that must persist for N bars. | event_order, state_or_memory, exception_policy | proposed_graph_requiring_new_grammar |
| NL114 | C | Cooldown prevents rapid state oscillation after transition. | event_order, state_or_memory, exception_policy | proposed_graph_requiring_new_grammar |
| NL115 | B | State-change event informs downstream strategy but does not itself trade. | exception_policy | parameterized_graph_requiring_user_input |
| NL116 | C | Three semantic layers produce context, bias and event trigger separately. | multi_clock_context, event_order, state_or_memory | proposed_graph_requiring_new_grammar |
| NL117 | B | Context state must pass an additional trigger contract before action. | exception_policy | parameterized_graph_requiring_user_input |
| NL118 | C | Composite score accepts heterogeneous evidence families. | multi_clock_context, undefined_user_parameter | proposed_graph_requiring_new_grammar |
| NL119 | C | Regime is a multi-state categorical variable. | multi_clock_context | proposed_graph_requiring_new_grammar |
| NL120 | B | Transition is represented as a distinct intermediate state. | undefined_user_parameter | parameterized_graph_requiring_user_input |
| NL121 | C | Confidence is a derived value from agreement across horizons. | multi_clock_context | proposed_graph_requiring_new_grammar |
| NL122 | C | Risk module consumes current volatility and position state after upstream context. | fragment_requires_explicit_context, asset_set_composition | proposed_graph_requiring_new_grammar |
| NL123 | C | Child-strategy relative performance controls their parent allocation weights. | event_order, state_or_memory | proposed_graph_requiring_new_grammar |
| NL124 | B | Signed relative-performance state maps continuously to module weights. | fragment_requires_explicit_context | parameterized_graph_requiring_user_input |
| NL125 | C | Meta-allocation is passed through a temporal smoother before execution. | event_order, state_or_memory | proposed_graph_requiring_new_grammar |
| NL126 | C | Counterfactual child states are maintained for meta-decision making. | state_or_memory | proposed_graph_requiring_new_grammar |
| NL127 | C | Risk regime multiplicatively modifies downstream forecast sizing. | undefined_user_parameter, asset_set_composition | proposed_graph_requiring_new_grammar |
| NL128 | B | Nested aggregation first combines variants within each factor family, then combines families. | fragment_requires_explicit_context | parameterized_graph_requiring_user_input |
| NL129 | C | Post-composition transform rescales and clips the parent signal. | exception_policy, asset_set_composition | proposed_graph_requiring_new_grammar |
| NL130 | D | Monthly event computes a feature relative to an event-aligned historical quarter. | specialized_finance_or_model_data, multi_clock_context, event_order, state_or_memory, event_relative_time | unsupported_semantic_or_data_requirement |
| NL131 | D | Current event surprise is normalized by a rolling distribution of prior comparable events. | specialized_finance_or_model_data, event_order, state_or_memory, event_relative_time | unsupported_semantic_or_data_requirement |
| NL132 | C | Event-derived cross-sectional score feeds percentile selection. | fragment_requires_explicit_context, asset_set_composition | proposed_graph_requiring_new_grammar |
| NL133 | C | Multiple cross-sectional ranks are first-class intermediate results. | fragment_requires_explicit_context, asset_set_composition | proposed_graph_requiring_new_grammar |
| NL134 | C | Heterogeneous factor semantics are normalized through rank before weighted combination. | multi_clock_context | proposed_graph_requiring_new_grammar |
| NL135 | C | One ranking drives symmetric selection branches. | fragment_requires_explicit_context, asset_set_composition | proposed_graph_requiring_new_grammar |
| NL136 | C | Data-quality condition is a prerequisite to cross-sectional ranking. | exception_policy, asset_set_composition | proposed_graph_requiring_new_grammar |
| NL137 | B | Cross-sectional bucket membership is transformed into ordinal points. | fragment_requires_explicit_context | parameterized_graph_requiring_user_input |
| NL138 | C | Nested rank-score-rank pipeline constructs the final selection. | fragment_requires_explicit_context, asset_set_composition | proposed_graph_requiring_new_grammar |
| NL139 | C | Dynamic group membership is recomputed on schedule. | fragment_requires_explicit_context, asset_set_composition | proposed_graph_requiring_new_grammar |
| NL140 | D | Model stage depends on an upstream liquidity/price universe filter. | specialized_finance_or_model_data | unsupported_semantic_or_data_requirement |
| NL141 | D | Derived latent factors feed per-asset residual models before signal generation. | specialized_finance_or_model_data | unsupported_semantic_or_data_requirement |
| NL142 | D | Model residual state is filtered by a standardized threshold. | specialized_finance_or_model_data | unsupported_semantic_or_data_requirement |
| NL143 | D | Portfolio sizing is a function of signal magnitude. | specialized_finance_or_model_data | unsupported_semantic_or_data_requirement |
| NL144 | D | Pair identity itself is dynamically learned from a historical formation window. | specialized_finance_or_model_data | unsupported_semantic_or_data_requirement |
| NL145 | B | Relationship selection uses transformed relative price paths rather than raw prices. | fragment_requires_explicit_context | parameterized_graph_requiring_user_input |
| NL146 | C | Pair selection and trade trigger are separate stages. | event_order, state_or_memory, event_relative_time | proposed_graph_requiring_new_grammar |
| NL147 | C | Long-horizon cross-sectional contrarian ranking creates both portfolio tails. | multi_clock_context | proposed_graph_requiring_new_grammar |
| NL148 | C | Frequent scheduler contains a state counter that suppresses action until a long interval has elapsed. | event_order, state_or_memory, event_relative_time, exception_policy | proposed_graph_requiring_new_grammar |
| NL149 | C | Current price is standardized against its own rolling distribution. | undefined_user_parameter, asset_set_composition | proposed_graph_requiring_new_grammar |
| NL150 | C | Mean-reversion logic consumes an externally defined target set. | fragment_requires_explicit_context, asset_set_composition | proposed_graph_requiring_new_grammar |
| NL151 | B | A rolling volatility-like statistic is an upstream dependency of the band. | fragment_requires_explicit_context | parameterized_graph_requiring_user_input |
| NL152 | C | Entry boundary composes two differently windowed statistics. | multi_clock_context | proposed_graph_requiring_new_grammar |
| NL153 | C | Entry requires both structural deviation and intrabar-position confirmation. | fragment_requires_explicit_context, asset_set_composition | proposed_graph_requiring_new_grammar |
| NL154 | C | Exit is relative to a prior-event structural level rather than entry price. | event_order, state_or_memory, event_relative_time | proposed_graph_requiring_new_grammar |
| NL155 | B | Scheduled model inference produces per-asset forward scores. | fragment_requires_explicit_context | parameterized_graph_requiring_user_input |
| NL156 | D | Prediction sign gates portfolio eligibility. | specialized_finance_or_model_data | unsupported_semantic_or_data_requirement |
| NL157 | B | Model score controls allocation size, not only selection. | fragment_requires_explicit_context | parameterized_graph_requiring_user_input |
| NL158 | D | Which leg group to adjust depends on current tested/untested state. | option_contract_or_lifecycle, event_order, state_or_memory, event_relative_time, undefined_user_parameter | unsupported_semantic_or_data_requirement |
| NL159 | D | Adjustment operation preserves the internal relation of a multi-leg module. | option_contract_or_lifecycle, exception_policy | unsupported_semantic_or_data_requirement |
| NL160 | D | A thesis-state change can terminate the current strategy module and replace it. | option_contract_or_lifecycle, event_order, state_or_memory, undefined_user_parameter, exception_policy, external_judgment | unsupported_semantic_or_data_requirement |
| NL161 | B | Adjustment targets one submodule based on tested-state classification. | undefined_user_parameter | parameterized_graph_requiring_user_input |
| NL162 | D | Trade timing is defined relative to a scheduled corporate event. | option_contract_or_lifecycle, specialized_finance_or_model_data, event_order, state_or_memory, event_relative_time, undefined_user_parameter, exception_policy | unsupported_semantic_or_data_requirement |
| NL163 | D | Pre-event phase is a distinct risk state that can invalidate an otherwise correct thesis. | specialized_finance_or_model_data, undefined_user_parameter, exception_policy, external_judgment | unsupported_semantic_or_data_requirement |
| NL164 | D | Covered-call contract selection depends on the investor thesis and desired assignment probability. | option_contract_or_lifecycle, undefined_user_parameter, external_judgment | unsupported_semantic_or_data_requirement |
| NL165 | D | Coverage ratio, strike distance and DTE are jointly constrained variables rather than independent knobs. | option_contract_or_lifecycle, undefined_user_parameter | unsupported_semantic_or_data_requirement |
| NL166 | D | Option strategy starts with a multi-factor underlying eligibility screen. | option_contract_or_lifecycle, undefined_user_parameter | unsupported_semantic_or_data_requirement |
| NL167 | E | Relative-volume surge is used as a fuzzy proxy for latent company event/state. | undefined_user_parameter, external_judgment | unresolved_natural_language_meaning |
| NL168 | D | Entry contract and exit profit are linked to an intended theta-decay cycle. | option_contract_or_lifecycle | unsupported_semantic_or_data_requirement |
| NL169 | D | Assignment triggers a recovery branch using path-dependent cost basis and premium constraint. | option_contract_or_lifecycle, event_order, state_or_memory, event_relative_time, undefined_user_parameter, exception_policy | unsupported_semantic_or_data_requirement |

The complete machine-readable inputs, assumptions, typed nodes, unresolved inputs, capability dimensions, and complexity metrics are in `corpus/blocky-169-case-matrix.json`.
