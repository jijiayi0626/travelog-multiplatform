package com.travellog.app;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.speech.RecognizerIntent;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.ArrayList;
import java.util.List;

/**
 * 兼容语音通道：直接调起系统 RecognizerIntent。
 *
 * 不依赖 Google 语音服务，也没有 Vosk 模型加载开销。华为鸿蒙 NEXT 的
 * Android 兼容层里若装有华为语音输入，可能响应这个 Intent。
 *
 * 前端通过 registerPlugin('LegacySpeech') 调用。
 */
@CapacitorPlugin(name = "LegacySpeech")
public class LegacySpeechPlugin extends Plugin {

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

    /** 查询系统里是否有 Activity 能处理语音识别 Intent（对应 Manifest 的 queries 声明） */
    @PluginMethod
    public void available(PluginCall call) {
        JSObject ret = new JSObject();
        try {
            PackageManager manager = getContext().getPackageManager();
            @SuppressWarnings("deprecation")
            List<ResolveInfo> activities = manager.queryIntentActivities(
                buildRecognizeIntent(),
                PackageManager.MATCH_DEFAULT_ONLY
            );
            ret.put("available", activities != null && !activities.isEmpty());
        } catch (Exception error) {
            ret.put("available", false);
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

        Intent intent = buildRecognizeIntent();
        try {
            startActivityForResult(call, intent, "speechResult");
        } catch (ActivityNotFoundException error) {
            call.reject("系统没有可用的语音识别服务（没有应用能处理语音识别请求）");
        } catch (Exception error) {
            call.reject("启动系统语音输入失败：" + messageOf(error));
        }
    }

    @ActivityCallback
    private void speechResult(PluginCall call, ActivityResult result) {
        if (call == null) {
            return;
        }
        try {
            if (result == null) {
                call.reject("系统语音输入没有返回结果");
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
                    call.reject("系统语音没有识别到文字，请再说一次");
                    return;
                }
                JSObject ret = new JSObject();
                ret.put("text", text);
                call.resolve(ret);
                return;
            }

            if (resultCode == Activity.RESULT_CANCELED || data == null) {
                JSObject ret = new JSObject();
                ret.put("cancelled", true);
                call.resolve(ret);
                return;
            }

            call.reject("系统语音输入失败（返回码 " + resultCode + "）");
        } catch (Exception error) {
            call.reject("读取语音识别结果失败：" + messageOf(error));
        }
    }

    private static String messageOf(Exception error) {
        String message = error.getMessage();
        return message == null || message.isEmpty() ? "未知错误" : message;
    }
}
