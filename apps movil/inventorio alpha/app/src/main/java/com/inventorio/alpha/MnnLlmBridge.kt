package com.inventorio.alpha

import android.content.Context
import android.graphics.Bitmap
import android.util.Log
import java.io.File

/**
 * Wrapper JNI para las librerías nativas de MNN-LLM.
 *
 * Para activar el OCR local, descarga las librerías precompiladas
 * desde el release oficial de MNN y colócalas en:
 *   app/src/main/jniLibs/arm64-v8a/
 *     - libMNN.so
 *     - libmnnllmapp.so
 *     - libc++_shared.so
 */
object MnnLlmBridge {

    private const val TAG = "MnnLlmBridge"
    var isLoaded = false
    private var sessionHandle: Long = 0L
    var lastInitError: String? = null

    private val REQUIRED_MODEL_FILES = listOf(
        "config.json",
        "llm.mnn",
        "llm.mnn.weight",
        "embeddings_bf16.bin",
        "visual.mnn",
        "visual.mnn.weight",
        "tokenizer.txt"
    )

    val isAvailable: Boolean
        get() = isLoaded && sessionHandle != 0L

    fun tryLoadLibraries(): Boolean {
        if (isLoaded) {
            AppLogger.i("MNN", "Librerías MNN ya cargadas previamente.")
            return true
        }
        return try {
            System.loadLibrary("MNN")
            System.loadLibrary("mnnllmapp")
            isLoaded = true
            AppLogger.i("MNN", "✅ Librerías MNN (.so) cargadas correctamente.")
            Log.i(TAG, "MNN-LLM nativo cargado correctamente.")
            true
        } catch (e: UnsatisfiedLinkError) {
            lastInitError = "LinkError: ${e.message}"
            AppLogger.e("MNN", "❌ Librerías MNN no encontradas. OCR local NO disponible.\nCausa: ${e.message}")
            Log.w(TAG, "Librerías MNN no encontradas. OCR local no disponible. Causa: ${e.message}")
            false
        } catch (e: Throwable) {
            lastInitError = "Carga fallida: ${e.message}"
            AppLogger.e("MNN", "❌ Error inesperado cargando librerías MNN: ${e.message}")
            false
        }
    }

    /**
     * Valida que todos los archivos del modelo existan y sean legibles.
     * Debe llamarse antes de initNative para evitar SIGSEGV en el motor C++.
     */
    fun validateModelFiles(modelDir: File): String? {
        val errors = mutableListOf<String>()
        for (name in REQUIRED_MODEL_FILES) {
            val file = File(modelDir, name)
            when {
                !file.exists() -> errors.add("Falta: $name")
                !file.canRead() -> errors.add("Sin permiso de lectura: $name (${file.absolutePath})")
                file.length() == 0L -> errors.add("Archivo vacío: $name")
            }
        }
        return if (errors.isEmpty()) null else errors.joinToString("\n")
    }

    /**
     * Inicializa el modelo desde el directorio dado.
     * Debe llamarse en un hilo de I/O (Dispatchers.IO).
     */
    fun initModel(context: Context, modelDir: File): Boolean {
        if (!isLoaded) {
            lastInitError = "Error: Librerías no cargadas."
            AppLogger.e("MNN", "❌ initModel() llamado sin librerías cargadas. Carga las .so primero.")
            Log.w(TAG, "initModel() llamado sin librerías cargadas.")
            return false
        }

        val validationError = validateModelFiles(modelDir)
        if (validationError != null) {
            lastInitError = "Archivos del modelo inválidos:\n$validationError"
            AppLogger.e("MNN", "❌ Archivos del modelo inválidos:\n$validationError")
            Log.e(TAG, lastInitError!!)
            return false
        }

        AppLogger.i("MNN", "Iniciando sesión MNN...\nDir: ${modelDir.absolutePath}")

        val configFile = File(modelDir, "config.json")
        return try {
            val mmapDir = File(context.cacheDir, "mnn_mmap").apply { mkdirs() }
            var mergedConfig = configFile.readText()
            try {
                val json = org.json.JSONObject(mergedConfig)
                if (!json.has("visual_model")) {
                    json.put("visual_model", "visual.mnn")
                }
                if (!json.has("visual_weight")) {
                    json.put("visual_weight", "visual.mnn.weight")
                }
                mergedConfig = json.toString()
            } catch (e: Exception) {
                Log.e(TAG, "Error inyectando visual_model/visual_weight: ${e.message}")
            }

            val extraConfigJson = buildString {
                append("{")
                append("\"is_r1\":false,")
                append("\"mmap_dir\":\"${mmapDir.absolutePath}\",")
                append("\"keep_history\":false")
                append("}")
            }

            Log.i(TAG, "initNative config=${configFile.absolutePath} mmap=${mmapDir.absolutePath}")

            sessionHandle = com.alibaba.mnnllm.android.llm.LlmSession.initNative(
                configFile.absolutePath,
                null,
                mergedConfig,
                extraConfigJson
            )

            if (sessionHandle == 0L) {
                lastInitError = "Error: initNative devolvió handle nulo (0L). Revisa logcat nativo (MNN_DEBUG)."
                AppLogger.e("MNN", "❌ initNative devolvió handle=0. La sesión MNN NO está activa.\nEl OCR usará la NUBE como fallback.")
            } else {
                AppLogger.i("MNN", "✅ Sesión MNN activa. Handle=$sessionHandle\nOCR LOCAL ⚡ disponible desde ahora.")
            }
            sessionHandle != 0L
        } catch (e: Throwable) {
            lastInitError = "Error JNI: ${e.message}\n${Log.getStackTraceString(e)}"
            AppLogger.e("MNN", "❌ Error JNI al iniciar sesión MNN:\n${e.message}")
            Log.e(TAG, "Error iniciando sesión MNN: ${e.message}", e)
            false
        }
    }

    fun destroyModel() {
        if (sessionHandle != 0L && isLoaded) {
            try {
                com.alibaba.mnnllm.android.llm.LlmSession.releaseNative(sessionHandle)
            } catch (e: Throwable) {
                Log.e(TAG, "Error destruyendo sesión: ${e.message}", e)
            }
            sessionHandle = 0L
        }
    }

    fun runVisionInference(context: Context, bitmap: Bitmap, prompt: String): String? {
        if (!isAvailable) {
            AppLogger.w("MNN", "runVisionInference() llamado pero isAvailable=false (handle=$sessionHandle, loaded=$isLoaded). Sin inferencia local.")
            return null
        }
        return try {
            val originalWidth = bitmap.width
            val originalHeight = bitmap.height
            val resizedBitmap = scaleBitmap(bitmap, 512)
            val finalWidth = resizedBitmap.width
            val finalHeight = resizedBitmap.height

            val tempFile = File.createTempFile("mnn_ocr_", ".jpg", context.cacheDir)
            java.io.FileOutputStream(tempFile).use { out ->
                resizedBitmap.compress(Bitmap.CompressFormat.JPEG, 90, out)
            }

            // Si creamos un bitmap escalado nuevo, lo liberamos para ahorrar memoria
            if (resizedBitmap !== bitmap) {
                try { resizedBitmap.recycle() } catch (_: Throwable) {}
            }

            val finalPrompt = "<img>${tempFile.absolutePath}</img>\n$prompt"
            val outputBuilder = java.lang.StringBuilder()
            var callbackCount = 0
            var terminalCallbackCount = 0
            var nonEmptyChunkCount = 0
            var emptyChunkCount = 0
            var completionReceived = false

            AppLogger.i(
                "MNN",
                "⚡ Iniciando inferencia LOCAL MNN...\n" +
                    "Resolución: ${originalWidth}x${originalHeight} -> ${finalWidth}x${finalHeight}\n" +
                    "Temp image: ${tempFile.absolutePath} | exists=${tempFile.exists()} | bytes=${tempFile.length()}"
            )
            Log.d(TAG, "Iniciando inferencia local MNN. Prompt final: $finalPrompt")

            val startMs = System.currentTimeMillis()

            val submitResult = com.alibaba.mnnllm.android.llm.LlmSession.submitNative(
                sessionHandle,
                finalPrompt,
                false,
                object : com.alibaba.mnnllm.android.llm.GenerateProgressListener {
                    override fun onProgress(progress: String?): Boolean {
                        callbackCount += 1
                        if (progress == null) {
                            terminalCallbackCount += 1
                            completionReceived = true
                        } else {
                            if (progress.isEmpty()) {
                                emptyChunkCount += 1
                            } else {
                                nonEmptyChunkCount += 1
                            }
                            outputBuilder.append(progress)
                        }
                        return false
                    }
                }
            )

            val result = outputBuilder.toString()
            val elapsed = System.currentTimeMillis() - startMs
            val submitSummary = submitResult.entries.joinToString(", ") { (key, value) -> "$key=$value" }
            AppLogger.i(
                "MNN",
                "✅ Inferencia LOCAL completada en ${elapsed}ms.\n" +
                    "Callbacks=$callbackCount | terminales=$terminalCallbackCount | chunks=$nonEmptyChunkCount | vacios=$emptyChunkCount | completed=$completionReceived\n" +
                    "submitNative=$submitSummary\n" +
                    "Respuesta: ${result.take(200)}${if (result.length > 200) "..." else ""}"
            )
            if (result.isEmpty()) {
                AppLogger.w(
                    "MNN",
                    "⚠️ submitNative terminó sin texto. " +
                        "Temp image exists=${tempFile.exists()} bytes=${tempFile.length()} | " +
                        "callbacks=$callbackCount terminales=$terminalCallbackCount completed=$completionReceived | " +
                        "meta=$submitSummary"
                )
            }
            Log.d(TAG, "Inferencia local MNN completada. Resultado: $result")

            try { tempFile.delete() } catch (_: Exception) {}

            result.ifEmpty { null }
        } catch (e: Throwable) {
            AppLogger.e("MNN", "❌ Error en inferencia local: ${e.message}")
            Log.e(TAG, "Error en inferencia: ${e.message}", e)
            null
        }
    }

    private fun scaleBitmap(bitmap: Bitmap, maxDimension: Int): Bitmap {
        val width = bitmap.width
        val height = bitmap.height
        if (width <= maxDimension && height <= maxDimension) {
            return bitmap
        }
        val ratio = width.toFloat() / height.toFloat()
        val newWidth: Int
        val newHeight: Int
        if (width > height) {
            newWidth = maxDimension
            newHeight = (maxDimension / ratio).toInt()
        } else {
            newHeight = maxDimension
            newWidth = (maxDimension * ratio).toInt()
        }
        return try {
            Bitmap.createScaledBitmap(bitmap, newWidth, newHeight, true)
        } catch (e: Throwable) {
            AppLogger.e("MNN", "⚠️ Error escalando bitmap: ${e.message}. Usando original.")
            bitmap
        }
    }
}
