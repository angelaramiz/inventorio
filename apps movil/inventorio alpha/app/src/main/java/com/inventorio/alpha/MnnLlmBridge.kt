package com.inventorio.alpha

import android.graphics.Bitmap
import android.util.Base64
import android.util.Log
import java.io.ByteArrayOutputStream

/**
 * Wrapper JNI para las librerías nativas de MNN-LLM.
 *
 * Para activar el OCR local, descarga las librerías precompiladas
 * desde el release oficial de MNN y colócalas en:
 *   app/src/main/jniLibs/arm64-v8a/
 *     - libMNN.so
 *     - libMNN_Express.so
 *     - libMNN_CL.so    (opcional, GPU backend)
 *     - libllm.so
 *
 * Repositorio de referencia:
 *   https://github.com/alibaba/MNN  (carpetas: project/android)
 *   https://github.com/DakeQQ/Native-LLM-for-Android
 */
object MnnLlmBridge {

    private const val TAG = "MnnLlmBridge"
    var isLoaded = false
    private var sessionHandle: Long = 0L
    var lastInitError: String? = null

    // ─── Estado ──────────────────────────────────────────────────────────────

    val isAvailable: Boolean
        get() = isLoaded && sessionHandle != 0L

    // ─── Carga de librerías nativas ──────────────────────────────────────────

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

    // ─── Ciclo de vida del modelo ────────────────────────────────────────────

    /**
     * Inicializa el modelo desde el directorio dado.
     * Debe llamarse en un hilo de I/O (Dispatchers.IO).
     *
     * @param modelDir Ruta al directorio con config.json y archivos .mnn
     * @return true si se inicializó correctamente
     */
    fun initModel(modelDir: String): Boolean {
        if (!isLoaded) {
            lastInitError = "Error: Librerías no cargadas."
            Log.w(TAG, "initModel() llamado sin librerías cargadas.")
            return false
        }
        return try {
            sessionHandle = com.alibaba.mnnllm.android.llm.LlmSession.initNative(
                modelDir, 
                null, 
                "{}", 
                "{}"
            )
            if (sessionHandle == 0L) {
                lastInitError = "Error: LlmSession.initNative devolvió handle nulo (0L)."
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

    // ─── Inferencia ──────────────────────────────────────────────────────────

    /**
     * Ejecuta el modelo de visión con una imagen y un prompt de texto.
     * Devuelve la respuesta generada o null si falla.
     */
    fun runVisionInference(context: android.content.Context, bitmap: Bitmap, prompt: String): String? {
        if (!isAvailable) return null
        return try {
            // Guardar imagen temporalmente para que libmnnllmapp.so la cargue
            val tempFile = java.io.File(context.cacheDir, "mnn_ocr_temp.jpg")
            java.io.FileOutputStream(tempFile).use { out ->
                // Qwen2.5-VL-2B funciona perfectamente con imágenes de tamaño medio
                bitmap.compress(Bitmap.CompressFormat.JPEG, 90, out)
            }
            
            // Construir el prompt con formato de etiqueta de imagen MNN Chat
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
                        return false // false para continuar generando
                    }
                }
            )
            
            val result = outputBuilder.toString()
            Log.d(TAG, "Inferencia local MNN completada. Resultado: $result")
            
            // Limpiar archivo temporal
            try { tempFile.delete() } catch (ignored: Exception) {}
            
            result.ifEmpty { null }
        } catch (e: Throwable) {
            Log.e(TAG, "Error en inferencia: ${e.message}", e)
            null
        }
    }
}
