import { useCallback, useState } from "react";

import { planV2BuilderCommand } from "../domain/builderCommandBoundary";
import type { BuilderProductOperation, V2ProductAddress } from "../domain/builderProductOperations";
import type { CanonicalStrategyV2, V2AuthoringOperation } from "../domain/canonicalV2";

export function useV2BuilderCommandController({
  strategy,
  clockId,
  apply,
}: {
  strategy: CanonicalStrategyV2;
  clockId?: string;
  apply: (operation: V2AuthoringOperation) => void;
}) {
  const [feedback, setFeedback] = useState<string | null>(null);

  const clearFeedback = useCallback(() => setFeedback(null), []);
  const dispatch = useCallback((operation: BuilderProductOperation, address: V2ProductAddress = {}) => {
    const plan = planV2BuilderCommand(strategy, operation, { clockId, ...address });
    if (plan.status !== "ready") {
      setFeedback(plan.productMessage);
      return false;
    }
    setFeedback(null);
    apply(plan.operation);
    return true;
  }, [apply, clockId, strategy]);

  return { dispatch, feedback, clearFeedback };
}
