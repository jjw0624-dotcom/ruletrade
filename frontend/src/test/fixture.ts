import bootstrapPayload from "./generated-bootstrap.json";
import momentumBootstrapPayload from "./generated-momentum-bootstrap.json";

import type { EditorBootstrap } from "../domain/canonical";

// Generated on demand from ruletrade.api.editor_bootstrap; this file contains
// no frontend-owned strategy definition.
export const goldenBootstrap = bootstrapPayload as unknown as EditorBootstrap;
export const momentumBootstrap = momentumBootstrapPayload as unknown as EditorBootstrap;
