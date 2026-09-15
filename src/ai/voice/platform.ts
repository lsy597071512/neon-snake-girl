import { Capacitor } from '@capacitor/core';

export function isNativeApp(): boolean {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

export function nativePlatform(): string {
  try {
    return Capacitor.getPlatform();
  } catch {
    return 'web';
  }
}
