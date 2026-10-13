import { create } from 'zustand';
import { api, type DesktopSetup } from '../api';

export const useDesktop = create<{
  info: DesktopSetup | null; open: boolean;
  setOpen: (open: boolean) => void; refresh: () => Promise<DesktopSetup | null>;
}>((set) => ({
  info: null, open: false,
  setOpen: (open) => set({ open }),
  refresh: async () => { const info = await api.desktopSetup(); set({ info }); return info; },
}));
