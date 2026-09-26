import { useEffect, useRef } from "react";
import type { ISeriesMarkersPluginApi, Time } from "lightweight-charts";
import type { BacktestResult } from "../domain/backtest";
import { availableResultEventFilters, chartResultEvents, projectResultChartSeries, resultEventsOnSeries, type ResultEventFilter, type ResultEventPresentation } from "../domain/resultEvents";

function money(value: string): string { return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(Number(value)); }
function percentage(value: string): string { return new Intl.NumberFormat("en-US", { style: "percent", minimumFractionDigits: 2 }).format(Number(value)); }
function markerColor(kind: ResultEventPresentation["category"]): string { return kind === "fallback" ? "#b87518" : kind === "eligibility" ? "#8a4d79" : kind === "portfolio" ? "#52778c" : "#286448"; }
function markerShape(kind: ResultEventPresentation["category"]): "circle" | "square" | "arrowUp" | "arrowDown" { return kind === "fallback" ? "square" : kind === "portfolio" ? "arrowUp" : kind === "eligibility" ? "arrowDown" : "circle"; }

function LightweightEquityChart({ result, events, selectedDecisionId, onSelectDecision }: { result: BacktestResult; events: ResultEventPresentation[]; selectedDecisionId?: string | null; onSelectDecision?: (event: ResultEventPresentation) => void }) {
  const host = useRef<HTMLDivElement>(null);
  const markerPlugin = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const latest = useRef({ events, selectedDecisionId, onSelectDecision });
  latest.current = { events, selectedDecisionId, onSelectDecision };

  useEffect(() => {
    if (!host.current) return;
    let active = true;
    let dispose = () => undefined;
    void import("lightweight-charts").then(({ AreaSeries, ColorType, createChart, createSeriesMarkers }) => {
      if (!active || !host.current) return;
      const chart = createChart(host.current, {
        autoSize: true, height: 280,
        layout: { background: { type: ColorType.Solid, color: "#ffffff" }, textColor: "#536159", attributionLogo: true },
        grid: { vertLines: { color: "#edf0ed" }, horzLines: { color: "#edf0ed" } },
        rightPriceScale: { borderColor: "#dce3de" },
        timeScale: { borderColor: "#dce3de", timeVisible: false, rightOffset: 2, barSpacing: 7, minBarSpacing: 2 },
        crosshair: { vertLine: { color: "#6d7b73", labelBackgroundColor: "#276746" }, horzLine: { color: "#aab5af", labelBackgroundColor: "#276746" } },
      });
      const series = chart.addSeries(AreaSeries, { lineColor: "#20714d", topColor: "rgba(32,113,77,.28)", bottomColor: "rgba(32,113,77,.03)", lineWidth: 3 });
      const chartSeries = projectResultChartSeries(result);
      series.setData(chartSeries);
      const markerApi = createSeriesMarkers(series, []);
      markerPlugin.current = markerApi;
      const updateMarkers = () => markerApi.setMarkers(chartResultEvents(resultEventsOnSeries(latest.current.events, chartSeries), latest.current.selectedDecisionId ?? null).map((event) => ({
        id: event.decisionId, time: event.sessionId, position: "aboveBar" as const, shape: markerShape(event.category),
        color: event.decisionId === latest.current.selectedDecisionId ? "#172b22" : markerColor(event.category),
        size: event.decisionId === latest.current.selectedDecisionId ? 1.8 : 1,
        text: event.decisionId === latest.current.selectedDecisionId ? event.label : undefined,
      })));
      updateMarkers();
      const click = (parameter: { hoveredObjectId?: unknown; hoveredInfo?: { objectId?: unknown } }) => {
        const id = String(parameter.hoveredInfo?.objectId ?? parameter.hoveredObjectId ?? "");
        const selected = latest.current.events.find((event) => event.decisionId === id);
        if (selected) latest.current.onSelectDecision?.(selected);
      };
      chart.subscribeClick(click);
      const fitFrame = window.requestAnimationFrame(() => chart.timeScale().fitContent());
      dispose = () => { window.cancelAnimationFrame(fitFrame); markerPlugin.current = null; chart.unsubscribeClick(click); chart.remove(); };
    });
    return () => { active = false; dispose(); };
  }, [result]);

  useEffect(() => {
    const chartEvents = resultEventsOnSeries(events, projectResultChartSeries(result));
    markerPlugin.current?.setMarkers(chartResultEvents(chartEvents, selectedDecisionId ?? null).map((event) => ({
      id: event.decisionId, time: event.sessionId, position: "aboveBar" as const, shape: markerShape(event.category),
      color: event.decisionId === selectedDecisionId ? "#172b22" : markerColor(event.category), size: event.decisionId === selectedDecisionId ? 1.8 : 1,
      text: event.decisionId === selectedDecisionId ? event.label : undefined,
    })));
  }, [events, result, selectedDecisionId]);

  const markerCount = chartResultEvents(resultEventsOnSeries(events, projectResultChartSeries(result)), selectedDecisionId ?? null).length;
  return <>
    <div ref={host} className="equity-chart" role="img" aria-label={`Portfolio value equity curve with ${markerCount} overview markers from ${events.length} persisted Result events. Use the event list for every Decision.`} />
    <p className="chart-attribution">Charting by <a href="https://www.tradingview.com/" target="_blank" rel="noreferrer">TradingView</a>. Decision meaning and Evidence are provided by RuleTrade.</p>
  </>;
}

const filterLabel: Record<ResultEventFilter, string> = { all: "All", selection: "Selections", fallback: "Fallback", eligibility: "Eligibility", portfolio: "Portfolio" };

export function BacktestResultPanel({ result, selectedDecisionId, allEvents = [], events = [], filter = "all", onFilter, onSelectDecision }: { result: BacktestResult; selectedDecisionId?: string | null; allEvents?: ResultEventPresentation[]; events?: ResultEventPresentation[]; filter?: ResultEventFilter; onFilter?: (filter: ResultEventFilter) => void; onSelectDecision?: (event: ResultEventPresentation) => void }) {
  const selected = events.find((event) => event.decisionId === selectedDecisionId);
  return <section className="backtest-panel" aria-label="Backtest result">
    <div className="result-question"><span className="eyebrow">How did it do?</span><h2>{money(result.initial_value)} became <strong>{money(result.final_value)}</strong></h2></div>
    <div className="result-metrics"><div><span>Initial value</span><strong>{money(result.initial_value)}</strong></div><div><span>Final value</span><strong>{money(result.final_value)}</strong></div><div><span>Total return</span><strong>{percentage(result.total_return)}</strong></div><div><span>Total orders</span><strong>{result.total_orders}</strong></div><div><span>Total fees</span><strong>{money(result.total_fees)}</strong></div></div>
    <div className="chart-heading"><div><span className="eyebrow">Portfolio value</span><h3>Value across the test period</h3></div><span>Scroll to zoom · drag to pan</span></div>
    {selected && <p className="chart-selection">Decision selected: {new Date(`${selected.sessionId}T00:00:00`).toLocaleDateString()} · {selected.label}</p>}
    <LightweightEquityChart result={result} events={events} selectedDecisionId={selectedDecisionId} onSelectDecision={onSelectDecision} />
    {onFilter && <div className="result-event-filters" role="group" aria-label="Filter Result events">{availableResultEventFilters(allEvents).map((item) => <button key={item} className={item === filter ? "active" : ""} aria-pressed={item === filter} onClick={() => onFilter(item)}>{filterLabel[item]} <span>{item === "all" ? allEvents.length : allEvents.filter((event) => event.category === item).length}</span></button>)}</div>}
  </section>;
}
