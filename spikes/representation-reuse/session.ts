import type { CanonicalStrategyV1, RegistryPayload } from "../../frontend/src/domain/canonical";
import type { StructuralAuthoringCapabilities, StructuralAuthoringOperation } from "../../frontend/src/structuralAuthoringApi";
import { projectLogic, type LogicStep } from "./logic";

export interface AuthoringPort {
  capabilities(strategy: CanonicalStrategyV1): Promise<StructuralAuthoringCapabilities>;
  apply(strategy: CanonicalStrategyV1, operation: StructuralAuthoringOperation): Promise<CanonicalStrategyV1>;
}

// Serializes gestures; a rejection never updates Canonical, capabilities, or the derived model.
export class LogicSession {
  steps: LogicStep[];
  capabilities: StructuralAuthoringCapabilities | null = null;
  private pending = false;
  constructor(public canonical: CanonicalStrategyV1, readonly registry: RegistryPayload, readonly port: AuthoringPort) {
    this.steps = projectLogic(canonical, registry);
  }
  async refresh(): Promise<void> { this.capabilities = await this.port.capabilities(this.canonical); }
  async apply(operation: StructuralAuthoringOperation): Promise<boolean> {
    if (this.pending) return false;
    this.pending = true;
    try {
      const result = await this.port.apply(this.canonical, operation);
      const nextSteps = projectLogic(result, this.registry);
      const nextCapabilities = await this.port.capabilities(result);
      this.canonical = result;
      this.steps = nextSteps;
      this.capabilities = nextCapabilities;
      return true;
    } finally { this.pending = false; }
  }
}
