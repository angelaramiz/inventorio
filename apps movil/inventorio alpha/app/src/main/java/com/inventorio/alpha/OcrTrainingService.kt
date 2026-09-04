package com.inventorio.alpha

import android.graphics.Bitmap
import android.util.Base64
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.io.ByteArrayOutputStream

/**
 * Servicio para guardar datos de entrenamiento OCR en Supabase.
 *
 * Cada imagen escaneada se guarda con:
 *  - imagen原始 (base64 JPEG)
 *  - imagen preprocesada (base64 JPEG, grayscale + binarizada)
 *  - resultado ML Kit (JSON)
 *  - metadata (modelo, talla, sku, etc.)
 *  - source (mlkit)
 *  - confidence score
 *
 * Esto permite:
 *  1. Re-entrenar PaddleOCR con datos reales
 *  2. Ground truth = confirmación/corrección del usuario (verdad absoluta)
 *  3. Analizar patrones de error de ML Kit
 *  4. Crear dataset etiquetado para fine-tuning
 */
class OcrTrainingService(
    private val client: OkHttpClient,
    private val serverUrl: String
) {
    companion object {
        private const val TAG = "OcrTrainingService"
        private const val IMAGE_QUALITY = 60       // JPEG quality (reduced for faster upload)
        private const val PREPROCESSED_QUALITY = 70 // Reduced for faster upload
        private const val MAX_IMAGE_DIM = 1200     // Max dimension for training images
    }

    data class TrainingSample(
        val originalBase64: String,      // Imagen original en base64
        val preprocessedBase64: String,  // Imagen preprocesada en base64
        val mlkitResult: LabelOcrResult, // Resultado de ML Kit
        val barcode: String?,            // Código de barras escaneado
        val imageWidth: Int,
        val imageHeight: Int,
        val preprocessingTimeMs: Long
    )

    /**
     * Guarda un sample de entrenamiento en el servidor.
     * El servidor lo almacena en Supabase para entrenamiento futuro.
     */
    suspend fun saveTrainingSample(sample: TrainingSample): Boolean = withContext(Dispatchers.IO) {
        try {
            val json = JSONObject().apply {
                put("image_original", sample.originalBase64)
                put("image_preprocessed", sample.preprocessedBase64)
                put("mlkit_result", JSONObject().apply {
                    put("marca", sample.mlkitResult.marca ?: JSONObject.NULL)
                    put("talla", sample.mlkitResult.talla ?: JSONObject.NULL)
                    put("sku", sample.mlkitResult.sku ?: JSONObject.NULL)
                    put("modelo_grupo", sample.mlkitResult.modeloGrupo ?: JSONObject.NULL)
                    put("codigo_color", sample.mlkitResult.codigoColor ?: JSONObject.NULL)
                    put("fecha_temporada", sample.mlkitResult.fechaTemporada ?: JSONObject.NULL)
                    put("source", sample.mlkitResult.source)
                })
                put("barcode", sample.barcode ?: JSONObject.NULL)
                put("image_width", sample.imageWidth)
                put("image_height", sample.imageHeight)
                put("preprocessing_time_ms", sample.preprocessingTimeMs)
                put("device_info", getDeviceInfo())
            }

            val body = json.toString()
                .toRequestBody("application/json".toMediaType())

            val request = Request.Builder()
                .url("${serverUrl.trimEnd('/')}/api/ocr/save-training")
                .post(body)
                .build()

            client.newCall(request).execute().use { response ->
                if (response.isSuccessful) {
                    AppLogger.i(TAG, "✅ Training sample guardado")
                    true
                } else {
                    AppLogger.w(TAG, "⚠️ Error guardando training sample: HTTP ${response.code}")
                    false
                }
            }
        } catch (e: Exception) {
            AppLogger.e(TAG, "❌ Error guardando training sample: ${e.message}")
            false
        }
    }

    /**
     * Crea un TrainingSample a partir de un bitmap y su resultado OCR.
     * Codifica ambas versiones (original y preprocesada) a base64.
     */
    fun createSample(
        originalBitmap: Bitmap,
        ocrResult: LabelOcrResult,
        barcode: String? = null
    ): TrainingSample {
        // Imagen original → base64
        val originalBase64 = bitmapToBase64(originalBitmap, IMAGE_QUALITY)

        // Imagen preprocesada → base64
        val preprocessed = ImagePreprocessor.preprocess(originalBitmap)
        val preprocessedBase64 = bitmapToBase64(preprocessed.bitmap, PREPROCESSED_QUALITY)

        return TrainingSample(
            originalBase64 = originalBase64,
            preprocessedBase64 = preprocessedBase64,
            mlkitResult = ocrResult,
            barcode = barcode,
            imageWidth = originalBitmap.width,
            imageHeight = originalBitmap.height,
            preprocessingTimeMs = preprocessed.processingTimeMs
        )
    }

    /**
     * Versión suspend que crea el sample con preprocesamiento async.
     */
    suspend fun createSampleAsync(
        originalBitmap: Bitmap,
        ocrResult: LabelOcrResult,
        barcode: String? = null
    ): TrainingSample = withContext(Dispatchers.IO) {
        createSample(originalBitmap, ocrResult, barcode)
    }

    // ─── Helpers ───────────────────────────────────────────────────

    private fun bitmapToBase64(bitmap: Bitmap, quality: Int): String {
        // Resize if too large to reduce base64 size
        val w = bitmap.width
        val h = bitmap.height
        val scaled = if (w > MAX_IMAGE_DIM || h > MAX_IMAGE_DIM) {
            val scale = MAX_IMAGE_DIM.toFloat() / maxOf(w, h)
            Bitmap.createScaledBitmap(bitmap, (w * scale).toInt(), (h * scale).toInt(), true)
        } else {
            bitmap
        }
        val stream = ByteArrayOutputStream()
        scaled.compress(Bitmap.CompressFormat.JPEG, quality, stream)
        val bytes = stream.toByteArray()
        val base64 = Base64.encodeToString(bytes, Base64.NO_WRAP)
        AppLogger.i(TAG, "Image encoded: ${bytes.size / 1024}KB, base64: ${base64.length / 1024}KB")
        return base64
    }

    private fun getDeviceInfo(): String {
        return "${android.os.Build.MANUFACTURER} ${android.os.Build.MODEL} " +
            "(Android ${android.os.Build.VERSION.RELEASE}, API ${android.os.Build.VERSION.SDK_INT})"
    }
}
