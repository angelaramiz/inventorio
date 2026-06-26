package com.inventorio.alpha

import android.content.Context
import android.graphics.Bitmap
import android.util.Log
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.FileOutputStream
import java.net.URL

/**
 * Motor de OCR para etiquetas de ropa.
 *
 * Estrategia dual:
 *  1. Modelo local: Qwen2.5-VL-2B via MNN-LLM (offline, rápido)
 *  2. Fallback: POST /api/ocr/extract-label en el servidor (requiere internet)
 *
 * El modelo se descarga on-demand (~1.2 GB) y se almacena en
 * getExternalFilesDir()/qwen_ocr_model/
 */
class LabelOcrEngine(
    private val context: Context,
    private val client: OkHttpClient,
    private val serverUrl: String
) {
    companion object {
        private const val TAG = "LabelOcrEngine"
        private const val MODEL_DIR_NAME = "qwen_ocr_model"

        // URL de descarga del modelo MNN pre-convertido
        // Fuente: DakeQQ/Qwen2.5-VL-2B-Instruct-For-Android en HuggingFace
        private const val MODEL_BASE_URL =
            "https://huggingface.co/DakeQQ/Qwen2.5-VL-2B-Instruct-For-Android/resolve/main/"

        // Archivos que componen el modelo (en orden de descarga)
        private val MODEL_FILES = listOf(
            "config.json",
            "tokenizer.json",
            "tokenizer_config.json",
            "embedding.mnn",
            "prefill.mnn",
            "decode.mnn",
            "visual.mnn"
        )

        // Prompt para extracción estructurada de etiqueta
        private val LABEL_EXTRACTION_PROMPT = """
            Analiza la imagen de esta etiqueta de ropa y extrae los datos que puedas ver.
            Responde ÚNICAMENTE con un objeto JSON válido en este formato exacto, sin texto adicional:
            {
              "marca": "nombre de la marca o null",
              "talla": "talla (XS/S/M/L/XL/número) o null",
              "sku": "código SKU o referencia del producto o null",
              "modelo_grupo": "nombre del modelo o colección o null"
            }
        """.trimIndent()
    }

    // ─── Estado público ───────────────────────────────────────────────────────

    val modelDir: File
        get() = File(context.getExternalFilesDir(null), MODEL_DIR_NAME)

    val isModelReady: Boolean
        get() = File(modelDir, "config.json").exists() &&
                File(modelDir, "decode.mnn").exists()

    val modelSizeDescription: String
        get() {
            val totalBytes = modelDir.walkTopDown()
                .filter { it.isFile }
                .sumOf { it.length() }
            return when {
                totalBytes > 1_000_000_000L -> "%.1f GB".format(totalBytes / 1_000_000_000.0)
                totalBytes > 1_000_000L -> "%.0f MB".format(totalBytes / 1_000_000.0)
                else -> "$totalBytes B"
            }
        }

    // ─── Punto de entrada principal ──────────────────────────────────────────

    /**
     * Analiza la imagen de una etiqueta y devuelve los datos extraídos.
     * Intenta el modelo local primero, cae al servidor si falla.
     *
     * @return OcrResult con los campos encontrados y una fuente indicando
     *         si fue "local" o "servidor".
     */
    suspend fun analyze(bitmap: Bitmap): LabelOcrResult = withContext(Dispatchers.IO) {
        // Intento 1: modelo local
        if (isModelReady && MnnLlmBridge.isAvailable) {
            try {
                val result = analyzeLocal(bitmap)
                if (result != null) return@withContext result
            } catch (e: Exception) {
                Log.w(TAG, "Inferencia local falló, usando servidor. Causa: ${e.message}")
            }
        } else if (isModelReady && !MnnLlmBridge.isAvailable) {
            // Modelo descargado pero .so no cargadas: intentar cargar ahora
            MnnLlmBridge.tryLoadLibraries()
            if (MnnLlmBridge.isAvailable) {
                MnnLlmBridge.initModel(modelDir.absolutePath)
                try {
                    val result = analyzeLocal(bitmap)
                    if (result != null) return@withContext result
                } catch (e: Exception) {
                    Log.w(TAG, "Inferencia local falló tras carga tardía: ${e.message}")
                }
            }
        }

        // Intento 2: fallback al servidor
        return@withContext analyzeRemote(bitmap)
    }

    // ─── Inferencia local (MNN-LLM) ──────────────────────────────────────────

    private suspend fun analyzeLocal(bitmap: Bitmap): LabelOcrResult? = withContext(Dispatchers.IO) {
        val raw = MnnLlmBridge.runVisionInference(bitmap, LABEL_EXTRACTION_PROMPT)
            ?: return@withContext null

        parseJsonResponse(raw, source = "local")
    }

    // ─── Fallback: servidor ───────────────────────────────────────────────────

    suspend fun analyzeRemote(bitmap: Bitmap): LabelOcrResult = withContext(Dispatchers.IO) {
        try {
            val bytes = ByteArrayOutputStream().also { out ->
                bitmap.compress(Bitmap.CompressFormat.JPEG, 90, out)
            }.toByteArray()

            val body = MultipartBody.Builder()
                .setType(MultipartBody.FORM)
                .addFormDataPart(
                    "foto",
                    "label.jpg",
                    bytes.toRequestBody("image/jpeg".toMediaType())
                )
                .build()

            val request = Request.Builder()
                .url("${serverUrl.trimEnd('/')}/api/ocr/extract-label")
                .post(body)
                .build()

            client.newCall(request).execute().use { response ->
                if (response.isSuccessful) {
                    val bodyText = response.body?.string() ?: "{}"
                    parseJsonResponse(bodyText, source = "servidor")
                } else {
                    Log.e(TAG, "Error del servidor OCR: ${response.code}")
                    LabelOcrResult.empty(source = "servidor")
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error contactando servidor OCR: ${e.message}")
            LabelOcrResult.empty(source = "error")
        }
    }

    // ─── Parser de respuesta JSON ─────────────────────────────────────────────

    private fun parseJsonResponse(raw: String, source: String): LabelOcrResult {
        return try {
            // Extraer el JSON del texto (el modelo a veces añade texto extra)
            val jsonStart = raw.indexOf('{')
            val jsonEnd = raw.lastIndexOf('}')
            val jsonStr = if (jsonStart >= 0 && jsonEnd > jsonStart) {
                raw.substring(jsonStart, jsonEnd + 1)
            } else raw

            val json = JSONObject(jsonStr)
            LabelOcrResult(
                marca = json.optString("marca").takeIf { it != "null" && it.isNotBlank() },
                talla = json.optString("talla").takeIf { it != "null" && it.isNotBlank() },
                sku = json.optString("sku").takeIf { it != "null" && it.isNotBlank() },
                modeloGrupo = json.optString("modelo_grupo").takeIf { it != "null" && it.isNotBlank() },
                source = source
            )
        } catch (e: Exception) {
            Log.e(TAG, "Error parseando respuesta OCR: ${e.message} — raw: $raw")
            LabelOcrResult.empty(source = source)
        }
    }

    // ─── Gestión del modelo ───────────────────────────────────────────────────

    /**
     * Descarga el modelo en background reportando progreso.
     * Debe llamarse desde un hilo de I/O.
     *
     * @param onProgress Int del 0 al 100
     * @param onDone Boolean: true si tuvo éxito, false si falló
     */
    fun downloadModel(onProgress: (Int) -> Unit, onDone: (Boolean) -> Unit) {
        try {
            modelDir.mkdirs()
            val totalFiles = MODEL_FILES.size

            MODEL_FILES.forEachIndexed { index, fileName ->
                val dest = File(modelDir, fileName)
                if (dest.exists() && dest.length() > 0) {
                    // Archivo ya descargado, saltar
                    onProgress(((index + 1) * 100) / totalFiles)
                    return@forEachIndexed
                }

                Log.i(TAG, "Descargando $fileName...")
                val url = URL(MODEL_BASE_URL + fileName)
                val connection = url.openConnection().also {
                    it.connectTimeout = 30_000
                    it.readTimeout = 120_000
                    it.connect()
                }

                val totalBytes = connection.contentLengthLong
                var downloaded = 0L

                connection.getInputStream().use { input ->
                    FileOutputStream(dest).use { output ->
                        val buffer = ByteArray(8192)
                        var bytesRead: Int
                        while (input.read(buffer).also { bytesRead = it } != -1) {
                            output.write(buffer, 0, bytesRead)
                            downloaded += bytesRead

                            // Progreso global: archivo actual + fracción del actual
                            val fileProgress = if (totalBytes > 0) {
                                (downloaded * 100 / totalBytes).toInt()
                            } else 50

                            val globalProgress = (index * 100 + fileProgress) / totalFiles
                            onProgress(globalProgress.coerceIn(0, 99))
                        }
                    }
                }

                onProgress(((index + 1) * 100) / totalFiles)
            }

            onProgress(100)
            onDone(true)
        } catch (e: Exception) {
            Log.e(TAG, "Error descargando modelo: ${e.message}")
            onDone(false)
        }
    }

    /**
     * Elimina todos los archivos del modelo del almacenamiento.
     */
    fun deleteModel(): Boolean {
        return try {
            MnnLlmBridge.destroyModel()
            modelDir.deleteRecursively()
        } catch (e: Exception) {
            Log.e(TAG, "Error borrando modelo: ${e.message}")
            false
        }
    }

    /**
     * Inicializa el bridge nativo con el modelo descargado.
     * Llamar después de que el modelo esté listo.
     */
    fun initNativeModel(): Boolean {
        if (!isModelReady) return false
        MnnLlmBridge.tryLoadLibraries()
        return if (MnnLlmBridge.isLoaded) {
            MnnLlmBridge.initModel(modelDir.absolutePath)
        } else false
    }
}

// ─── Modelo de datos de resultado ────────────────────────────────────────────

data class LabelOcrResult(
    val marca: String?,
    val talla: String?,
    val sku: String?,
    val modeloGrupo: String?,
    /** "local" | "servidor" | "error" */
    val source: String
) {
    val hasAnyData: Boolean
        get() = marca != null || talla != null || sku != null || modeloGrupo != null

    companion object {
        fun empty(source: String) = LabelOcrResult(
            marca = null,
            talla = null,
            sku = null,
            modeloGrupo = null,
            source = source
        )
    }
}
