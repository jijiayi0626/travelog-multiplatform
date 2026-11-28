package com.travellog.app;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.speech.RecognizerIntent;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * 兼容语音通道：直接调起系统 RecognizerIntent。
 *
 * 不依赖 Google 语音服务，也没有 Vosk 模型加载开销。鸿蒙 NEXT 的 Android
 * 兼容层里若装有华为语音输入，会优先强制打开华为/荣耀语音，避免系统默认
 * 解析到 Google 语音。
 *
 * 前端通过 registerPlugin('LegacySpeech') 调用。
 */
@CapacitorPlugin(name = "LegacySpeech")
public class LegacySpeechPlugin extends Plugin {

    /** 记录每次识别请求实际选中的语音服务，供 Activity 回调返回 */
    private static final class PendingService {
        final String packageName;
        final String label;

        PendingService(String packageName, String label) {
            this.packageName = packageName;
            this.label = label;
        }
    }

    private final Map<String, PendingService> pendingServices = new HashMap<>();

    private Intent buildRecognizeIntent() {
        Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
        intent.putExtra(
            RecognizerIntent.EXTRA_LANGUAGE_MODEL,
            RecognizerIntent.LANGUAGE_MODEL_FREE_FORM
        );
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, "zh-CN");
        intent.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, false);
        return intent;
    }

    /**
     * 枚举所有能处理语音识别 Intent 的 Activity。
     * Manifest 已声明 queries，Android 11+ 也能查询到这些应用；不要改用
     * QUERY_ALL_PACKAGES。
     */
    private List<ResolveInfo> querySpeechServices() {
        PackageManager manager = getContext().getPackageManager();
        List<ResolveInfo> infos = manager.queryIntentActivities(buildRecognizeIntent(), 0);
        return infos == null ? Collections.<ResolveInfo>emptyList() : infos;
    }

    private static String packageOf(ResolveInfo info) {
        return info.activityInfo == null ? "" : info.activityInfo.packageName;
    }

    private static boolean isHuaweiOrHonor(String packageName) {
        return packageName.startsWith("com.huawei") || packageName.startsWith("com.hihonor");
    }

    private static boolean isGoogle(String packageName) {
        return packageName.startsWith("com.google");
    }

    /** 华为/荣耀优先，其次 Google，都没有再取第一个 */
    private static ResolveInfo pickPreferred(List<ResolveInfo> infos) {
        if (infos.isEmpty()) return null;
        for (ResolveInfo info : infos) {
            if (isHuaweiOrHonor(packageOf(info))) return info;
        }
        for (ResolveInfo info : infos) {
            if (isGoogle(packageOf(info))) return info;
        }
        return infos.get(0);
    }

    private static String labelOf(PackageManager manager, ResolveInfo info) {
        if (info == null) return "";
        CharSequence label = info.loadLabel(manager);
        return label == null ? "" : label.toString();
    }

    private static JSArray servicesToJson(PackageManager manager, List<ResolveInfo> infos) {
        JSArray services = new JSArray();
        for (ResolveInfo info : infos) {
            JSObject item = new JSObject();
            item.put("package", packageOf(info));
            item.put("label", labelOf(manager, info));
            services.put(item);
        }
        return services;
    }

    /** 查询系统语音服务，供诊断区分华为/荣耀与 Google */
    @PluginMethod
    public void available(PluginCall call) {
        JSObject ret = new JSObject();
        try {
            PackageManager manager = getContext().getPackageManager();
            List<ResolveInfo> infos = querySpeechServices();
            ResolveInfo preferred = pickPreferred(infos);
            ret.put("available", preferred != null);
            ret.put("services", servicesToJson(manager, infos));
            if (preferred != null) {
                ret.put("package", packageOf(preferred));
                ret.put("label", labelOf(manager, preferred));
            } else {
                ret.put("package", "");
                ret.put("label", "");
            }
        } catch (Exception error) {
            ret.put("available", false);
            ret.put("package", "");
            ret.put("label", "");
            ret.put("services", new JSArray());
            ret.put("detail", messageOf(error));
        }
        call.resolve(ret);
    }

    /** 只返回候选语音服务列表，不发起识别 */
    @PluginMethod
    public void services(PluginCall call) {
        JSObject ret = new JSObject();
        try {
            PackageManager manager = getContext().getPackageManager();
            ret.put("services", servicesToJson(manager, querySpeechServices()));
        } catch (Exception error) {
            ret.put("services", new JSArray());
            ret.put("detail", messageOf(error));
        }
        call.resolve(ret);
    }

    @PluginMethod
    public void recognize(PluginCall call) {
        Activity activity = getActivity();
        if (activity == null) {
            call.reject("当前没有可用的 Activity，无法打开系统语音输入");
            return;
        }

        PackageManager manager = getContext().getPackageManager();
        List<ResolveInfo> infos;
        try {
            infos = querySpeechServices();
        } catch (Exception error) {
            call.reject("查询系统语音服务失败：" + messageOf(error));
            return;
        }

        ResolveInfo preferred = pickPreferred(infos);
        if (preferred == null) {
            call.reject("系统没有可用的语音识别服务（没有应用能处理语音识别请求）");
            return;
        }

        String packageName = packageOf(preferred);
        String label = labelOf(manager, preferred);
        pendingServices.put(
            call.getCallbackId(),
            new PendingService(packageName, label)
        );

        Intent intent = buildRecognizeIntent();
        // 强制指定具体服务，避免系统又把请求交给 Google 语音
        intent.setClassName(packageName, preferred.activityInfo.name);
        try {
            startActivityForResult(call, intent, "speechResult");
        } catch (ActivityNotFoundException error) {
            pendingServices.remove(call.getCallbackId());
            call.reject("系统没有可用的语音识别服务（尝试的包：" + packageName + "）");
        } catch (Exception error) {
            pendingServices.remove(call.getCallbackId());
            call.reject("启动系统语音输入失败（尝试的包：" + packageName + "）：" + messageOf(error));
        }
    }

    @ActivityCallback
    private void speechResult(PluginCall call, ActivityResult result) {
        if (call == null) {
            return;
        }
        PendingService used = pendingServices.remove(call.getCallbackId());
        try {
            if (result == null) {
                call.reject("系统语音输入没有返回结果" + engineSuffix(used));
                return;
            }

            int resultCode = result.getResultCode();
            Intent data = result.getData();

            if (resultCode == Activity.RESULT_OK && data != null) {
                ArrayList<String> matches = data.getStringArrayListExtra(
                    RecognizerIntent.EXTRA_RESULTS
                );
                String text = matches != null && !matches.isEmpty() ? matches.get(0) : "";
                text = text == null ? "" : text.trim();
                if (text.isEmpty()) {
                    call.reject("系统语音没有识别到文字，请再说一次" + engineSuffix(used));
                    return;
                }
                JSObject ret = new JSObject();
                ret.put("text", text);
                putEngine(ret, used);
                call.resolve(ret);
                return;
            }

            if (resultCode == Activity.RESULT_CANCELED || data == null) {
                JSObject ret = new JSObject();
                ret.put("cancelled", true);
                putEngine(ret, used);
                call.resolve(ret);
                return;
            }

            call.reject("系统语音输入失败（返回码 " + resultCode + "）" + engineSuffix(used));
        } catch (Exception error) {
            call.reject("读取语音识别结果失败：" + messageOf(error) + engineSuffix(used));
        }
    }

    private static void putEngine(JSObject target, PendingService used) {
        if (used == null) return;
        target.put("package", used.packageName);
        target.put("label", used.label);
    }

    /** 错误信息带上尝试过的包名，便于诊断到底调到了哪个语音服务 */
    private static String engineSuffix(PendingService used) {
        return used == null ? "" : "（尝试的包：" + used.packageName + "）";
    }

    private static String messageOf(Exception error) {
        String message = error.getMessage();
        return message == null || message.isEmpty() ? "未知错误" : message;
    }
}
