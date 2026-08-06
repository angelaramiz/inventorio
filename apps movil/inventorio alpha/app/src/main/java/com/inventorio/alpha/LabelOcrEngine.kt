package com.inventorio.alpha

import android.content.Context
import android.graphics.Bitmap
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.io.ByteArrayOutputStream

/**
 * Motor de OCR para etiquetas de ropa — Maestro-Estudiante edition.
 *
 * Arquitectura de 2 tiers:
 *  1. ML Kit Text Recognition (local, on-device, ~100ms, $0)
 *     - Extrae texto crudo con ML Kit
 *     - LabelTextParser analiza con heurísticas + regex
 *     - Confidence scoring determina si necesita verificación
 *
 *  2. Server fallback (Groq → Gemini, requiere internet)
 *     - Se usa si ML Kit falla o devuelve texto insuficiente
 *     - Procesamiento en el servidor con IA de mayor capacidad
 *
 * Opcional: Groq second opinion (usuario habilita)
 *  - Si confidence < threshold, envía a Groq como segunda opinión
 *  - Costo: ~$0.001 por imagen (solo las inciertas)
 *
 * Flujo de datos:
 *  Bitmap → ML Kit → Texto → Parser → LabelOcrResult
 *                                  ↓
 *                          ¿Confianza < 60%?
 *                          Sí → Groq second opinion
 *                          No → devolver resultado
 */
class LabelOcrEngine(
    private val context: Context,
    private val client: OkHttpClient,
    private val serverUrl: String
) {
    companion object {
        private const val TAG = "LabelOcrEngine"

        // Confidence threshold: por debajo de esto, Groq second opinion es recomendado
        const val CONFIDENCE_THRESHOLD = 60

        // ─── Backward compat stubs (para ModelDownloadDialog/Service) ──────

        data class ModelConfig(
            val id: String,
            val displayName: String,
            val ggufFileName: String = "",
            val mmprojFileName: String = "",
            val baseUrl: String = "",
            val dirName: String = "mlkit_ocr",
            val totalBytes: Long = 0L
        ) {
            val ggufUrl get() = "$baseUrl/$ggufFileName"
            val mmprojUrl get() = "$baseUrl/$mmprojFileName"

            fun destDir(context: Context): java.io.File =
                java.io.File(context.filesDir, dirName)
        }

        private val MLKIT_CONFIG = ModelConfig(
            id = "mlkit",
            displayName = "ML Kit Text Recognition"
        )

        val AVAILABLE_MODELS = listOf(MLKIT_CONFIG)
        private var currentConfig: ModelConfig = MLKIT_CONFIG

        fun getModelConfig(id: String): ModelConfig? =
            AVAILABLE_MODELS.find { it.id == id }

        fun getCurrentConfig(): ModelConfig = currentConfig

        fun setCurrentConfig(config: ModelConfig) {
            currentConfig = config
        }
    }

    // ─── Estado público ──────────────────────────────────────────

    /** ML Kit siempre está listo — no necesita descarga */
    val isModelReady: Boolean get() = true

    val modelSizeDescription: String get() = "ML Kit (on-device)"

    /** Solo para compatibilidad: always true */
    val isAvailable: Boolean get() = true

    // ─── Backward compat stubs (para MainActivity/LogsView/ModelDownloadDialog) ──

    val modelDir: java.io.File
        get() = java.io.File(context.filesDir, "mlkit_ocr")

    val ggufFile: java.io.File
        get() = java.io.File(modelDir, "mlkit_placeholder.gguf")

    val mmprojFile: java.io.File
        get() = java.io.File(modelDir, "mlkit_placeholder.mmproj")

    @Deprecated("ML Kit no necesita init", ReplaceWith("true"))
    fun initLocalModel(): Boolean {
        AppLogger.i(TAG, "✅ ML Kit — siempre listo.")
        return true
    }

    @Deprecated("ML Kit no necesita descarga", ReplaceWith("true"))
    fun downloadModel(onProgress: (Int) -> Unit, onDone: (Boolean, String) -> Unit) {
        onProgress(100)
        onDone(true, "ML Kit no necesita descarga — siempre disponible on-device")
    }

    @Deprecated("ML Kit no tiene modelo que borrar", ReplaceWith("true"))
    fun deleteModel(): Boolean {
        AppLogger.i(TAG, "ML Kit — no hay modelo que borrar.")
        return true
    }

    // ─── Punto de entrada principal ──────────────────────────────

    /**
     * Analiza un bitmap y extrae campos de la etiqueta.
     * Estrategia: ML Kit primero → Server fallback si falla.
     *
     * @param bitmap Imagen de la etiqueta
     * @param enableGroqVerification Si true y confidence < threshold, usa Groq como segunda opinión
     * @return LabelOcrResult con campos extraídos
     */
    suspend fun analyze(
        bitmap: Bitmap,
        enableGroqVerification: Boolean = false,
        barcode: String? = null
    ): LabelOcrResult {
        AppLogger.i(TAG, "=== analyze() iniciado ===")

        // Tier 1: ML Kit (local, rápido, gratis)
        AppLogger.i(TAG, "→ Intentando ML Kit Text Recognition")
        try {
            val result = MlKitLabelOcrEngine.analyze(bitmap, barcode = barcode)
            val confidence = extractConfidence(result.source)

            AppLogger.i(TAG, "✅ ML Kit resultado: confidence=$confidence, modelo=${result.modeloGrupo}, talla=${result.talla}")

            // Si confidence es alta, devolver directamente
            if (confidence >= CONFIDENCE_THRESHOLD) {
                AppLogger.i(TAG, "✅ Confianza alta ($confidence >= $CONFIDENCE_THRESHOLD). Resultado final.")
                return result
            }

            // Si confidence es baja y verificación está habilitada, intentar Groq
            if (enableGroqVerification && confidence < CONFIDENCE_THRESHOLD) {
                AppLogger.i(TAG, "⚠️ Confianza baja ($confidence < $CONFIDENCE_THRESHOLD). Intentando Groq second opinion...")
                val groqResult = analyzeViaGroq(bitmap)
                if (groqResult.hasAnyData) {
                    // Usar el de mayor confidence
                    val groqConf = extractConfidence(groqResult.source)
                    if (groqConf > confidence) {
                        AppLogger.i(TAG, "✅ Groq devolvió mejor resultado (confidence=$groqConf)")
                        return groqResult
                    }
                }
            }

            // Si ML Kit extrajo algo, devolverlo (aunque con confidence baja)
            if (result.hasAnyData) {
                AppLogger.i(TAG, "⚠️ ML Kit con confianza baja pero con datos. Devolviendo resultado.")
                return result
            }
        } catch (e: Throwable) {
            AppLogger.e(TAG, "❌ ML Kit falló: ${e.message}")
        }

        // Tier 2: Server fallback (Groq → Gemini)
        AppLogger.i(TAG, "→ Fallback SERVIDOR ☁️")
        return analyzeRemote(bitmap)
    }

    /**
     * Versión simplificada para compatibilidad con código existente.
     */
    suspend fun analyze(bitmap: Bitmap): LabelOcrResult {
        return analyze(bitmap, enableGroqVerification = false)
    }

    // ─── Groq directo (second opinion) ──────────────────────────

    private suspend fun analyzeViaGroq(bitmap: Bitmap): LabelOcrResult {
        return try {
            val bytes = bitmapToJpeg(bitmap, 85)
            val body = MultipartBody.Builder()
                .setType(MultipartBody.FORM)
                .addFormDataPart("foto", "label.jpg", bytes.toRequestBody("image/jpeg".toMediaType()))
                .build()
            val request = Request.Builder()
                .url("${serverUrl.trimEnd('/')}/api/ocr/extract-label")
                .post(body)
                .build()
            client.newCall(request).execute().use { response ->
                if (response.isSuccessful) {
                    parseJsonResponse(response.body?.string() ?: "{}", source = "groq-verification")
                } else {
                    LabelOcrResult.empty(source = "groq-failed")
                }
            }
        } catch (e: Exception) {
            LabelOcrResult.empty(source = "groq-error")
        }
    }

    // ─── Server fallback ────────────────────────────────────────

    suspend fun analyzeRemote(bitmap: Bitmap): LabelOcrResult {
        return try {
            val bytes = bitmapToJpeg(bitmap, 90)
            val body = MultipartBody.Builder()
                .setType(MultipartBody.FORM)
                .addFormDataPart("foto", "label.jpg", bytes.toRequestBody("image/jpeg".toMediaType()))
                .build()
            val request = Request.Builder()
                .url("${serverUrl.trimEnd('/')}/api/ocr/extract-label")
                .post(body)
                .build()
            client.newCall(request).execute().use { response ->
                if (response.isSuccessful) {
                    parseJsonResponse(response.body?.string() ?: "{}", source = "server")
                } else {
                    LabelOcrResult.empty(source = "server-error")
                }
            }
        } catch (e: Exception) {
            LabelOcrResult.empty(source = "error")
        }
    }

    // ─── Helpers ─────────────────────────────────────────────────

    private fun bitmapToJpeg(bitmap: Bitmap, quality: Int): ByteArray {
        return ByteArrayOutputStream().also { out ->
            bitmap.compress(Bitmap.CompressFormat.JPEG, quality, out)
        }.toByteArray()
    }

    private fun extractConfidence(source: String): Int {
        // source format: "mlkit-preprocessed-88" or "mlkit-original-88" or "mlkit-raw-75" or "server"
        val match = Regex("""mlkit-\w*-(\d+)""").find(source)
            ?: Regex("""mlkit-(\d+)""").find(source)
        return match?.groupValues?.get(1)?.toIntOrNull() ?: 50
    }

    private fun parseJsonResponse(raw: String, source: String): LabelOcrResult {
        return try {
            val jsonStart = raw.indexOf('{')
            val jsonEnd = raw.lastIndexOf('}')
            val jsonStr = if (jsonStart >= 0 && jsonEnd > jsonStart)
                raw.substring(jsonStart, jsonEnd + 1) else raw

            val json = JSONObject(jsonStr)
            var modelo = json.optString("modelo_grupo").takeIf { it != "null" && it.isNotBlank() }
                ?: json.optString("modelo").takeIf { it != "null" && it.isNotBlank() }
                ?: json.optString("model").takeIf { it != "null" && it.isNotBlank() }
            var color = json.optString("codigo_color").takeIf { it != "null" && it.isNotBlank() }
                ?: json.optString("color").takeIf { it != "null" && it.isNotBlank() }
                ?: json.optString("color_code").takeIf { it != "null" && it.isNotBlank() }
            val fecha = json.optString("fecha_temporada").takeIf { it != "null" && it.isNotBlank() }
                ?: json.optString("temporada").takeIf { it != "null" && it.isNotBlank() }
                ?: json.optString("season").takeIf { it != "null" && it.isNotBlank() }

            // Split modelo compuesto: "MODELO-COLOR"
            if (modelo != null && modelo.contains("-")) {
                val parts = modelo.split("-")
                modelo = parts[0].trim()
                if (color == null && parts.size > 1) color = parts[1].trim()
            }

            LabelOcrResult(
                marca = json.optString("marca").takeIf { it != "null" && it.isNotBlank() },
                talla = json.optString("talla").takeIf { it != "null" && it.isNotBlank() },
                sku = json.optString("sku").takeIf { it != "null" && it.isNotBlank() },
                modeloGrupo = modelo,
                codigoColor = color,
                fechaTemporada = fecha,
                source = source
            )
        } catch (e: Exception) {
            LabelOcrResult.empty(source = source)
        }
    }
}

data class LabelOcrResult(
    val marca: String?,
    val talla: String?,
    val sku: String?,
    val modeloGrupo: String?,
    val codigoColor: String? = null,
    val fechaTemporada: String? = null,
    val source: String
) {
    val hasAnyData: Boolean
        get() = marca != null || talla != null || sku != null || modeloGrupo != null || codigoColor != null || fechaTemporada != null

    companion object {
        fun empty(source: String) = LabelOcrResult(null, null, null, null, null, null, source)
    }
}
