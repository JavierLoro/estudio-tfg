import { SettingsPanel } from '../panels/SettingsPanel';
import { useUI } from '../state/ui';
import { Modal } from './ui';

export default function SettingsWindow() {
  const open = useUI(s => s.settingsOpen);
  const close = () => useUI.setState({ settingsOpen: false });
  return (
    <Modal open={open} onClose={close} width={900} labelledBy="settings-title" keepMounted>
      <div className="h-[min(720px,80dvh)]">
        <SettingsPanel onClose={close} />
      </div>
    </Modal>
  );
}
