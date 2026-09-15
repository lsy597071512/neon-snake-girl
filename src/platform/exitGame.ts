import { App as CapApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { showAlert } from '../ui/confirmDialog';

/** 退出游戏：原生直接退出；Web 尝试关闭窗口，失败则提示 */
export async function exitGame(): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    await CapApp.exitApp();
    return;
  }

  window.close();
  // 多数浏览器禁止脚本关页，给出明确提示
  await showAlert('退出游戏', '请直接关闭浏览器标签页以退出。', '知道了');
}
