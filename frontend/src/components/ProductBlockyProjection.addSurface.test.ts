import { describe, expect, it, vi } from "vitest";

import { configurePersistentNativeAdd, syncPersistentNativeAdd } from "./ProductBlockyProjection";

describe("persistent native Blockly Add surface", () => {
  it("keeps the selected category flyout open after native block creation", () => {
    const setAutoClose = vi.fn();
    configurePersistentNativeAdd({ getFlyout: () => ({ setAutoClose }), refreshSelection: vi.fn() });
    expect(setAutoClose).toHaveBeenCalledWith(false);
  });

  it("restores the selected native category only when Add becomes visible", () => {
    const refreshSelection = vi.fn();
    const toolbox = { getFlyout: () => null, refreshSelection };
    syncPersistentNativeAdd(toolbox, false);
    expect(refreshSelection).not.toHaveBeenCalled();
    syncPersistentNativeAdd(toolbox, true);
    expect(refreshSelection).toHaveBeenCalledTimes(1);
  });
});
