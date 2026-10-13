package com.theluxurylord.bladesurge;

import com.getcapacitor.BridgeActivity;
import android.os.Bundle;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(StoreBridgePlugin.class);
        super.onCreate(savedInstanceState);
        // 디버그 산출물의 독립 QA에만 WebView 관찰을 허용한다.
        android.webkit.WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);
    }
}
