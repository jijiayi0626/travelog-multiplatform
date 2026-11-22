package com.travellog.app;

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.util.Base64;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.mlkit.vision.common.InputImage;
import com.google.mlkit.vision.text.TextRecognition;
import com.google.mlkit.vision.text.TextRecognizer;
import com.google.mlkit.vision.text.chinese.ChineseTextRecognizerOptions;

/**
 * 使用 Google ML Kit 的中文文字识别模型，在手机本地读小票。
 * 不依赖云端模型，也不需要联网；前端通过 registerPlugin('ReceiptTextRecognition') 调用。
 */
@CapacitorPlugin(name = "ReceiptTextRecognition")
public class ReceiptTextRecognitionPlugin extends Plugin {

    private TextRecognizer recognizer;

    @Override
    public void load() {
        recognizer = TextRecognition.getClient(new ChineseTextRecognizerOptions.Builder().build());
    }

    @PluginMethod
    public void recognize(PluginCall call) {
        String data = call.getString("image");
        if (data == null || data.isEmpty()) {
            call.reject("缺少图片");
            return;
        }

        int comma = data.indexOf(',');
        String base64 = data.startsWith("data:") && comma >= 0 ? data.substring(comma + 1) : data;
        Bitmap bitmap;
        try {
            byte[] bytes = Base64.decode(base64, Base64.DEFAULT);
            bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.length);
        } catch (Exception error) {
            call.reject("图片解析失败");
            return;
        }
        if (bitmap == null) {
            call.reject("图片解析失败");
            return;
        }

        InputImage image = InputImage.fromBitmap(bitmap, 0);
        recognizer
            .process(image)
            .addOnSuccessListener(result -> {
                JSObject ret = new JSObject();
                ret.put("text", result.getText());
                call.resolve(ret);
            })
            .addOnFailureListener(error ->
                call.reject(error.getMessage() == null ? "识别失败" : error.getMessage())
            );
    }
}
