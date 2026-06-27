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
            sessionHandle = com.alibaba.mnnllm.android.llm.LlmSession.initNative(modelDir, false)
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
    fun runVisionInference(bitmap: Bitmap, prompt: String): String? {
        if (!isAvailable) return null
        return try {
            val base64 = bitmapToBase64(bitmap)
            com.alibaba.mnnllm.android.llm.LlmSession.submitNative(sessionHandle, prompt, base64)
        } catch (e: Throwable) {
            Log.e(TAG, "Error en inferencia: ${e.message}", e)
            null
        }
    }

    // ─── Utilidades ──────────────────────────────────────────────────────────

    private fun bitmapToBase64(bitmap: Bitmap): String {
        val output = ByteArrayOutputStream()
        // Reducir a max 1024px para eficiencia en inferencia
        val scaled = if (bitmap.width > 1024 || bitmap.height > 1024) {
            val ratio = minOf(1024f / bitmap.width, 1024f / bitmap.height)
            Bitmap.createScaledBitmap(
                bitmap,
                (bitmap.width * ratio).toInt(),
                (bitmap.height * ratio).toInt(),
                true
            )
        } else bitmap
        scaled.compress(Bitmap.CompressFormat.JPEG, 85, output)
        return Base64.encodeToString(output.toByteArray(), Base64.NO_WRAP)
    }
}
