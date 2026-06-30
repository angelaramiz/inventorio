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
        if (isLoaded) return true
        return try {
            System.loadLibrary("MNN")
            System.loadLibrary("mnnllmapp")
            isLoaded = true
            Log.i(TAG, "MNN-LLM nativo cargado correctamente.")
            true
        } catch (e: UnsatisfiedLinkError) {
            lastInitError = "LinkError: ${e.message}"
            Log.w(TAG, "Librerías MNN no encontradas. OCR local no disponible. Causa: ${e.message}")
            false
        } catch (e: Throwable) {
            lastInitError = "Carga fallida: ${e.message}"
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
            Log.w(TAG, "initModel() llamado sin librerías cargadas.")
            return false
        }

        val validationError = validateModelFiles(modelDir)
        if (validationError != null) {
            lastInitError = "Archivos del modelo inválidos:\n$validationError"
            Log.e(TAG, lastInitError!!)
            return false
        }

        val configFile = File(modelDir, "config.json")
        return try {
            val mmapDir = File(context.cacheDir, "mnn_mmap").apply { mkdirs() }
            val mergedConfig = configFile.readText()
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
            }
            sessionHandle != 0L
        } catch (e: Throwable) {
            lastInitError = "Error JNI: ${e.message}\n${Log.getStackTraceString(e)}"
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
        if (!isAvailable) return null
        return try {
            val tempFile = File(context.cacheDir, "mnn_ocr_temp.jpg")
            java.io.FileOutputStream(tempFile).use { out ->
                bitmap.compress(Bitmap.CompressFormat.JPEG, 90, out)
            }

            val finalPrompt = "<img>${tempFile.absolutePath}</img>\n$prompt"
            val outputBuilder = java.lang.StringBuilder()

            Log.d(TAG, "Iniciando inferencia local MNN. Prompt final: $finalPrompt")

            com.alibaba.mnnllm.android.llm.LlmSession.submitNative(
                sessionHandle,
                finalPrompt,
                false,
                object : com.alibaba.mnnllm.android.llm.GenerateProgressListener {
                    override fun onProgress(progress: String?): Boolean {
                        if (progress != null) {
                            outputBuilder.append(progress)
                        }
                        return false
                    }
                }
            )

            val result = outputBuilder.toString()
            Log.d(TAG, "Inferencia local MNN completada. Resultado: $result")

            try { tempFile.delete() } catch (_: Exception) {}

            result.ifEmpty { null }
        } catch (e: Throwable) {
            Log.e(TAG, "Error en inferencia: ${e.message}", e)
            null
        }
    }
}
