package com.travellog.app;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // 注册不依赖 Google Play 服务的系统定位插件
        registerPlugin(SystemLocationPlugin.class);
        super.onCreate(savedInstanceState);
    }
}