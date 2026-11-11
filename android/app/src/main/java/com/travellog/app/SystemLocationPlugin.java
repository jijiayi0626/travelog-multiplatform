package com.travellog.app;

import android.Manifest;
import android.content.Context;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.Bundle;
import android.os.Looper;

import androidx.annotation.NonNull;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

/**
 * 基于 Android 系统 LocationManager 的定位插件。
 *
 * 不使用 Google Play 服务（FusedLocationProvider），因此在没有 GMS 的设备
 * （华为鸿蒙、部分国产 ROM、AOSP）上同样可用。
 *
 * 前端通过 registerPlugin('SystemLocation') 调用。
 */
@CapacitorPlugin(
    name = "SystemLocation",
    permissions = {
        @Permission(
            alias = "location",
            strings = {
                Manifest.permission.ACCESS_FINE_LOCATION,
                Manifest.permission.ACCESS_COARSE_LOCATION
            }
        )
    }
)
public class SystemLocationPlugin extends Plugin {

    private LocationListener watchListener;

    private LocationManager manager() {
        return (LocationManager) getContext().getSystemService(Context.LOCATION_SERVICE);
    }

    @PluginMethod
    public void requestPermission(PluginCall call) {
        if (getPermissionState("location") == PermissionState.GRANTED) {
            JSObject ret = new JSObject();
            ret.put("granted", true);
            call.resolve(ret);
            return;
        }
        requestPermissionForAlias("location", call, "permissionCallback");
    }

    @PermissionCallback
    private void permissionCallback(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("granted", getPermissionState("location") == PermissionState.GRANTED);
        call.resolve(ret);
    }

    @PluginMethod
    public void getCurrent(PluginCall call) {
        if (getPermissionState("location") != PermissionState.GRANTED) {
            call.reject("未授予定位权限");
            return;
        }

        LocationManager locationManager = manager();
        if (locationManager == null) {
            call.reject("系统定位服务不可用");
            return;
        }

        try {
            // 先用最近一次已知位置，通常足够打卡
            Location best = null;
            for (String provider : locationManager.getProviders(true)) {
                Location last = locationManager.getLastKnownLocation(provider);
                if (last == null) {
                    continue;
                }
                if (best == null || last.getTime() > best.getTime()) {
                    best = last;
                }
            }
            if (best != null && System.currentTimeMillis() - best.getTime() < 10 * 60 * 1000L) {
                call.resolve(toResult(best));
                return;
            }
        } catch (SecurityException ignored) {
            // 继续走主动请求
        } catch (Exception ignored) {
            // 继续走主动请求
        }

        requestSingle(call);
    }

    private void requestSingle(PluginCall call) {
        LocationManager locationManager = manager();
        if (locationManager == null) {
            call.reject("系统定位服务不可用");
            return;
        }

        final LocationListener[] holder = new LocationListener[1];
        final boolean[] done = new boolean[] { false };

        LocationListener listener = new LocationListener() {
            @Override
            public void onLocationChanged(@NonNull Location location) {
                if (done[0]) {
                    return;
                }
                done[0] = true;
                try {
                    if (holder[0] != null) {
                        manager().removeUpdates(holder[0]);
                    }
                } catch (Exception ignored) {
                    // 忽略
                }
                call.resolve(toResult(location));
            }

            @Override
            public void onProviderEnabled(@NonNull String provider) {}

            @Override
            public void onProviderDisabled(@NonNull String provider) {}
        };
        holder[0] = listener;

        try {
            boolean hasNetwork = locationManager.isProviderEnabled(LocationManager.NETWORK_PROVIDER);
            boolean hasGps = locationManager.isProviderEnabled(LocationManager.GPS_PROVIDER);

            if (!hasNetwork && !hasGps) {
                call.reject("系统定位服务未开启，请在设置里打开定位");
                return;
            }

            if (hasNetwork) {
                locationManager.requestLocationUpdates(
                    LocationManager.NETWORK_PROVIDER, 0L, 0f, listener, Looper.getMainLooper());
            }
            if (hasGps) {
                locationManager.requestLocationUpdates(
                    LocationManager.GPS_PROVIDER, 0L, 0f, listener, Looper.getMainLooper());
            }
        } catch (SecurityException error) {
            call.reject("缺少定位权限");
        } catch (Exception error) {
            call.reject(error.getMessage() == null ? "定位失败" : error.getMessage());
        }
    }

    @PluginMethod
    public void watch(PluginCall call) {
        if (getPermissionState("location") != PermissionState.GRANTED) {
            call.reject("未授予定位权限");
            return;
        }

        LocationManager locationManager = manager();
        if (locationManager == null) {
            call.reject("系统定位服务不可用");
            return;
        }

        if (watchListener != null) {
            try {
                locationManager.removeUpdates(watchListener);
            } catch (Exception ignored) {
                // 忽略
            }
            watchListener = null;
        }

        LocationListener listener = new LocationListener() {
            @Override
            public void onLocationChanged(@NonNull Location location) {
                notifyListeners("locationChange", toResult(location));
            }

            @Override
            public void onProviderEnabled(@NonNull String provider) {}

            @Override
            public void onProviderDisabled(@NonNull String provider) {}
        };

        try {
            boolean hasNetwork = locationManager.isProviderEnabled(LocationManager.NETWORK_PROVIDER);
            boolean hasGps = locationManager.isProviderEnabled(LocationManager.GPS_PROVIDER);

            if (!hasNetwork && !hasGps) {
                call.reject("系统定位服务未开启，请在设置里打开定位");
                return;
            }

            // 5 秒、10 米：打卡场景足够，且比纯 GPS 省电
            if (hasNetwork) {
                locationManager.requestLocationUpdates(
                    LocationManager.NETWORK_PROVIDER, 5000L, 10f, listener, Looper.getMainLooper());
            }
            if (hasGps) {
                locationManager.requestLocationUpdates(
                    LocationManager.GPS_PROVIDER, 5000L, 10f, listener, Looper.getMainLooper());
            }
        } catch (SecurityException error) {
            call.reject("缺少定位权限");
            return;
        } catch (Exception error) {
            call.reject(error.getMessage() == null ? "定位失败" : error.getMessage());
            return;
        }

        watchListener = listener;
        JSObject ret = new JSObject();
        ret.put("watching", true);
        call.resolve(ret);
    }

    @PluginMethod
    public void clearWatch(PluginCall call) {
        if (watchListener != null) {
            try {
                LocationManager locationManager = manager();
                if (locationManager != null) {
                    locationManager.removeUpdates(watchListener);
                }
            } catch (Exception ignored) {
                // 忽略
            }
            watchListener = null;
        }
        call.resolve();
    }

    @Override
    protected void handleOnDestroy() {
        if (watchListener != null) {
            try {
                LocationManager locationManager = manager();
                if (locationManager != null) {
                    locationManager.removeUpdates(watchListener);
                }
            } catch (Exception ignored) {
                // 忽略
            }
            watchListener = null;
        }
        super.handleOnDestroy();
    }

    private JSObject toResult(Location location) {
        JSObject ret = new JSObject();
        ret.put("latitude", location.getLatitude());
        ret.put("longitude", location.getLongitude());
        ret.put("accuracy", location.hasAccuracy() ? location.getAccuracy() : -1);
        ret.put("timestamp", location.getTime());
        return ret;
    }
}