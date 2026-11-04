import type { CanonicalStrategyV2, V2AuthoringOperation } from "./canonicalV2";
import {
  adaptV2ProductOperation,
  type BuilderProductOperation,
  type V2ProductAddress,
} from "./builderProductOperations";

export type BuilderCommandPlan =
  | {
      status: "ready";
      operation: V2AuthoringOperation;
    }
  | {
      status: "incomplete" | "unsupported";
      code: string;
      productMessage: string;
      technicalDetail: string;
    };

function missingContext(operation: BuilderProductOperation): string {
  switch (operation.kind) {
    case "setAssets":
      return "Choose the Group whose assets you want to edit.";
    case "setQualification":
      return "Create or choose a Selection before adding Qualification.";
    case "setSelection":
      return "Choose an Investment before configuring Selection.";
    case "setFallback":
      return "Create or choose a Selection before adding Fallback.";
    case "setAllocation":
      return "Create a Selection or provide complete Split investments before allocating capital.";
    default:
      return "Complete the required strategy context before applying this change.";
  }
}

/**
 * Plans exactly one atomic V2 authoring command.
 *
 * Product surfaces use this boundary for capability discovery instead of
 * treating an empty adapter array as a successful no-op. Multi-operation
 * batches remain unsupported until the CAS API exposes an atomic transaction.
 */
export function planV2BuilderCommand(
  strategy: CanonicalStrategyV2,
  operation: BuilderProductOperation,
  address: V2ProductAddress,
): BuilderCommandPlan {
  const operations = adaptV2ProductOperation(strategy, operation, address);
  if (operations.length === 1) return { status: "ready", operation: operations[0]! };
  if (operations.length === 0) {
    return {
      status: "incomplete",
      code: "missing_authoring_context",
      productMessage: missingContext(operation),
      technicalDetail: `No V2 authoring operation was produced for ${operation.kind}.`,
    };
  }
  return {
    status: "unsupported",
    code: "atomic_batch_required",
    productMessage: "This change requires an atomic authoring transaction that is not available yet.",
    technicalDetail: `The V2 product adapter produced ${operations.length} operations for ${operation.kind}.`,
  };
}
