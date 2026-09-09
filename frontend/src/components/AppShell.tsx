import type { ReactNode } from "react";
import type { AppRoute } from "../domain/navigation";

export function AppShell({ route, strategyName, navigate, children }: { route: AppRoute; strategyName?: string; navigate: (route: AppRoute) => void; children: ReactNode }) {
  return <main className="app-shell"><header className="app-header">
    <button className="brand" onClick={() => navigate({ page: "explore" })}><span className="brand-mark">R</span><span>RuleTrade</span></button>
    <nav className="app-nav" aria-label="Main navigation"><button className={route.page === "explore" ? "active" : ""} onClick={() => navigate({ page: "explore" })}>Explore</button><button className={route.page === "strategies" ? "active" : ""} onClick={() => navigate({ page: "strategies" })}>Strategies</button></nav>
    <div className="header-context">{strategyName && <><span>Open strategy</span><strong>{strategyName}</strong></>}</div>
  </header>{children}</main>;
}
