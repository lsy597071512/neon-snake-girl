import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { SplashScreen } from '@capacitor/splash-screen';
import { StatusBar, Style } from '@capacitor/status-bar';

export async function initNativePlatform(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;

  document.documentElement.classList.add('capacitor-native');
  document.body.style.overscrollBehavior = 'none';
  document.body.style.margin = '0';
  document.body.style.padding = '0';

  await Promise.allSettled([
    StatusBar.setStyle({ style: Style.Dark }),
    StatusBar.setBackgroundColor({ color: '#0a0b0f' }),
    StatusBar.setOverlaysWebView({ overlay: true }),
    SplashScreen.hide(),
  ]);

  void App.addListener('backButton', ({ canGoBack }) => {
    if (!canGoBack) void App.minimizeApp();
  });
}
