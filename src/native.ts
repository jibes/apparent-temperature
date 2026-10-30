// The one place that knows whether we run inside the Capacitor shell.
// Browser-only features (service worker, update banner) check `isNative`.
import { Capacitor } from '@capacitor/core';

export const isNative: boolean = Capacitor.isNativePlatform();
