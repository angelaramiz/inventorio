package com.inventorio.operations

/**
 * PORT desde Inventorio Alpha — misma versión, parser SIN modificar.
 * Origen: apps movil/inventorio alpha/app/src/main/java/com/inventorio/alpha/LabelTextParser.kt
 * Ref repo: commit dd189cc70e537f00c4fa7ceed44ccc1a19eee37e (2026-09-04)
 * Adaptación: solo cambio de paquete. Lógica, regex y scoring intactos.
 */

/**
 * Parser heurístico para etiquetas de ropa.
 *
 * Toma texto crudo de ML Kit Text Recognition y extrae campos estructurados
 * usando regex, keywords y scoring de confianza.
 *
 * Flujo:
 *  1. Normalizar texto (mayúsculas, quitar acentos, limpiar espacios)
 *  2. Buscar cada campo con patrones específicos
 *  3. Calcular confianza total (0–100)
 *  4. Devolver LabelTextResult con campos + confidence
 */
object LabelTextParser {

    data class LabelTextResult(
        val marca: String?,
        val talla: String?,
        val sku: String?,
        val modeloGrupo: String?,
        val codigoColor: String?,
        val fechaTemporada: String?,
        val tipoProducto: String?,
        val confidence: Int,         // 0–100
        val rawText: String          // texto original de ML Kit
    ) {
        val hasAnyData: Boolean
            get() = marca != null || talla != null || sku != null ||
                    modeloGrupo != null || codigoColor != null || fechaTemporada != null
    }

    // ─── Marca: lista de conocidas + detección por posición ────────

    private val MARCA_KEYWORDS = setOf(
        "ZARA", "ZARA HOME", "H&M", "FOREVER 21", "PULL&BEAR", "MASSIMO DUTTI",
        "BERSHKA", "STRADIVARIUS", "SFERA", "LEFTIES", "OYSHO",
        "LEY", "COPPEL", "Liverpool", "Palacio de Hierro", "Sears",
        "Nike", "ADIDAS", "PUMA", "REEBOK", "NEW BALANCE", "UNDER ARMOUR",
        "Levi's", "LEVI'S", "WRANGLER", "LEE",
        "TOMMY HILFIGER", "CALVIN KLEIN", "GUESS", "ARMANI", "BOSS",
        "Carhartt", "THE NORTH FACE", "PATAGONIA",
        "MANGO", "UNITED COLORS OF BENETTON", "NEXT", "PRIMARK",
        "GUCCI", "PRADA", "Dior", "VERSACE",
        "Shein", "SHEIN", "ROMWE", "Cider",
        "Victoria's Secret", "PINK", "Bath & Body Works",
        "American Eagle", "AEROPOSTALE", "HOLLISTER",
        "Gap", "OLD NAVY", "BANANA REPUBLIC",
        "Anthropologie", "Free People", "Urban Outfitters",
        "Uniqlo", "UNIQLO", "GU", "JINS",
        "C&A", "Kiabi", "Dash",
        "Lucky Brand", "7 For All Mankind", "True Religion",
        "Ralph Lauren", "POLO", "Tommy", "Nautica",
        "Vogue", "ELLE", "GQ",
        "Charter Club", "Alfani", "Alfani RED",
        "INC", "Style & Co", "Thalia Sodi", "Liz Claiborne",
        "Alfani", "Alfani RED", "Alfani Body",
        "Alfani RED", "Alfani Body", "Alfani RED"
    )

    private val TALLA_PATTERNS = listOf(
        // Talla NOSZ / T/U (talla única)
        Regex("""\b(NOSZ|T/U)\b""", RegexOption.IGNORE_CASE),
        // Talla literal: "TALLA L", "TALLA: 32", "Talla M"
        Regex("""(?:TALLA|TALL|SIZE|TALLA\s*:)[:\s]*(XS|XXS|S|M|L|XL|XXL|XXXL|XXXXL|\d{2,3})""", RegexOption.IGNORE_CASE),
        // Talla sola en contexto: "L", "XL" (pero no en medio de un código)
        Regex("""\b(XS|XXS|S|XXL|XXXL|XXXXL)\b"""),
        // Talla numérica: "28", "30", "32", "34", "36"
        Regex("""\b(2[6-9]|3[0-9]|4[0-2])\b"""),
        // Talla con guion: "T-40", "T40"
        Regex("""(?:T[-]?)\s*(\d{2})""", RegexOption.IGNORE_CASE),
        // Talla americana: "10M", "12W"
        Regex("""\b(\d{1,2})\s*(?:M|W|Y)\b"""),
    )

    private val VALID_TALLAS = setOf(
        "XS", "XXS", "S", "M", "L", "XL", "XXL", "XXXL", "XXXXL",
        "NOSZ", "T/U",
        "26", "27", "28", "29", "30", "31", "32", "33", "34", "35", "36", "37", "38", "39", "40", "41", "42",
        "6", "8", "10", "12", "14", "16", "18", "20"
    )

    // ─── SKU / Barcode / Modelo ────────────────────────────────────

    // SKU alfanumérico: "W5BP39KACM2", "ND5DJD5615"
    private val SKU_REGEX = Regex("""\b([A-Z]{2,5}\d{3,10})\b""")

    // EAN/UPC barcode: 12-13 dígitos
    private val EAN_REGEX = Regex("""\b(\d{12,13})\b""")

    // Código de modelo compuesto: "W5BP39KACM2-G1H3" (modelo-color)
    private val COMPOUND_MODEL_REGEX = Regex("""\b([A-Z0-9]{5,15})-([A-Z0-9]{3,6})\b""")

    // Modelo standalone: alfanumérico 5-15 chars
    private val MODELO_REGEX = Regex("""\b([A-Z][A-Z0-9]{4,14})\b""")

    // ─── Color ─────────────────────────────────────────────────────

    private val COLOR_CODES = setOf(
        "BLK", "BLAN", "WHT", "RED", "BLU", "GRN", "YLW", "NVY", "GRS",
        "ROSA", "PINK", "LILA", "MOR", "NAR", "NARAN", "CAF", "CHR",
        "FUCS", "FUCSIA", "TURQ", "BEIG", "CREM", "CRUDO", "CRU",
        "DOR", "PLA", "PLAT", "NEG", "NEGRO", "BLANCO", "ROJO", "AZUL",
        "VERDE", "AMARILLO", "GRIS", "MARRON", "VIOLETA", "CELESTE",
        "SALMON", "CORAL", "BURDEOS", "TABACO", "JABATO", "CAMUFLAJE",
        "J019", "F0D9", "G1H3", "B7K1", "N110", "P000", "T901"
    )

    // ─── Temporada ─────────────────────────────────────────────────

    private val TEMPORADA_PATTERNS = listOf(
        // "OT-INV 2024", "Otoño-Invierno 2024"
        Regex("""(?:OTOÑO|INVIERNO|OT|IN)[\s\-\/]*(?:INV|INVIERNO)?[\s\-]*(\d{2,4})""", RegexOption.IGNORE_CASE),
        // "PRIM-VER 2024", "Primavera-Verano 2024"
        Regex("""(?:PRIMAVERA|VERANO|PV|PR|PRIM)[\s\-\/]*(?:VER|VERANO)?[\s\-]*(\d{2,4})""", RegexOption.IGNORE_CASE),
        // "SS24", "FW24", "AW24"
        Regex("""(?:SS|FW|AW|OT|IN)(\d{2,4})""", RegexOption.IGNORE_CASE),
        // "2026-3", "2026-03", "2026/3" — temporada numérica con separador
        Regex("""\b(20[2-3]\d)[\s\-\/]+(\d{1,2})\b"""),
        // "2024", "2025" standalone
        Regex("""\b(20[2-3]\d)\b"""),
    )

    // ─── Tipo de producto ──────────────────────────────────────────

    private val TIPO_KEYWORDS = mapOf(
        "BLUSA" to "blusa", "TOP" to "blusa", "PLAYERA" to "playera",
        "CAMISA" to "camisa", "CAMISETA" to "playera", "T-SHIRT" to "playera",
        "VESTIDO" to "vestido", "FALDA" to "falda", "PANTALON" to "pantalon",
        "JEANS" to "jeans", "SHORT" to "short", "BERMUDAS" to "short",
        "SUETER" to "sueter", "SWEATER" to "sueter", "CARDIGAN" to "sueter",
        "CHAQUETA" to "chaqueta", "JACKET" to "chaqueta", "COAT" to "chaqueta",
        "FAJAS" to "faja", "CINTURON" to "cinturon", "BUZO" to "buzo",
        "LEGGINGS" to "leggings", "CALCETINES" to "calcetines",
        "ROPA DE BAÑO" to "baño", "SWIMSUIT" to "baño", "BIKINI" to "baño",
        "TRAJE" to "traje", "SUIT" to "traje", "BLAZER" to "blazer",
        "COJIN" to "hogar", "TOALLA" to "hogar", "ROPA DE CAMA" to "hogar",
    )

    // ─── Función principal ─────────────────────────────────────────

    // Marca por defecto cuando la etiqueta no trae marca visible
    private const val DEFAULT_MARCA = "GUESS"

    fun parse(rawText: String, barcode: String? = null): LabelTextResult {
        val normalized = normalizeText(rawText)
        val lines = rawText.lines().map { it.trim() }.filter { it.isNotEmpty() }

        val tallaResult = extractTalla(normalized)
        val modeloResult = extractModelo(normalized, lines)
        val colorResult = extractColor(normalized, modeloResult.first)
        val skuResult = extractSku(normalized) ?: barcode
        val marcaResult = extractMarca(normalized, lines) ?: DEFAULT_MARCA
        val temporadaResult = extractTemporada(normalized)
        val tipoResult = extractTipo(normalized)

        val confidence = calculateConfidence(
            marca = marcaResult,
            talla = tallaResult.first,
            sku = skuResult,
            modeloGrupo = modeloResult.first,
            codigoColor = colorResult.first,
            fechaTemporada = temporadaResult,
            tipoProducto = tipoResult,
            rawTextLength = rawText.length
        )

        return LabelTextResult(
            marca = marcaResult,
            talla = tallaResult.first,
            sku = skuResult ?: skuResult, // may be from EAN
            modeloGrupo = modeloResult.first,
            codigoColor = colorResult.first,
            fechaTemporada = temporadaResult,
            tipoProducto = tipoResult,
            confidence = confidence,
            rawText = rawText
        )
    }

    // ─── Normalización ─────────────────────────────────────────────

    private fun normalizeText(text: String): String {
        return text.uppercase()
            .replace(Regex("[ÀÁÂÃÄÅ]"), "A")
            .replace(Regex("[ÈÉÊË]"), "E")
            .replace(Regex("[ÌÍÎÏ]"), "I")
            .replace(Regex("[ÒÓÔÕÖ]"), "O")
            .replace(Regex("[ÙÚÛÜ]"), "U")
            .replace(Regex("[Ç]"), "C")
            .replace(Regex("[Ñ]"), "N")
            .replace(Regex("\\s+"), " ")
            .trim()
    }

    // ─── Extracción de campos ──────────────────────────────────────

    private fun extractTalla(text: String): Pair<String?, Boolean> {
        for (pattern in TALLA_PATTERNS) {
            val match = pattern.find(text) ?: continue
            val value = match.groupValues[1].uppercase()
            if (value in VALID_TALLAS) {
                return Pair(value, true)
            }
        }

        // Fallback: buscar NOSZ en cualquier parte (aunque pegado a otros chars)
        if (text.contains("NOSZ", ignoreCase = true)) {
            return Pair("NOSZ", true)
        }

        // Fallback: buscar talla como palabra aislada
        val words = text.split(" ", ",", "/", "-")
        for (word in words) {
            val clean = word.trim()
            if (clean in VALID_TALLAS) {
                return Pair(clean, false)
            }
        }
        return Pair(null, false)
    }

    private fun extractModelo(text: String, lines: List<String>): Pair<String?, Boolean> {
        // 1. Buscar modelo compuesto con color: "W5BP39KACM2-G1H3"
        val compoundMatch = COMPOUND_MODEL_REGEX.find(text)
        if (compoundMatch != null) {
            return Pair(compoundMatch.groupValues[1], true)
        }

        // 2. Buscar SKU (que a menudo ES el modelo)
        val skuMatch = SKU_REGEX.find(text)
        if (skuMatch != null) {
            return Pair(skuMatch.groupValues[1], true)
        }

        // 3. Buscar en líneas cercanas a "MODELO" o "MODEL"
        for (i in lines.indices) {
            val line = lines[i].uppercase()
            if (line.contains("MODELO") || line.contains("MODEL") || line.contains("REF") || line.contains("REFERENCIA")) {
                // Extraer valor después del keyword
                val afterKeyword = line.replace(Regex(".*(?:MODELO|MODEL|REF|REFERENCIA)[:\\s]*"), "").trim()
                if (afterKeyword.isNotEmpty() && afterKeyword.length in 3..20) {
                    return Pair(afterKeyword, true)
                }
                // Buscar en la siguiente línea
                if (i + 1 < lines.size) {
                    val nextLine = lines[i + 1].trim()
                    if (nextLine.length in 3..20 && nextLine.matches(Regex("[A-Z0-9\\-]+"))) {
                        return Pair(nextLine, true)
                    }
                }
            }
        }

        // 4. Buscar modelo standalone: palabra alfanumérica 5-15 chars que empiece con letra
        val modeloMatch = MODELO_REGEX.find(text)
        if (modeloMatch != null) {
            val candidate = modeloMatch.groupValues[1]
            // Filtrar falsos positivos (palabras comunes)
            if (!isCommonWord(candidate)) {
                return Pair(candidate, false)
            }
        }

        return Pair(null, false)
    }

    private fun extractColor(text: String, modeloFound: String?): Pair<String?, Boolean> {
        // 1. Si hay modelo compuesto, extraer color del guión
        val compoundMatch = COMPOUND_MODEL_REGEX.find(text)
        if (compoundMatch != null) {
            val color = compoundMatch.groupValues[2]
            if (color.length in 3..6) {
                return Pair(color, true)
            }
        }

        // 2. Buscar keyword de color conocido
        for (colorCode in COLOR_CODES) {
            if (text.contains("\\b${colorCode}\\b".toRegex())) {
                return Pair(colorCode, true)
            }
        }

        // 3. Buscar después de "COLOR" o "COLOUR"
        val colorLabelMatch = Regex("""(?:COLOR|COLOUR)[:\s]+([A-Z0-9]{2,10})""", RegexOption.IGNORE_CASE).find(text)
        if (colorLabelMatch != null) {
            return Pair(colorLabelMatch.groupValues[1], true)
        }

        // 4. Si hay modelo encontrado, buscar código de color de 3-6 chars al final del modelo concatenado
        //    Ejemplo: "M6YP29K4476F7LM" → modelo "M6YP29K4476" + color "F7LM"
        if (modeloFound != null && modeloFound.length >= 5) {
            val modelIdx = text.indexOf(modeloFound)
            if (modelIdx >= 0) {
                val afterModel = text.substring(modelIdx + modeloFound.length).trimStart('-', ' ')
                val colorMatch = Regex("""^([A-Z0-9]{3,6})\b""").find(afterModel)
                if (colorMatch != null) {
                    val candidate = colorMatch.groupValues[1]
                    // No confundir con talla u otros códigos
                    if (candidate !in VALID_TALLAS && candidate.length >= 3) {
                        return Pair(candidate, true)
                    }
                }
            }
        }

        return Pair(null, false)
    }

    private fun extractSku(text: String): String? {
        // 1. Buscar EAN/UPC primero (12-13 dígitos, más confiable)
        val eanMatch = EAN_REGEX.find(text)
        if (eanMatch != null) {
            return eanMatch.groupValues[1]
        }

        // 2. Buscar SKU labeled (solo dígitos — barcode es puro número)
        val skuLabelMatch = Regex("""(?:SKU|REF|REFERENCIA)[:\s]*(\d{8,15})""", RegexOption.IGNORE_CASE).find(text)
        if (skuLabelMatch != null) {
            return skuLabelMatch.groupValues[1]
        }

        // NO buscar SKU standalone alfanumérico — eso captura modelos como SKU
        // El barcode siempre se usa como fallback en parse()

        return null
    }

    private fun extractMarca(text: String, lines: List<String>): String? {
        // Labels comunes que NO son marcas (evitar falsos positivos)
        val fieldLabels = setOf(
            "SIZE", "TALLA", "COLOR", "COLOUR", "MODEL", "MODELO", "SKU", "REF",
            "REFERENCIA", "BRAND", "MARCA", "QTY", "CANTIDAD", "PRICE", "PRECIO",
            "FABRIC", "TELA", "COMPOSITION", "COMPOSICION", "CARE", "CUIDADO",
            "MADE IN", "HECHO EN", "SEASON", "TEMPORADA", "GENDER", "GENERO",
            "TYPE", "TIPO", "STYLE", "ESTILO", "ITEM", "ARTICULO", "CODE", "CODIGO"
        )

        // 1. Buscar en lista de marcas conocidas
        for (marca in MARCA_KEYWORDS) {
            if (text.contains(marca, ignoreCase = true)) {
                return marca
            }
        }

        // 2. Buscar en la primera línea (las marcas suelen estar arriba)
        if (lines.isNotEmpty()) {
            val firstLine = lines.first().trim()
            if (firstLine.length in 2..30 && firstLine.matches(Regex("[A-ZÁÉÍÓÚÑa-záéíóúñ\\s&'\\-\\.]+"))) {
                // Filtrar labels comunes
                if (firstLine.uppercase() !in fieldLabels) {
                    return firstLine
                }
            }
        }

        // 3. Buscar después de "MARCA" o "BRAND"
        val marcaLabelMatch = Regex("""(?:MARCA|BRAND)[:\s]+([A-ZÁÉÍÓÚÑa-záéíóúñ\s&'\\-\\.]{2,30})""", RegexOption.IGNORE_CASE).find(text)
        if (marcaLabelMatch != null) {
            return marcaLabelMatch.groupValues[1].trim()
        }

        return null
    }

    private fun extractTemporada(text: String): String? {
        for (pattern in TEMPORADA_PATTERNS) {
            val match = pattern.find(text) ?: continue
            val year = match.groupValues[1]
            val fullMatch = match.value

            // Si hay segundo capture group (temporada numérica como "2026-3")
            val seasonNum = if (match.groupValues.size > 2 && match.groupValues[2].isNotEmpty()) {
                match.groupValues[2]
            } else null

            // Construir temporada legible
            return when {
                fullMatch.contains("OTOÑO", ignoreCase = true) || fullMatch.contains("OT", ignoreCase = true) || fullMatch.contains("FW", ignoreCase = true) || fullMatch.contains("AW", ignoreCase = true) ->
                    "Otoño-Invierno $year"
                fullMatch.contains("PRIMAVERA", ignoreCase = true) || fullMatch.contains("PV", ignoreCase = true) || fullMatch.contains("PR", ignoreCase = true) || fullMatch.contains("SS", ignoreCase = true) ->
                    "Primavera-Verano $year"
                seasonNum != null ->
                    "$year-$seasonNum"  // Formato numérico: "2026-3"
                else -> "Temporada $year"
            }
        }
        return null
    }

    private fun extractTipo(text: String): String? {
        for ((keyword, tipo) in TIPO_KEYWORDS) {
            if (text.contains(keyword)) {
                return tipo
            }
        }
        return null
    }

    // ─── Scoring de confianza ──────────────────────────────────────

    private fun calculateConfidence(
        marca: String?,
        talla: String?,
        sku: String?,
        modeloGrupo: String?,
        codigoColor: String?,
        fechaTemporada: String?,
        tipoProducto: String?,
        rawTextLength: Int
    ): Int {
        var score = 0

        // Campos obligatorios (los más importantes para inventario)
        if (modeloGrupo != null) score += 30
        if (talla != null) score += 20
        if (sku != null) score += 20

        // Campos adicionales
        if (marca != null) score += 15
        if (codigoColor != null) score += 10
        if (fechaTemporada != null) score += 3
        if (tipoProducto != null) score += 2

        // Bonus: si hay texto suficiente para analizar
        if (rawTextLength > 50) score += 3
        if (rawTextLength > 100) score += 2

        // Penalización: muy poco texto extraído
        if (rawTextLength < 10) score -= 20
        if (rawTextLength < 20) score -= 10

        // Penalización: modelo sin talla (raro en etiquetas reales)
        if (modeloGrupo != null && talla == null) score -= 5

        return score.coerceIn(0, 100)
    }

    // ─── Helpers ───────────────────────────────────────────────────

    private fun isCommonWord(word: String): Boolean {
        val commons = setOf(
            "THE", "AND", "FOR", "ARE", "BUT", "NOT", "YOU", "ALL",
            "CAN", "HER", "WAS", "ONE", "OUR", "OUT", "HAS", "HIS",
            "HOW", "MAN", "NEW", "NOW", "OLD", "SEE", "WAY", "WHO",
            "MADE", "TIME", "VERY", "WHEN", "COME", "EACH", "TAKE",
            "BEEN", "HAVE", "FROM", "LOVE", "LOOK", "SIZE", "TALL",
            "WITH", "THAT", "THIS", "WILL", "YOUR", "SOME", "THEM",
            "MADE", "LIKE", "LONG", "LOOK", "MANY", "MOST", "OVER",
            "SUCH", "TAKE", "THAN", "THEM", "THEN", "WHAT", "WHEN"
        )
        return word.length < 5 || word in commons
    }
}
