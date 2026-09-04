package com.inventorio.alpha

import android.content.Context
import android.graphics.Bitmap

/**
 * Motor de OCR para etiquetas de ropa — solo on-device.
 *
 * Sin IA externa de ningún proveedor:
 *  1. ML Kit Text Recognition (local, on-device, ~100ms, $0)
 *     - Extrae texto crudo con ML Kit
 *     - LabelTextParser analiza con heurísticas + regex
 *  2. El usuario confirma o corrige en la UI de revisión.
 *     Esa confirmación/corrección es el ground truth (verdad absoluta)
 *     que alimenta el entrenamiento de PaddleOCR.
 *
 * Flujo de datos:
 *  Bitmap → ML Kit → Texto → Parser → LabelOcrResult → revisión usuario
 */
class LabelOcrEngine(
    private val context: Context
) {
    companion object {
        private const val TAG = "LabelOcrEngine"

        // Confidence threshold: por debajo de esto, el usuario debe revisar con más cuidado
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
     * Analiza un bitmap y extrae campos de la etiqueta — solo ML Kit.
     * El resultado (aunque sea de confianza baja) pasa a revisión del usuario,
     * cuya confirmación/corrección es el ground truth.
     *
     * @param bitmap Imagen de la etiqueta
     * @param barcode Código de barras asociado (si se escaneó)
     * @return LabelOcrResult con campos extraídos
     */
    suspend fun analyze(
        bitmap: Bitmap,
        barcode: String? = null
    ): LabelOcrResult {
        AppLogger.i(TAG, "=== analyze() iniciado (solo ML Kit) ===")

        return try {
            val result = MlKitLabelOcrEngine.analyze(bitmap, barcode = barcode)
            val confidence = extractConfidence(result.source)

            AppLogger.i(TAG, "✅ ML Kit resultado: confidence=$confidence, modelo=${result.modeloGrupo}, talla=${result.talla}")
            if (result.hasAnyData) {
                result
            } else {
                AppLogger.i(TAG, "⚠️ ML Kit sin datos — el usuario captura manualmente")
                LabelOcrResult.empty(source = "mlkit-empty")
            }
        } catch (e: Throwable) {
            AppLogger.e(TAG, "❌ ML Kit falló: ${e.message}")
            LabelOcrResult.empty(source = "mlkit-error")
        }
    }

    /**
     * Versión simplificada para compatibilidad con código existente.
     */
    suspend fun analyze(bitmap: Bitmap): LabelOcrResult {
        return analyze(bitmap, barcode = null)
    }

    // ─── Helpers ─────────────────────────────────────────────────

    private fun extractConfidence(source: String): Int {
        // source format: "mlkit-preprocessed-88" or "mlkit-original-88" or "mlkit-raw-75"
        val match = Regex("""mlkit-\w*-(\d+)""").find(source)
            ?: Regex("""mlkit-(\d+)""").find(source)
        return match?.groupValues?.get(1)?.toIntOrNull() ?: 50
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
