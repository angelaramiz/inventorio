package com.inventorio.operations

import org.apache.commons.csv.CSVFormat
import org.apache.commons.csv.CSVParser

/**
 * Normaliza cualquier variante de CSV de inventario al formato interno TransformedRow.
 *
 * Soporta:
 *  - datos.csv  → codigo,numero,cantidad1,cantidad2
 *  - BOLSAS.csv → MODELO,UPC,STOCK,CAT
 *  - Formato clásico → Material,VAM,SKU,Linea,Categoria,Disponible
 */
object CsvNormalizer {

    data class ColumnMapping(
        val materialCol: String?,
        val vamCol: String?,
        val skuCol: String?,
        val lineaCol: String?,
        val categoriaCol: String?,
        val cantidadCol: String?,
    )

    fun detectColumns(headerNames: List<String>): ColumnMapping {
        // Orden importa: material antes que sku para que "codigo" vaya a material, no a sku
        val materialCol = headerNames.find { Regex(".*(material|codigo|modelo).*", RegexOption.IGNORE_CASE).matches(it) }
        val vamCol = headerNames.find { Regex(".*(vam|talla|size).*", RegexOption.IGNORE_CASE).matches(it) }
        // sku: acepta numero/barcode pero NO codigo (ya mapeado a material)
        val skuCol = headerNames.find { Regex(".*(sku|upc|ean|numero|barcode).*", RegexOption.IGNORE_CASE).matches(it) }
        val lineaCol = headerNames.find { Regex(".*(linea|l[ií]nea|line).*", RegexOption.IGNORE_CASE).matches(it) }
        val categoriaCol = headerNames.find { Regex(".*(categoria|categor[ií]a|cat|category).*", RegexOption.IGNORE_CASE).matches(it) }
        // cantidad: acepta stock/cantidad además de disponible/cant/qty
        val cantidadCol = headerNames.find { Regex(".*(disponible|disp|solicitado|pedido|cant|qty|cantidad|stock).*", RegexOption.IGNORE_CASE).matches(it) }
        return ColumnMapping(materialCol, vamCol, skuCol, lineaCol, categoriaCol, cantidadCol)
    }

    fun normalizeRecord(
        rawMaterial: String,
        rawVam: String,
        rawSku: String,
        rawLinea: String,
        rawCategoria: String,
        rawCantidad: String,
        rawMap: Map<String, String> = emptyMap(),
    ): TransformedRow {
        val material = rawMaterial.trim()
        val vam = rawVam.trim()
        val sku = rawSku.trim()
        val linea = rawLinea.trim()
        val categoria = rawCategoria.trim()
        val cantidad = rawCantidad.trim().toIntOrNull() ?: 1

        // Split MODELO-COLOR en el último guion → W5BP39KACM2-F0D9 → modelo + color
        val lastHyphen = material.lastIndexOf('-')
        val modeloGrupo = if (lastHyphen >= 0) material.substring(0, lastHyphen).trim() else material
        val codigoColor = if (lastHyphen >= 0) material.substring(lastHyphen + 1).trim() else ""

        // NOSZ (No Size) → UNICA
        val talla = if (vam.equals("NOSZ", ignoreCase = true)) "UNICA" else vam

        return TransformedRow(
            modeloGrupo = modeloGrupo.uppercase(),
            codigoColor = codigoColor.uppercase(),
            talla = talla.uppercase(),
            sku = sku,
            linea = linea,
            categoria = categoria,
            cantidad = cantidad,
            raw = rawMap,
        )
    }

    /**
     * Parsea un CSV completo y devuelve filas normalizadas.
     * @param content texto completo del CSV
     * @return lista de TransformedRow listas para insertar en SQLite
     */
    fun parse(content: String): List<TransformedRow> {
        val parser = CSVParser.parse(
            content,
            CSVFormat.DEFAULT.withFirstRecordAsHeader().withTrim().withAllowMissingColumnNames()
        )
        val mapping = detectColumns(parser.headerNames)
        val result = mutableListOf<TransformedRow>()
        for (record in parser) {
            // Ignorar filas completamente vacías
            if (record.iterator().asSequence().all { it.isNullOrBlank() }) continue

            val material = if (mapping.materialCol != null) record.get(mapping.materialCol)?.trim() ?: "" else ""
            val vam = if (mapping.vamCol != null) record.get(mapping.vamCol)?.trim() ?: "" else ""
            val sku = if (mapping.skuCol != null) record.get(mapping.skuCol)?.trim() ?: "" else ""
            val linea = if (mapping.lineaCol != null) record.get(mapping.lineaCol)?.trim() ?: "" else ""
            val categoria = if (mapping.categoriaCol != null) record.get(mapping.categoriaCol)?.trim() ?: "" else ""
            val cantidadRaw = if (mapping.cantidadCol != null) record.get(mapping.cantidadCol)?.trim() ?: "" else ""

            // raw para debug/auditoría
            val rawMap = parser.headerNames.associateWith { h -> try { record.get(h) ?: "" } catch (_: Exception) { "" } }

            // Saltar filas sin material ni sku (vacías)
            if (material.isBlank() && sku.isBlank()) continue

            result.add(normalizeRecord(material, vam, sku, linea, categoria, cantidadRaw, rawMap))
        }
        parser.close()
        return result
    }
}
