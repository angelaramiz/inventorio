package com.inventorio.operations

import android.graphics.Bitmap
import android.util.Log
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.resume

/**
 * PORT desde Inventorio Alpha — misma versión.
 * Origen: apps movil/inventorio alpha/app/src/main/java/com/inventorio/alpha/MlKitLabelOcrEngine.kt
 * Ref repo: commit dd189cc70e537f00c4fa7ceed44ccc1a19eee37e (2026-09-04)
 * Adaptaciones: cambio de paquete; AppLogger → android.util.Log;
 * LabelOcrResult (de Alpha) → OcrPropuesta local. Estrategia idéntica:
 * ML Kit sobre imagen original + LabelTextParser.
 */

/** Propuesta de OCR para un manifiesto (el usuario confirma/corrige antes de guardar). */
data class OcrPropuesta(
    val marca: String?,
    val talla: String?,
    val sku: String?,
    val modeloGrupo: String?,
    val codigoColor: String?,
    val fechaTemporada: String?,
    val confidence: Int,
    val rawText: String,
    val source: String
) {
    val hasAnyData: Boolean
        get() = marca != null || talla != null || sku != null ||
                modeloGrupo != null || codigoColor != null || fechaTemporada != null

    companion object {
        fun empty(source: String) = OcrPropuesta(null, null, null, null, null, null, 0, "", source)
    }
}

object ManifiestoOcrEngine {

    private const val TAG = "ManifiestoOcr"
    private val recognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)

    /**
     * Analiza un bitmap y extrae campos de la etiqueta.
     * @param bitmap Imagen original de la cámara
     * @param barcode Código de barras asociado (si se escaneó)
     * @return OcrPropuesta con los campos extraídos y confidence score
     */
    suspend fun analyze(bitmap: Bitmap, barcode: String? = null): OcrPropuesta {
        // ML Kit está optimizado para imágenes crudas de cámara.
        val rawText = extractTextFromBitmap(bitmap)
        if (rawText.isBlank()) return OcrPropuesta.empty(source = "mlkit-empty")
        val parsed = LabelTextParser.parse(rawText, barcode)
        Log.i(TAG, "Texto extraído: ${rawText.take(80)}..., conf=${parsed.confidence}")
        return OcrPropuesta(
            marca = parsed.marca,
            talla = parsed.talla,
            sku = parsed.sku,
            modeloGrupo = parsed.modeloGrupo,
            codigoColor = parsed.codigoColor,
            fechaTemporada = parsed.fechaTemporada,
            confidence = parsed.confidence,
            rawText = rawText,
            source = "mlkit-${parsed.confidence}"
        )
    }

    /**
     * Extrae texto crudo del bitmap usando ML Kit.
     */
    private suspend fun extractTextFromBitmap(bitmap: Bitmap): String {
        val image = InputImage.fromBitmap(bitmap, 0)

        return suspendCancellableCoroutine { cont ->
            recognizer.process(image)
                .addOnSuccessListener { visionText ->
                    cont.resume(visionText.text)
                }
                .addOnFailureListener { e ->
                    Log.e(TAG, "ML Kit falló: ${e.message}")
                    cont.resume("")
                }
        }
    }
}
