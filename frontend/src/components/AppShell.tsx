import type { ReactNode } from "react";
import type { AppRoute } from "../domain/navigation";
import type { StrategyRecord } from "../strategyApi";

export function AppShell({ route, strategyName, recent, navigate, onCreate, children }: { route: AppRoute; strategyName?: string; recent: StrategyRecord[]; navigate: (route: AppRoute) => void; onCreate: () => void; children: ReactNode }) {
  if (route.page === "public") return <main className="app-shell">{children}</main>;
  if (route.page === "strategy") return <main className="app-shell builder-shell">{children}</main>;
  const libraryPage = route.page === "home" || route.page === "strategies" || route.page === "explore" || route.page === "example";
  return <main className={`app-shell${libraryPage ? " library-shell" : ""}`}><header className="app-header">
    <button className="brand" onClick={() => navigate({ page: "home" })}><span className="brand-mark">R</span><span>RuleTrade</span></button>
    <div className="header-context">{strategyName ? <><span>Open strategy</span><strong>{strategyName}</strong></> : <strong>{route.page === "home" ? "Home" : route.page === "strategies" ? "My strategies" : route.page === "explore" ? "Explore" : "Research"}</strong>}</div>
    <button className="header-new" onClick={onCreate}>+ New strategy</button>
  </header>{libraryPage ? <div className="library-layout"><aside className="product-sidebar"><nav aria-label="Workspace navigation"><button className={route.page === "home" ? "active" : ""} onClick={() => navigate({ page: "home" })}>Home</button><button className={route.page === "explore" || route.page === "example" ? "active" : ""} onClick={() => navigate({ page: "explore" })}>Explore</button><button className={route.page === "strategies" ? "active" : ""} onClick={() => navigate({ page: "strategies" })}>My strategies</button></nav>{recent.length > 0 && <section><span>Recent</span>{recent.slice(0, 5).map((strategy) => <button key={strategy.id} title={strategy.name} onClick={() => navigate({ page: "strategy", strategyId: strategy.id })}>{strategy.name}</button>)}</section>}</aside><div className="library-content">{children}</div></div> : children}</main>;
}
