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

/**
 * Motor de OCR para etiquetas de ropa — llama.cpp edition.
 *
 * Estrategia dual:
 *  1. Modelo local: Qwen2.5-VL-3B GGUF via llama.cpp (offline)
 *  2. Fallback: POST /api/ocr/extract-label en el servidor (requiere internet)
 *
 * El modelo GGUF (~2.3 GB Q4_K_M) se descarga de HuggingFace.
 */
class LabelOcrEngine(
    private val context: Context,
    private val client: OkHttpClient,
    private val serverUrl: String
) {
    companion object {
        private const val TAG = "LabelOcrEngine"
        private const val MODEL_DIR_NAME = "qwen_gguf_model"

        // Qwen2.5-VL-3B-Instruct GGUF Q4_K_M (~2.3 GB + ~500 MB mmproj)
        private const val GGUF_FILE_NAME = "Qwen2.5-VL-3B-Instruct-Q4_K_M.gguf"
        private const val MMPROJ_FILE_NAME = "mmproj-Qwen2.5-VL-3B-Instruct-Q8_0.gguf"

        // ggml-org (llama.cpp official) — público, sin auth requerida
        private const val HF_BASE_URL =
            "https://huggingface.co/ggml-org/Qwen2.5-VL-3B-Instruct-GGUF/resolve/main"

        private val MODEL_FILES = listOf(GGUF_FILE_NAME, MMPROJ_FILE_NAME)

        private val LABEL_EXTRACTION_PROMPT = """
            Analiza la imagen de esta etiqueta de ropa y extrae los datos que puedas ver.
            Responde ÚNICAMENTE con un objeto JSON válido en este formato exacto, sin texto adicional:
            {
              "marca": "nombre de la marca o null",
              "talla": "talla (XS/S/M/L/XL/número) o null",
              "sku": "código SKU o referencia del producto o null",
              "modelo_grupo": "nombre del modelo o colección o null",
              "codigo_color": "código de color o null",
              "fecha_temporada": "fecha o temporada o null"
            }
        """.trimIndent()
    }

    // ─── Estado público ──────────────────────────────────────────

    val modelDir: File
        get() = File(context.filesDir, MODEL_DIR_NAME)

    val ggufFile: File
        get() = File(modelDir, GGUF_FILE_NAME)

    val mmprojFile: File
        get() = File(modelDir, MMPROJ_FILE_NAME)

    val isModelReady: Boolean
        get() = ggufFile.exists() && ggufFile.length() > 1024 * 1024 * 100 // >100MB

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

    // ─── Punto de entrada principal ──────────────────────────────

    suspend fun analyze(bitmap: Bitmap): LabelOcrResult = withContext(Dispatchers.IO) {
        AppLogger.i("OCR", "=== analyze() iniciado ===")
        AppLogger.i("OCR", "isModelReady=$isModelReady | isLoaded=${LlamacppBridge.isLoaded} | isAvailable=${LlamacppBridge.isAvailable}")

        if (isModelReady && LlamacppBridge.isAvailable) {
            AppLogger.i("OCR", "→ Intentando inferencia LOCAL ⚡ (llama.cpp)")
            try {
                val result = analyzeLocal(bitmap)
                if (result != null) {
                    AppLogger.i("OCR", "✅ Resultado LOCAL obtenido.")
                    return@withContext result
                }
                AppLogger.w("OCR", "⚠️ analyzeLocal devolvió null. Intentando servidor.")
            } catch (e: Throwable) {
                AppLogger.e("OCR", "❌ Inferencia LOCAL falló: ${e.message}")
            }
        } else if (isModelReady && !LlamacppBridge.isAvailable) {
            AppLogger.w("OCR", "⚠️ Modelo listo pero sesión inactiva. Iniciando...")
            LlamacppBridge.initModel(context, ggufFile, mmprojFile)
            if (LlamacppBridge.isAvailable) {
                try {
                    val result = analyzeLocal(bitmap)
                    if (result != null) return@withContext result
                } catch (e: Throwable) {
                    AppLogger.e("OCR", "❌ Inferencia falló tras carga tardía: ${e.message}")
                }
            }
        } else {
            AppLogger.w("OCR", "⚠️ Modelo NO descargado. Usando servidor.")
        }

        AppLogger.i("OCR", "→ Fallback SERVIDOR ☁️")
        return@withContext analyzeRemote(bitmap)
    }

    // ─── Inferencia local ────────────────────────────────────────

    private suspend fun analyzeLocal(bitmap: Bitmap): LabelOcrResult? = withContext(Dispatchers.IO) {
        val raw = LlamacppBridge.runVisionInference(context, bitmap, LABEL_EXTRACTION_PROMPT)
            ?: return@withContext null
        parseJsonResponse(raw, source = "local")
    }

    // ─── Fallback: servidor ──────────────────────────────────────

    suspend fun analyzeRemote(bitmap: Bitmap): LabelOcrResult = withContext(Dispatchers.IO) {
        try {
            val bytes = ByteArrayOutputStream().also { out ->
                bitmap.compress(Bitmap.CompressFormat.JPEG, 90, out)
            }.toByteArray()
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
                    parseJsonResponse(response.body?.string() ?: "{}", source = "servidor")
                } else {
                    LabelOcrResult.empty(source = "servidor")
                }
            }
        } catch (e: Exception) {
            LabelOcrResult.empty(source = "error")
        }
    }

    // ─── Parser JSON ─────────────────────────────────────────────

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

    // ─── Gestión del modelo ──────────────────────────────────────

    fun downloadModel(onProgress: (Int) -> Unit, onDone: (Boolean, String) -> Unit) {
        try {
            modelDir.mkdirs()
            val totalFiles = MODEL_FILES.size

            MODEL_FILES.forEachIndexed { index, fileName ->
                val dest = File(modelDir, fileName)
                val fileUrl = "$HF_BASE_URL/$fileName"
                var expectedSize: Long = -1

                // HEAD check for file size
                try {
                    val headResp = client.newCall(Request.Builder().url(fileUrl).head().build()).execute()
                    expectedSize = headResp.body?.contentLength() ?: -1
                    headResp.close()
                } catch (_: Exception) {}

                if (dest.exists() && dest.length() > 0) {
                    if (expectedSize > 0 && dest.length() == expectedSize) {
                        onProgress(((index + 1) * 100) / totalFiles)
                        return@forEachIndexed
                    }
                    if (expectedSize <= 0 && dest.length() > 1024 * 1024) {
                        onProgress(((index + 1) * 100) / totalFiles)
                        return@forEachIndexed
                    }
                    Log.w(TAG, "$fileName: tamaño local=${dest.length()} vs esperado=$expectedSize. Re-descargando...")
                    dest.delete()
                }

                Log.i(TAG, "Descargando $fileName (${if (expectedSize > 0) "%.0f MB".format(expectedSize / 1_000_000.0) else "?"})")
                val request = Request.Builder().url(fileUrl).build()

                client.newCall(request).execute().use { response ->
                    if (!response.isSuccessful) {
                        throw java.io.IOException("Error ${response.code} al descargar $fileName")
                    }
                    val body = response.body ?: throw java.io.IOException("Cuerpo vacío para $fileName")
                    val total = body.contentLength()
                    var downloaded = 0L
                    body.byteStream().use { input ->
                        FileOutputStream(dest).use { output ->
                            val buffer = ByteArray(65536)
                            var n: Int
                            while (input.read(buffer).also { n = it } != -1) {
                                output.write(buffer, 0, n)
                                downloaded += n
                                val fileProgress = if (total > 0) (downloaded * 100 / total).toInt() else 50
                                onProgress(((index * 100 + fileProgress) / totalFiles).coerceIn(0, 99))
                            }
                        }
                    }
                }

                if (expectedSize > 0 && dest.length() != expectedSize) {
                    dest.delete()
                    throw java.io.IOException("$fileName incomplete: ${dest.length()} de $expectedSize bytes")
                }
                onProgress(((index + 1) * 100) / totalFiles)
            }

            onProgress(100)
            onDone(true, "")
        } catch (e: Exception) {
            Log.e(TAG, "Error descargando modelo: ${e.message}", e)
            onDone(false, e.message ?: "Error desconocido")
        }
    }

    fun deleteModel(): Boolean {
        return try {
            LlamacppBridge.destroyModel()
            modelDir.deleteRecursively()
        } catch (e: Exception) {
            Log.e(TAG, "Error borrando modelo: ${e.message}")
            false
        }
    }

    fun initLocalModel(): Boolean {
        if (!isModelReady) {
            LlamacppBridge.lastInitError = "Modelo no descargado completamente."
            return false
        }
        return LlamacppBridge.initModel(context, ggufFile, mmprojFile)
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
