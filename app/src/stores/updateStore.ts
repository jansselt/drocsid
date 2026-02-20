import { create } from 'zustand';

export interface UpdateInfo {
  version: string;
  source: 'pwa' | 'tauri' | 'tauri-manual';
  installCmd?: string;
}

interface UpdateState {
  /** Available update info, null if no update */
  update: UpdateInfo | null;
  /** Whether the toast was dismissed (indicator still shows) */
  dismissed: boolean;
  /** Whether an update is actively downloading */
  updating: boolean;

  setUpdate: (update: UpdateInfo | null) => void;
  dismiss: () => void;
  undismiss: () => void;
  setUpdating: (v: boolean) => void;
}

export const useUpdateStore = create<UpdateState>((set) => ({
  update: null,
  dismissed: false,
  updating: false,

  setUpdate: (update) => set({ update, dismissed: false }),
  dismiss: () => set({ dismissed: true }),
  undismiss: () => set({ dismissed: false }),
  setUpdating: (updating) => set({ updating }),
}));
