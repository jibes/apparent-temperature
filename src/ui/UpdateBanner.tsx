import { useEffect, useState } from 'react';
import { registerSW } from 'virtual:pwa-register';
import { t } from '../i18n';
import { isNative } from '../native';

// Service-worker registration with a prompt: a new build waits until the
// user taps "update" instead of swapping code under a running session.
// Skipped in the native shell, which ships its assets inside the APK.
export function UpdateBanner() {
  const [update, setUpdate] = useState<((reload?: boolean) => Promise<void>) | null>(null);

  useEffect(() => {
    if (isNative || !('serviceWorker' in navigator)) return;
    const updateSW = registerSW({
      onNeedRefresh: () => setUpdate(() => updateSW),
    });
  }, []);

  if (!update) return null;
  return (
    <div className="update-banner" role="status">
      <span>{t.update.available}</span>
      <button type="button" className="update-btn" onClick={() => void update(true)}>
        {t.update.reload}
      </button>
      <button type="button" className="update-dismiss" onClick={() => setUpdate(null)}>
        {t.update.dismiss}
      </button>
    </div>
  );
}
