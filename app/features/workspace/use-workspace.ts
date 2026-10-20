import { useState, useSyncExternalStore } from "react";
import { createWorkspaceStore } from "./workspace-store";

export function useWorkspace() {
  const [store] = useState(createWorkspaceStore);
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  return { ...snapshot, store };
}
