package com.inventorio.operations

/**
 * PORT desde Inventorio Alpha — misma versión, SIN modificar.
 * Origen: apps movil/inventorio alpha/app/src/main/java/com/inventorio/alpha/ImagePreprocessor.kt
 * Ref repo: commit dd189cc70e537f00c4fa7ceed44ccc1a19eee37e (2026-09-04)
 * Adaptación: solo cambio de paquete.
 */

import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.Matrix
import androidx.core.graphics.get
import androidx.core.graphics.set
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt
import kotlin.math.sin
import kotlin.math.cos
import kotlin.math.sqrt

/**
 * Pipeline de preprocesamiento de imágenes para OCR de etiquetas de ropa.
 *
 * Optimizado para etiquetas de ropa con texto pequeño sobre fondos uniformes
 * (blanco, negro, color). ML Kit Text Recognition trabaja mejor con imágenes
 * en escala de grises mejoradas, NO binarizadas.
 *
 * Pipeline óptimo para ML Kit:
 *  1. Escala a tamaño óptimo (max 1800px — letras pequeñas necesitan resolución)
 *  2. Conversión a escala de grises
 *  3. CLAHE con bloques grandes (32x32) — evita artefactos en fondos uniformes
 *  4. Sharpening suave (unsharp mask) — nitidez para texto borroso
 *  5. Filtro de ruido bilateral simplificado — preserva bordes del texto
 *
 * Pipeline para PaddleOCR (binarizado):
 *  1-4. Mismos pasos
 *  5. Binarización Otsu
 *  6. Corrección de inclinación (deskew)
 *  7. Recorte de bordes
 *
 * Referencias:
 *  - PP-OCRv3 text detection pipeline
 *  - Tesseract preprocessing guidelines
 *  - ML Kit best practices (grayscale > binary)
 */
object ImagePreprocessor {

    data class PreprocessedImage(
        val bitmap: Bitmap,          // Imagen preprocesada (grayscale mejorado para ML Kit)
        val grayscaleBitmap: Bitmap, // Solo grayscale (para PaddleOCR)
        val originalWidth: Int,
        val originalHeight: Int,
        val processingTimeMs: Long
    )

    /**
     * Pipeline completo de preprocesamiento (para PaddleOCR / binarizado).
     * @param bitmap Imagen original de la cámara
     * @param maxDim Dimensión máxima (default 1800px para texto pequeño)
     * @return PreprocessedImage con la imagen lista para OCR
     */
    fun preprocess(bitmap: Bitmap, maxDim: Int = 1800): PreprocessedImage {
        val startTime = System.currentTimeMillis()

        // 1. Escalar a tamaño óptimo
        val scaled = scaleToOptimal(bitmap, maxDim)
        val origW = scaled.width
        val origH = scaled.height

        // 2. Convertir a grises
        val gray = toGrayscale(scaled)
        if (scaled !== bitmap) scaled.recycle()

        // 3. CLAHE con bloques grandes
        val equalized = claheLargeBlocks(gray, 32)

        // 4. Sharpening suave
        val sharpened = unsharpMask(equalized, 1.0f, 0.5f)
        equalized.recycle()

        // 5. Binarización Otsu (solo para PaddleOCR)
        val binary = otsuThreshold(sharpened)

        // 6. Corrección de inclinación
        val deskewed = deskew(binary)
        binary.recycle()

        // 7. Recorte de bordes (margin removal)
        val cropped = removeMargins(deskewed)
        deskewed.recycle()

        val elapsed = System.currentTimeMillis() - startTime

        return PreprocessedImage(
            bitmap = cropped,
            grayscaleBitmap = sharpened,
            originalWidth = origW,
            originalHeight = origH,
            processingTimeMs = elapsed
        )
    }

    /**
     * Versión ligera optimizada para ML Kit (sin binarización).
     * ML Kit trabaja mejor con grayscale mejorado que con binarizado.
     *
     * Pipeline:
     *  1. Escalar a 1800px (letras pequeñas necesitan resolución)
     *  2. Grayscale
     *  3. CLAHE bloques 32x32 (mejor contraste local)
     *  4. Unsharp mask (nitidez para texto borroso)
     *  5. Filtro bilateral suave (preserva bordes del texto)
     */
    fun preprocessLight(bitmap: Bitmap, maxDim: Int = 1800): PreprocessedImage {
        val startTime = System.currentTimeMillis()

        val scaled = scaleToOptimal(bitmap, maxDim)
        val origW = scaled.width
        val origH = scaled.height

        val gray = toGrayscale(scaled)
        if (scaled !== bitmap) scaled.recycle()

        // CLAHE con bloques grandes (32x32) — mejor para fondos uniformes
        val equalized = claheLargeBlocks(gray, 32)

        // Unsharp mask — nitidez para texto borroso de cámara
        val sharpened = unsharpMask(equalized, 1.0f, 0.5f)
        equalized.recycle()

        // Filtro bilateral suave — preserva bordes del texto, suaviza ruido
        val denoised = bilateralFilterLite(sharpened)
        sharpened.recycle()

        val elapsed = System.currentTimeMillis() - startTime

        return PreprocessedImage(
            bitmap = denoised,
            grayscaleBitmap = denoised,
            originalWidth = origW,
            originalHeight = origH,
            processingTimeMs = elapsed
        )
    }

    // ─── 1. Escalado ──────────────────────────────────────────────

    private fun scaleToOptimal(bitmap: Bitmap, maxDim: Int): Bitmap {
        val w = bitmap.width
        val h = bitmap.height
        if (w <= maxDim && h <= maxDim) return bitmap.copy(Bitmap.Config.ARGB_8888, true)

        val scale = maxDim.toFloat() / max(w, h)
        val newW = (w * scale).roundToInt()
        val newH = (h * scale).roundToInt()
        return Bitmap.createScaledBitmap(bitmap, newW, newH, true)
    }

    // ─── 2. Escala de grises ──────────────────────────────────────

    private fun toGrayscale(bitmap: Bitmap): Bitmap {
        val w = bitmap.width
        val h = bitmap.height
        val gray = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
        val canvas = android.graphics.Canvas(gray)
        val paint = android.graphics.Paint()
        val cm = android.graphics.ColorMatrix().apply { setSaturation(0f) }
        paint.colorFilter = android.graphics.ColorMatrixColorFilter(cm)
        canvas.drawBitmap(bitmap, 0f, 0f, paint)
        return gray
    }

    // ─── 3. CLAHE con bloques grandes ────────────────────────────

    /**
     * CLAHE con bloques grandes (16x16 o 32x32).
     * Bloques grandes = mejor para fondos uniformes de etiquetas.
     * Bloques pequeños (8x8) causan artefactos de "cuadrícula" en fondos blancos.
     */
    private fun claheLargeBlocks(bitmap: Bitmap, blockSize: Int = 32): Bitmap {
        val w = bitmap.width
        val h = bitmap.height
        val result = bitmap.copy(Bitmap.Config.ARGB_8888, true)

        for (by in 0 until h step blockSize) {
            for (bx in 0 until w step blockSize) {
                val blockEndX = min(bx + blockSize, w)
                val blockEndY = min(by + blockSize, h)

                // Calcular histograma del bloque
                val histogram = IntArray(256)
                var pixelCount = 0
                for (y in by until blockEndY) {
                    for (x in bx until blockEndX) {
                        val gray = Color.red(result.getPixel(x, y))
                        histogram[gray]++
                        pixelCount++
                    }
                }

                // Calcular CDF
                val cdf = IntArray(256)
                cdf[0] = histogram[0]
                for (i in 1..255) cdf[i] = cdf[i - 1] + histogram[i]

                val cdfMin = cdf.first { it > 0 }

                // Aplicar ecualización al bloque
                for (y in by until blockEndY) {
                    for (x in bx until blockEndX) {
                        val gray = Color.red(result.getPixel(x, y))
                        val newGray = ((cdf[gray] - cdfMin).toFloat() / (pixelCount - cdfMin) * 255)
                            .roundToInt().coerceIn(0, 255)
                        result.setPixel(x, y, Color.rgb(newGray, newGray, newGray))
                    }
                }
            }
        }
        return result
    }

    // ─── 4. Unsharp Mask (Sharpening) ────────────────────────────

    /**
     * Unsharp mask: suaviza la imagen y resta la versión suavizada
     * para realzar bordes. Ideal para texto borroso de cámara.
     *
     * @param bitmap Imagen de entrada
     * @param radius Radio de suavizado (1.0 = suave, 2.0 = fuerte)
     * @param strength Intensidad del sharpening (0.3-1.0)
     */
    private fun unsharpMask(bitmap: Bitmap, radius: Float = 1.0f, strength: Float = 0.5f): Bitmap {
        val w = bitmap.width
        val h = bitmap.height
        val pixels = IntArray(w * h)
        bitmap.getPixels(pixels, 0, w, 0, 0, w, h)

        // Extraer canal gris
        val gray = IntArray(w * h) { Color.red(pixels[it]) }

        // Gaussian blur 3x3 (aproximación rápida)
        val kernel = floatArrayOf(
            1f/16f, 2f/16f, 1f/16f,
            2f/16f, 4f/16f, 2f/16f,
            1f/16f, 2f/16f, 1f/16f
        )
        val blurred = gaussianBlur3x3(gray, w, h, kernel)

        // Unsharp: original + strength * (original - blurred)
        val result = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
        val outPixels = IntArray(w * h)

        for (i in gray.indices) {
            val diff = gray[i] - blurred[i]
            val sharpened = (gray[i] + strength * diff).roundToInt().coerceIn(0, 255)
            outPixels[i] = Color.rgb(sharpened, sharpened, sharpened)
        }

        result.setPixels(outPixels, 0, w, 0, 0, w, h)
        return result
    }

    private fun gaussianBlur3x3(gray: IntArray, w: Int, h: Int, kernel: FloatArray): IntArray {
        val result = IntArray(w * h)
        for (y in 1 until h - 1) {
            for (x in 1 until w - 1) {
                var sum = 0f
                var ki = 0
                for (dy in -1..1) {
                    for (dx in -1..1) {
                        sum += gray[(y + dy) * w + (x + dx)] * kernel[ki++]
                    }
                }
                result[y * w + x] = sum.roundToInt()
            }
        }
        // Copiar bordes
        for (x in 0 until w) {
            result[x] = gray[x]
            result[(h - 1) * w + x] = gray[(h - 1) * w + x]
        }
        for (y in 0 until h) {
            result[y * w] = gray[y * w]
            result[y * w + w - 1] = gray[y * w + w - 1]
        }
        return result
    }

    // ─── 5. Filtro bilateral simplificado ────────────────────────

    /**
     * Filtro bilateral lite: suaviza ruido pero preserva bordes del texto.
     * Diferencia del filtro mediana: no borra los bordes finos del texto.
     *
     * Aproximación rápida: para cada píxel, promedia vecinos similares
     * (dentro de un rango de intensidad) y ignora los que difieren mucho
     * (que son bordes del texto).
     */
    private fun bilateralFilterLite(bitmap: Bitmap): Bitmap {
        val w = bitmap.width
        val h = bitmap.height
        val pixels = IntArray(w * h)
        bitmap.getPixels(pixels, 0, w, 0, 0, w, h)

        val gray = IntArray(w * h) { Color.red(pixels[it]) }
        val result = IntArray(w * h)
        val spatialRadius = 2
        val colorThreshold = 30  // ignorar píxeles que difieren más de 30 en gris

        for (y in 0 until h) {
            for (x in 0 until w) {
                val centerVal = gray[y * w + x]
                var sum = 0f
                var weightSum = 0f

                for (dy in -spatialRadius..spatialRadius) {
                    for (dx in -spatialRadius..spatialRadius) {
                        val ny = y + dy
                        val nx = x + dx
                        if (ny in 0 until h && nx in 0 until w) {
                            val neighborVal = gray[ny * w + nx]
                            val colorDiff = abs(centerVal - neighborVal)
                            if (colorDiff <= colorThreshold) {
                                // Peso espacial (gaussiano simplificado)
                                val spatialDist = (dx * dx + dy * dy).toFloat()
                                val spatialWeight = 1f / (1f + spatialDist)
                                sum += neighborVal * spatialWeight
                                weightSum += spatialWeight
                            }
                        }
                    }
                }

                val avg = if (weightSum > 0) (sum / weightSum).roundToInt() else centerVal
                result[y * w + x] = Color.rgb(avg, avg, avg)
            }
        }

        val output = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
        output.setPixels(result, 0, w, 0, 0, w, h)
        return output
    }

    // ─── 6. Binarización Otsu ─────────────────────────────────────

    /**
     * Determina el umbral óptimo automáticamente usando el método de Otsu.
     * Solo para pipeline de PaddleOCR (ML Kit NO usa esto).
     */
    private fun otsuThreshold(bitmap: Bitmap): Bitmap {
        val w = bitmap.width
        val h = bitmap.height
        val pixels = IntArray(w * h)
        bitmap.getPixels(pixels, 0, w, 0, 0, w, h)

        val histogram = IntArray(256)
        for (px in pixels) histogram[Color.red(px)]++

        val total = w * h
        var sumAll = 0.0
        for (i in 0..255) sumAll += i * histogram[i]

        var sumBg = 0.0
        var weightBg = 0
        var maxVariance = 0.0
        var threshold = 0

        for (t in 0..255) {
            weightBg += histogram[t]
            if (weightBg == 0) continue

            val weightFg = total - weightBg
            if (weightFg == 0) break

            sumBg += t * histogram[t]

            val meanBg = sumBg / weightBg
            val meanFg = (sumAll - sumBg) / weightFg

            val variance = weightBg.toDouble() * weightFg.toDouble() * (meanBg - meanFg) * (meanBg - meanFg)
            if (variance > maxVariance) {
                maxVariance = variance
                threshold = t
            }
        }

        val result = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
        for (y in 0 until h) {
            for (x in 0 until w) {
                val gray = Color.red(pixels[y * w + x])
                val value = if (gray >= threshold) 255 else 0
                result.setPixel(x, y, Color.rgb(value, value, value))
            }
        }
        return result
    }

    // ─── 7. Corrección de inclinación (deskew) ────────────────────

    private fun deskew(bitmap: Bitmap): Bitmap {
        val w = bitmap.width
        val h = bitmap.height
        val pixels = IntArray(w * h)
        bitmap.getPixels(pixels, 0, w, 0, 0, w, h)

        var bestAngle = 0.0
        var bestScore = Long.MAX_VALUE

        for (angle10 in -50..50) {
            val angle = angle10 / 10.0
            val score = calculateProjectionScore(pixels, w, h, angle)
            if (score < bestScore) {
                bestScore = score
                bestAngle = angle
            }
        }

        if (abs(bestAngle) > 0.3) {
            val matrix = Matrix().apply { postRotate(bestAngle.toFloat(), w / 2f, h / 2f) }
            return Bitmap.createBitmap(bitmap, 0, 0, w, h, matrix, true)
        }
        return bitmap
    }

    private fun calculateProjectionScore(pixels: IntArray, w: Int, h: Int, angle: Double): Long {
        val rad = Math.toRadians(angle)
        val cosA = cos(rad)
        val sinA = sin(rad)
        val centerX = w / 2.0
        val centerY = h / 2.0

        val projections = IntArray(h)
        for (y in 0 until h) {
            for (x in 0 until w) {
                if (Color.red(pixels[y * w + x]) < 128) {
                    val rotY = ((y - centerY) * cosA - (x - centerX) * sinA + centerY).toInt()
                    if (rotY in 0 until h) projections[rotY]++
                }
            }
        }

        var variance = 0L
        val mean = projections.average()
        for (p in projections) {
            val diff = p - mean
            variance += (diff * diff).toLong()
        }
        return variance
    }

    // ─── 8. Recorte de márgenes ───────────────────────────────────

    private fun removeMargins(bitmap: Bitmap): Bitmap {
        val w = bitmap.width
        val h = bitmap.height
        val pixels = IntArray(w * h)
        bitmap.getPixels(pixels, 0, w, 0, 0, w, h)

        var minX = w; var maxX = 0; var minY = h; var maxY = 0
        for (y in 0 until h) {
            for (x in 0 until w) {
                if (Color.red(pixels[y * w + x]) < 240) {
                    minX = min(minX, x)
                    maxX = max(maxX, x)
                    minY = min(minY, y)
                    maxY = max(maxY, y)
                }
            }
        }

        val padX = (w * 0.05).toInt()
        val padY = (h * 0.05).toInt()
        minX = max(0, minX - padX)
        minY = max(0, minY - padY)
        maxX = min(w - 1, maxX + padX)
        maxY = min(h - 1, maxY + padY)

        return if (maxX > minX && maxY > minY) {
            Bitmap.createBitmap(bitmap, minX, minY, maxX - minX + 1, maxY - minY + 1)
        } else {
            bitmap
        }
    }

    // ─── Utilidades ───────────────────────────────────────────────

    fun toBase64(bitmap: Bitmap, quality: Int = 85): String {
        val stream = java.io.ByteArrayOutputStream()
        bitmap.compress(Bitmap.CompressFormat.JPEG, quality, stream)
        val bytes = stream.toByteArray()
        return android.util.Base64.encodeToString(bytes, android.util.Base64.NO_WRAP)
    }

    fun toJpegBytes(bitmap: Bitmap, quality: Int = 85): ByteArray {
        val stream = java.io.ByteArrayOutputStream()
        bitmap.compress(Bitmap.CompressFormat.JPEG, quality, stream)
        return stream.toByteArray()
    }
}
