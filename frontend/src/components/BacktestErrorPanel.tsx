export function BacktestErrorPanel({ error }: { error: { code: string; message: string } }) {
  return (
    <div className="error-panel" role="alert">
      <strong>Backtest could not run</strong>
      <p>{error.message}</p>
      <code>{error.code}</code>
    </div>
  );
}
