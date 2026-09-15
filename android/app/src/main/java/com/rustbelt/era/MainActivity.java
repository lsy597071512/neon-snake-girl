package com.rustbelt.era;

import android.os.Bundle;
import android.webkit.WebSettings;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;

/**
 * 允许 WebView 在无手势时播放媒体，修复开局 BGM 必须点屏幕才响的问题。
 */
public class MainActivity extends BridgeActivity {
  @Override
  public void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    applyMediaPlaybackSettings();
  }

  @Override
  public void onStart() {
    super.onStart();
    applyMediaPlaybackSettings();
  }

  private void applyMediaPlaybackSettings() {
    if (this.bridge == null) return;
    WebView webView = this.bridge.getWebView();
    if (webView == null) return;
    WebSettings settings = webView.getSettings();
    settings.setMediaPlaybackRequiresUserGesture(false);
  }
}
