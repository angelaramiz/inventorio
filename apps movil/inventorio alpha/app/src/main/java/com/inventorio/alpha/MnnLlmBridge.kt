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

    // ─── Estado ──────────────────────────────────────────────────────────────

    val isAvailable: Boolean
        get() = isLoaded && sessionHandle != 0L

    // ─── Carga de librerías nativas ──────────────────────────────────────────

    fun tryLoadLibraries(): Boolean {
        if (isLoaded) return true
        return try {
            System.loadLibrary("MNN")
            System.loadLibrary("MNN_Express")
            System.loadLibrary("llm")
            isLoaded = true
            Log.i(TAG, "MNN-LLM nativo cargado correctamente.")
            true
        } catch (e: UnsatisfiedLinkError) {
            Log.w(TAG, "Librerías MNN no encontradas. OCR local no disponible. Causa: ${e.message}")
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
            Log.w(TAG, "initModel() llamado sin librerías cargadas.")
            return false
        }
        return try {
            sessionHandle = nativeCreateSession(modelDir)
            sessionHandle != 0L
        } catch (e: Exception) {
            Log.e(TAG, "Error iniciando sesión MNN: ${e.message}")
            false
        }
    }

    fun destroyModel() {
        if (sessionHandle != 0L && isLoaded) {
            try {
                nativeDestroySession(sessionHandle)
            } catch (e: Exception) {
                Log.e(TAG, "Error destruyendo sesión: ${e.message}")
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
            nativeRunVisionInference(sessionHandle, base64, prompt)
        } catch (e: Exception) {
            Log.e(TAG, "Error en inferencia: ${e.message}")
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

    // ─── Declaraciones nativas (JNI) ─────────────────────────────────────────
    // Estas funciones son implementadas en C++ por libllm.so
    // El contrato coincide con la API de MNN-LLM para modelos VLM.

    @JvmStatic
    private external fun nativeCreateSession(modelPath: String): Long

    @JvmStatic
    private external fun nativeDestroySession(handle: Long)

    @JvmStatic
    private external fun nativeRunVisionInference(handle: Long, imageBase64: String, prompt: String): String
}
