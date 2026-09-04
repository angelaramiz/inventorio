package com.inventorio.operations

import android.Manifest
import android.content.pm.PackageManager
import android.net.Uri
import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.camera.core.*
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import com.google.gson.Gson
import com.google.gson.reflect.TypeToken
import com.google.mlkit.vision.barcode.BarcodeScanning
import com.google.mlkit.vision.barcode.BarcodeScannerOptions
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.common.InputImage
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.URLEncoder
import java.util.UUID

fun String.urlEncode(): String = URLEncoder.encode(this, "UTF-8")

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CsvOperationsView(client: OkHttpClient, serverUrl: String, onLogsUpdate: (List<String>) -> Unit = {}, onSendToManifiesto: ((String) -> Unit)? = null) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val gson = remember { Gson() }
    val db = remember { OperationsDbHelper(context) }
    val lifecycleOwner = LocalLifecycleOwner.current

    val initialSessionId = remember { db.getLastSessionId() ?: UUID.randomUUID().toString() }
    var sessionId by remember { mutableStateOf(initialSessionId) }
    var activeSubTab by remember { mutableStateOf("dashboard") }
    var secondChanceSubTab by remember { mutableStateOf("list") }
    var csvProducts by remember { mutableStateOf<List<CsvProductRow>>(emptyList()) }
    var isLoading by remember { mutableStateOf(false) }
    var isScannerActive by remember { mutableStateOf(false) }
    var refreshTrigger by remember { mutableStateOf(0) }
    var searchProgress by remember { mutableStateOf(Pair(0, 0)) }
    var searchPhase by remember { mutableStateOf("") }
    var searchCompleted by remember { mutableStateOf(false) }

    var secondChanceList by remember { mutableStateOf<List<SecondChanceRow>>(emptyList()) }
    var pendingUploads by remember { mutableStateOf<List<PendingUploadRow>>(emptyList()) }
    var notFoundList by remember { mutableStateOf<List<NotFoundRow>>(emptyList()) }
    var cloudLocations by remember { mutableStateOf<List<CloudLocationRow>>(emptyList()) }
    var searchLog by remember { mutableStateOf<List<String>>(emptyList()) }
    var scannerLogs by remember { mutableStateOf<List<String>>(emptyList()) }
    var lastScanResult by remember { mutableStateOf("") }
    var lastScannedCode by remember { mutableStateOf("") }
    var isScanProcessing by remember { mutableStateOf(false) }

    val totalSolicitado = csvProducts.sumOf { it.cantidadSolicitada }
    val totalEncontrado = csvProducts.sumOf { it.cantidadEncontrada }
    val totalFaltante = totalSolicitado - totalEncontrado

    val refreshData: () -> Unit = {
        csvProducts = db.getCsvProducts(sessionId)
        secondChanceList = db.getSecondChance(sessionId)
        pendingUploads = db.getPendingUploads(sessionId)
        notFoundList = db.getNotFound(sessionId)
        cloudLocations = db.getCloudLocations(sessionId)
    }

    val parseCsv: (String, String) -> Unit = { content, name ->
        val newSessionId = UUID.randomUUID().toString()
        sessionId = newSessionId
        scope.launch(Dispatchers.IO) {
            try {
                val rows = CsvNormalizer.parse(content)
                db.clearSession(newSessionId)
                for (row in rows) db.insertCsvProduct(newSessionId, row)
                withContext(Dispatchers.Main) { refreshData(); Toast.makeText(context, "${rows.size} productos importados", Toast.LENGTH_SHORT).show() }
            } catch (e: Exception) { withContext(Dispatchers.Main) { Toast.makeText(context, "Error CSV: ${e.message}", Toast.LENGTH_LONG).show() } }
        }
    }

    val searchCloud: () -> Unit = {
        val currentProducts = csvProducts
        if (currentProducts.isNotEmpty()) {
        isLoading = true; searchProgress = Pair(0, 0); searchPhase = "Preparando..."
        searchLog = emptyList()
        scope.launch(Dispatchers.IO) {
            try {
                val freshProducts = db.getCsvProducts(sessionId)
                val toSearch = freshProducts.filter { it.estado == "rojo" && it.sku.isNotBlank() }
                val noUpc = freshProducts.filter { it.estado == "rojo" && it.sku.isBlank() }
                val total = toSearch.size + noUpc.size; var processed = 0

                for (row in noUpc) { db.insertSecondChance(sessionId, row.id, row.cantidadSolicitada, "sin_registro"); processed++ }
                withContext(Dispatchers.Main) { searchProgress = Pair(processed, total); searchPhase = "Sin UPC: $processed/$total" }

                val logs = mutableListOf<String>()
                var found = 0; var notFound = 0; var withStock = 0
                val baseUrl = serverUrl.trimEnd('/')

                // Send UPCs in batches of 100 to server
                val upcChunks = toSearch.chunked(300)
                for (chunk in upcChunks) {
                    try {
                        val queries = chunk.map { mapOf("sku" to it.sku.trim(), "modelo" to it.modeloGrupo.trim()) }
                        val bodyJson = gson.toJson(mapOf("queries" to queries))
                        val req = Request.Builder()
                            .url("$baseUrl/api/consultar-productos-batch")
                            .post(bodyJson.toRequestBody("application/json".toMediaType()))
                            .build()
                        val resp = client.newCall(req).execute()
                        val code = resp.code
                        val body = resp.body?.string() ?: "{}"
                        resp.close()

                        if (code == 200) {
                            val json = gson.fromJson(body, Map::class.java)
                            val results = (json["results"] as? List<*>) ?: listOf<Any>()
                            // Debug: log first result structure
                            if (results.isNotEmpty()) {
                                val firstResult = results[0] as? Map<String, Any>
                                val firstBoxes = (firstResult?.get("boxes") as? List<*>) ?: emptyList<Any>()
                                logs.add("DEBUG: Batch returned ${results.size} results, first has ${firstBoxes.size} boxes")
                                if (firstBoxes.isNotEmpty()) {
                                    val firstBox = firstBoxes[0] as? Map<String, Any>
                                    logs.add("DEBUG: First box keys: ${firstBox?.keys}")
                                }
                            }

                            for (i in results.indices) {
                                val result = results[i] as? Map<String, Any> ?: continue
                                val csvRow = chunk[i]
                                val wasFound = result["found"] as? Boolean ?: false
                                val productData = result["product"] as? Map<String, Any>
                                val boxesRaw = (result["boxes"] as? List<*>) ?: listOf<Any>()
                                var debugInfo = "→ UPC:${csvRow.sku}"

                                if (wasFound && productData != null) {
                                    found++
                                    val productName = productData["modelo_grupo"]?.toString() ?: "?"
                                    val productId = productData["id_producto"]?.toString() ?: "?"
                                    val productSku = productData["sku"]?.toString() ?: "?"
                                    val productEan = productData["ean_13"]?.toString() ?: "?"
                                    debugInfo += " ✓|$productName (id:$productId, sku:$productSku, ean:$productEan)"

                                    var totalCant = 0; var boxesCount = 0
                                    for (boxItem in boxesRaw) {
                                        val box = boxItem as? Map<String, Any> ?: continue
                                        val cant = box["cantidad"]?.toString()?.toIntOrNull() ?: 0
                                        if (cant <= 0) continue
                                        totalCant += cant; boxesCount++

                                        val caja = box["cajas"] as? Map<*, *>
                                        val cajaNombre = caja?.get("numero_caja")?.toString() ?: ""
                                        val almacenNombre = caja?.get("almacen_nombre")?.toString() ?: ""
                                        val nivelNombre = caja?.get("nivel_nombre")?.toString() ?: ""

                                        db.insertCloudLocation(sessionId, csvRow.id, FoundLocation(
                                            idProducto = csvRow.id.toInt(), sku = csvRow.sku,
                                            ubicacion = "$almacenNombre $cajaNombre".trim(),
                                            cantidadEnUbicacion = cant,
                                            nivelNombre = nivelNombre.ifBlank { null },
                                            cajaNombre = cajaNombre.ifBlank { null },
                                            almacenNombre = almacenNombre.ifBlank { null }
                                        ))
                                    }
                                    debugInfo += " |$boxesCount cajas, $totalCant uds"

                                    if (totalCant >= csvRow.cantidadSolicitada) { db.updateProductStatus(csvRow.id, csvRow.cantidadSolicitada, "verde"); withStock++ }
                                    else if (totalCant > 0) { db.updateProductStatus(csvRow.id, totalCant, "amarillo"); db.insertSecondChance(sessionId, csvRow.id, csvRow.cantidadSolicitada - totalCant, "parcial"); withStock++ }
                                    else { db.updateProductStatus(csvRow.id, 0, "amarillo"); db.insertSecondChance(sessionId, csvRow.id, csvRow.cantidadSolicitada, "sin_stock") }
                                } else {
                                    debugInfo += " ✗ sin registro"
                                    db.insertSecondChance(sessionId, csvRow.id, csvRow.cantidadSolicitada, "sin_registro")
                                    notFound++
                                }
                                logs.add(debugInfo)
                            }
                        } else {
                            logs.add("✗ HTTP $code para lote de ${chunk.size}")
                            for (csvRow in chunk) {
                                db.insertSecondChance(sessionId, csvRow.id, csvRow.cantidadSolicitada, "sin_registro")
                                notFound++
                            }
                        }
                    } catch (e: Exception) {
                        logs.add("✗ ${e.javaClass.simpleName}: ${e.message?.take(60)}")
                        for (csvRow in chunk) {
                            db.insertSecondChance(sessionId, csvRow.id, csvRow.cantidadSolicitada, "sin_registro")
                            notFound++
                        }
                    }
                    processed += chunk.size
                    withContext(Dispatchers.Main) {
                        searchLog = logs.toList()
                        searchProgress = Pair(processed, total)
                        searchPhase = "UPC: $processed/$total (${found}↑ ${notFound}↓)"
                    }
                }

                val finalProducts = db.getCsvProducts(sessionId)
                val scIds = db.getSecondChance(sessionId).map { it.csvProductId }.toSet()
                for (fp in finalProducts) { if (fp.estado == "rojo" && fp.id !in scIds) { db.insertSecondChance(sessionId, fp.id, fp.cantidadSolicitada, "sin_registro") } }

                withContext(Dispatchers.Main) {
                    searchProgress = Pair(total, total); searchPhase = "Completado"
                    searchLog = logs.toList()
                    refreshData(); isLoading = false; refreshTrigger++
                    searchCompleted = true
                    Toast.makeText(context, "✓ $withStock con stock · ↗ $found encontrados · ✗ $notFound sin registro", Toast.LENGTH_LONG).show()
                }
            } catch (_: Exception) { withContext(Dispatchers.Main) { isLoading = false; searchProgress = Pair(0, 0); searchPhase = ""; Toast.makeText(context, "Error en búsqueda", Toast.LENGTH_SHORT).show() } }
        }
        }
    }

    val handleSecondChanceScan: (String) -> Unit = { barcode ->
        val timestamp = java.text.SimpleDateFormat("HH:mm:ss", java.util.Locale.getDefault()).format(java.util.Date())
        // Normalizar: trim + solo dígitos + sin ceros a la izquierda (EAN-13 vs UPC varía según lector)
        val code = barcode.trim()
        val digits = code.filter { it.isDigit() }
        val digitsNoZero = digits.trimStart('0')
        fun skuMatch(sku: String): Boolean {
            val s = sku.trim()
            return s == code || s == digits || s.trimStart('0') == digitsNoZero && digitsNoZero.isNotEmpty()
        }
        val logs = scannerLogs.toMutableList()
        logs.add("[$timestamp] 📷 Escaneado: $code")
        isScanProcessing = true
        lastScanResult = "⏳ Procesando $code..."
        lastScannedCode = code

        val sc = secondChanceList.firstOrNull { skuMatch(it.sku) || it.modeloGrupo.contains(code) }
        if (sc != null) {
            logs.add("[$timestamp] ✓ Encontrado en pendientes: ${sc.modeloGrupo} ${sc.sku}")
            logs.add("[$timestamp] → Consultando API: /api/consultar-producto/$code")

            scope.launch(Dispatchers.IO) {
                var outcome = ""
                try {
                    val resp = client.newCall(Request.Builder().url("${serverUrl.trimEnd('/')}/api/consultar-producto/${code.urlEncode()}").build()).execute()
                    val respCode = resp.code
                    logs.add("[$timestamp] ← API respuesta: HTTP $respCode")

                    if (resp.isSuccessful) {
                        val body = resp.body?.string() ?: "{}"
                        val json = gson.fromJson(body, Map::class.java)
                        val product = json["product"] as? Map<String, Any>
                        val boxes = (json["boxes"] as? List<*>)?.mapNotNull { it as? Map<String, Any> } ?: emptyList()

                        if (product != null) {
                            val productName = product["modelo_grupo"]?.toString() ?: "?"
                            logs.add("[$timestamp] ✓ Producto encontrado en Supabase: $productName")
                            logs.add("[$timestamp]   Cajas devueltas: ${boxes.size}")

                            var totalFound = 0
                            for (box in boxes) {
                                val cant = box["cantidad"]?.toString()?.toIntOrNull() ?: 0
                                totalFound += cant
                                val caja = box["cajas"] as? Map<*, *>
                                logs.add("[$timestamp]   📦 Caja: ${caja?.get("numero_caja")} | Cant: $cant")
                            }
                            logs.add("[$timestamp]   Total unidades: $totalFound")

                            val row = db.getProductById(sc.csvProductId)
                            if (row != null) {
                                val combined = sc.cantidadEncontrada + totalFound
                                logs.add("[$timestamp]   Antes: ${sc.cantidadEncontrada}/${row.cantidadSolicitada} | Ahora: $combined/${row.cantidadSolicitada}")

                                if (combined >= row.cantidadSolicitada) {
                                    db.updateProductStatus(sc.csvProductId, row.cantidadSolicitada, "verde")
                                    db.removeSecondChance(sc.csvProductId)
                                    logs.add("[$timestamp] 🟢 → VERDE (completado)")
                                    outcome = "🟢 ${sc.modeloGrupo}: completado ${row.cantidadSolicitada}/${row.cantidadSolicitada}"
                                } else if (combined > sc.cantidadEncontrada) {
                                    db.updateProductStatus(sc.csvProductId, combined, "amarillo")
                                    db.insertSecondChance(sessionId, sc.csvProductId, row.cantidadSolicitada - combined, "parcial")
                                    logs.add("[$timestamp] 🟡 → AMARILLO (parcial: $combined/${row.cantidadSolicitada})")
                                    outcome = "🟡 ${sc.modeloGrupo}: parcial $combined/${row.cantidadSolicitada}"
                                } else {
                                    if (totalFound == 0) {
                                        logs.add("[$timestamp] ⚠️ Existe en nube pero SIN STOCK (0/${row.cantidadSolicitada}) — sigue en pendientes")
                                        outcome = "⚠️ ${sc.modeloGrupo}: en nube pero sin stock (0/${row.cantidadSolicitada})"
                                    } else {
                                        logs.add("[$timestamp] ⚠️ Sin cambio (unidades ya contabilizadas)")
                                        outcome = "⚠️ ${sc.modeloGrupo}: sin cambio ($totalFound uds en nube, ya contadas)"
                                    }
                                }
                            }
                        } else {
                            logs.add("[$timestamp] ⚠️ Producto NO registrado en Supabase (200 pero sin datos)")
                            logs.add("[$timestamp] → Agregando a Alta Nube")
                            val row = db.getProductById(sc.csvProductId)!!
                            if (!db.hasPendingUpload(sc.csvProductId)) {
                                db.insertPendingUpload(sessionId, sc.csvProductId, TransformedRow(row.modeloGrupo, row.codigoColor, row.talla, row.sku, row.linea, row.categoria, row.cantidadSolicitada, emptyMap()), code)
                            } else {
                                logs.add("[$timestamp] ℹ️ Ya estaba en Alta Nube (sin duplicar)")
                            }
                            db.updateProductStatus(sc.csvProductId, sc.cantidadEncontrada + 1, "amarillo")
                            logs.add("[$timestamp] 🟡 → AMARILLO + Alta Nube")
                            outcome = "🟡 ${sc.modeloGrupo}: +1 físico → Alta Nube"
                        }
                    } else {
                        logs.add("[$timestamp] ❌ API retornó error HTTP $respCode")
                        logs.add("[$timestamp] → Agregando a Alta Nube (no registrado)")
                        val row = db.getProductById(sc.csvProductId)
                        if (row != null) {
                            val newFound = sc.cantidadEncontrada + 1
                            if (!db.hasPendingUpload(sc.csvProductId)) {
                                db.insertPendingUpload(sessionId, sc.csvProductId, TransformedRow(row.modeloGrupo, row.codigoColor, row.talla, row.sku, row.linea, row.categoria, row.cantidadSolicitada, emptyMap()), code)
                            } else {
                                logs.add("[$timestamp] ℹ️ Ya estaba en Alta Nube (sin duplicar)")
                            }
                            if (newFound >= row.cantidadSolicitada) {
                                db.updateProductStatus(sc.csvProductId, row.cantidadSolicitada, "verde")
                                db.removeSecondChance(sc.csvProductId)
                                logs.add("[$timestamp] 🟢 → VERDE (completado) + Alta Nube")
                                outcome = "🟢 ${sc.modeloGrupo}: completado + Alta Nube"
                            } else {
                                db.updateProductStatus(sc.csvProductId, newFound, "amarillo")
                                db.insertSecondChance(sessionId, sc.csvProductId, row.cantidadSolicitada - newFound, "parcial")
                                logs.add("[$timestamp] 🟡 → AMARILLO ($newFound/${row.cantidadSolicitada}) + Alta Nube")
                                outcome = "🟡 ${sc.modeloGrupo}: $newFound/${row.cantidadSolicitada} + Alta Nube"
                            }
                        } else {
                            db.removeSecondChance(sc.csvProductId)
                            logs.add("[$timestamp] ❌ Producto no encontrado en SQLite local")
                            outcome = "❌ Error interno: producto no está en SQLite"
                        }
                    }
                    resp.close()
                } catch (e: Exception) {
                    logs.add("[$timestamp] ❌ ERROR: ${e.javaClass.simpleName}: ${e.message?.take(100)}")
                    outcome = "❌ Error de red: ${e.message?.take(60)}"
                }
                withContext(Dispatchers.Main) {
                    scannerLogs = logs; onLogsUpdate(logs); refreshData()
                    isScannerActive = false; isScanProcessing = false
                    lastScanResult = if (outcome.isBlank()) "⚠️ Sin respuesta" else outcome
                    Toast.makeText(context, lastScanResult, Toast.LENGTH_LONG).show()
                    secondChanceSubTab = "list"
                    refreshTrigger++
                }
            }
        } else {
            logs.add("[$timestamp] ❌ Código NO encontrado en pendientes de Segunda Oportunidad")
            logs.add("[$timestamp]   SKU: $code")
            logs.add("[$timestamp]   Pendientes disponibles: ${secondChanceList.size}")
            scope.launch(Dispatchers.IO) {
                var outcome = ""
                var goMissing = false
                // 1. Pre-chequeo local (sin red): ¿ya rechazado antes?
                val alreadyRejected = db.hasNotFoundBarcode(sessionId, code)
                // ¿Está en el CSV? Todo lo no-verde está en pendientes → si está en CSV es verde (completado)
                val inCsv = csvProducts.any { skuMatch(it.sku) || it.modeloGrupo.contains(code) }
                if (alreadyRejected) {
                    logs.add("[$timestamp] ⚠️ Ya registrado como no existente (sin re-escanear)")
                    outcome = "⚠️ $code ya está en No Existentes"
                    goMissing = true
                } else if (digits.length < 4) {
                    logs.add("[$timestamp] ⚠️ Código demasiado corto — posible lectura errónea, no se registra")
                    outcome = "⚠️ Código inválido ($code) — vuelve a escanear"
                } else if (inCsv) {
                    logs.add("[$timestamp] ✅ Está en CSV y fuera de pendientes → ya completado (verde)")
                    outcome = "✅ $code ya completado — no requiere acción"
                } else {
                    // 2. No está en CSV → ¿existe en la nube?
                    try {
                        val resp = client.newCall(Request.Builder().url("${serverUrl.trimEnd('/')}/api/consultar-producto/${code.urlEncode()}").build()).execute()
                        val respCode = resp.code
                        val body = resp.body?.string() ?: "{}"
                        resp.close()
                        if (respCode == 200) {
                            val json = gson.fromJson(body, Map::class.java)
                            val product = json["product"] as? Map<String, Any>
                            if (product == null) {
                                if (!db.hasNotFoundBarcode(sessionId, code)) db.insertNotFoundBarcode(sessionId, code)
                                logs.add("[$timestamp] ⛔ Ni en CSV ni en nube → No Existentes")
                                outcome = "⛔ $code no existe en el sistema → No Existentes"
                                goMissing = true
                            } else {
                                logs.add("[$timestamp] ℹ️ Existe en nube pero NO en CSV — no se agrega")
                                outcome = "ℹ️ $code existe en nube pero no en el CSV"
                            }
                        } else if (respCode == 404) {
                            // 404 = no existe en nube (ni en CSV, ya verificado) → No Existentes
                            if (!db.hasNotFoundBarcode(sessionId, code)) db.insertNotFoundBarcode(sessionId, code)
                            logs.add("[$timestamp] ⛔ Nube 404 + no en CSV → No Existentes")
                            outcome = "⛔ $code no existe en el sistema → No Existentes"
                            goMissing = true
                        } else {
                            logs.add("[$timestamp] ❌ API retornó HTTP $respCode — no se puede validar")
                            outcome = "❌ Error HTTP $respCode al validar $code"
                        }
                    } catch (e: Exception) {
                        logs.add("[$timestamp] ❌ ERROR: ${e.javaClass.simpleName}: ${e.message?.take(100)}")
                        outcome = "❌ Error de red: ${e.message?.take(60)}"
                    }
                }
                withContext(Dispatchers.Main) {
                    scannerLogs = logs; onLogsUpdate(logs); refreshData()
                    isScanProcessing = false
                    lastScanResult = outcome
                    Toast.makeText(context, outcome, Toast.LENGTH_LONG).show()
                    if (goMissing) secondChanceSubTab = "missing"
                    refreshTrigger++
                }
            }
        }
    }

    val filePickerLauncher = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri: Uri? ->
        if (uri != null) { isLoading = true; scope.launch(Dispatchers.IO) { try { context.contentResolver.openInputStream(uri)?.use { parseCsv(BufferedReader(InputStreamReader(it)).readText(), uri.lastPathSegment ?: "archivo.csv") } } catch (e: Exception) { withContext(Dispatchers.Main) { Toast.makeText(context, "Error: ${e.message}", Toast.LENGTH_LONG).show() } } finally { withContext(Dispatchers.Main) { isLoading = false } } } }
    }

    val registerPendingProducts: () -> Unit = {
        val snapshot = pendingUploads.toList()
        if (snapshot.isNotEmpty()) {
        isLoading = true
        scope.launch(Dispatchers.IO) {
            var ok = 0; var failed = 0
            try {
                for (pu in snapshot) {
                    try {
                        val resp = client.newCall(Request.Builder().url("${serverUrl.trimEnd('/')}/api/productos").post(
                            FormBody.Builder().add("sku", pu.sku.ifBlank { pu.scannedBarcode }).add("ean_13", pu.scannedBarcode)
                                .add("tipo", pu.categoria.ifBlank { "ropa" }).add("talla", pu.talla.ifBlank { "UNICA" })
                                .add("marca_sub", pu.linea.ifBlank { "SIN MARCA" }).add("modelo_grupo", pu.modeloGrupo)
                                .add("codigo_color", pu.codigoColor).add("temporada", "todo uso").build()
                        ).build()).execute()
                        val success = resp.isSuccessful
                        resp.close()
                        if (success) {
                            // Alta confirmada en la nube → VERDE (aparece en Carrito) y sale de pendientes
                            db.updateProductStatus(pu.csvProductId, pu.cantidad, "verde")
                            db.removeSecondChance(pu.csvProductId)
                            db.removePendingUpload(pu.csvProductId)
                            ok++
                        } else { failed++ }
                    } catch (_: Exception) { failed++ }
                }
                withContext(Dispatchers.Main) { refreshData(); isLoading = false; refreshTrigger++; Toast.makeText(context, "✓ $ok registrados en nube · ✗ $failed fallaron", Toast.LENGTH_LONG).show() }
            } catch (_: Exception) { withContext(Dispatchers.Main) { isLoading = false; Toast.makeText(context, "Error al registrar", Toast.LENGTH_SHORT).show() } }
        }
    }
    }

    val discardSecondChance: (SecondChanceRow) -> Unit = { sc ->
        scope.launch(Dispatchers.IO) {
            db.insertNotFound(sessionId, sc.csvProductId, sc.cantidadFaltante)
            db.removeSecondChance(sc.csvProductId)
            db.updateProductStatus(sc.csvProductId, sc.cantidadEncontrada, "rojo")
            withContext(Dispatchers.Main) { refreshData(); refreshTrigger++; Toast.makeText(context, "${sc.modeloGrupo} → No Existentes", Toast.LENGTH_SHORT).show() }
        }
    }

    val clearAllData: () -> Unit = {
        isLoading = true
        scope.launch(Dispatchers.IO) {
            db.clearSession(sessionId)
            val newId = UUID.randomUUID().toString()
            withContext(Dispatchers.Main) {
                sessionId = newId
                csvProducts = emptyList()
                secondChanceList = emptyList()
                pendingUploads = emptyList()
                notFoundList = emptyList()
                cloudLocations = emptyList()
                searchCompleted = false
                searchProgress = Pair(0, 0)
                searchPhase = ""
                isLoading = false
                refreshTrigger++
                Toast.makeText(context, "Todos los datos han sido eliminados", Toast.LENGTH_SHORT).show()
            }
        }
    }

    LaunchedEffect(sessionId, refreshTrigger) {
        refreshData()
        if (!searchCompleted && csvProducts.isNotEmpty()) {
            searchCompleted = db.hasSearchResults(sessionId)
        }
    }

    if (isLoading && searchProgress.first > 0) {
        Box(Modifier.fillMaxSize().background(Color(0xFFF8FAFC)), contentAlignment = Alignment.Center) {
            Card(Modifier.padding(32.dp).widthIn(max = 320.dp), shape = RoundedCornerShape(20.dp), colors = CardDefaults.cardColors(containerColor = Color.White), elevation = CardDefaults.cardElevation(8.dp)) {
                Column(Modifier.padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(16.dp)) {
                    CircularProgressIndicator(color = Color(0xFF7C3AED), modifier = Modifier.size(48.dp))
                    Text("Comparando con la nube", fontWeight = FontWeight.Black, fontSize = 16.sp, color = Color(0xFF0F172A))
                    Text(searchPhase, fontSize = 11.sp, color = Color.Gray)
                    val (current, total) = searchProgress
                    if (total > 0) {
                        LinearProgressIndicator(progress = { current.toFloat() / total }, modifier = Modifier.fillMaxWidth().height(8.dp).clip(RoundedCornerShape(4.dp)), color = Color(0xFF7C3AED), trackColor = Color(0xFFF1F5F9))
                        Text("$current de $total productos", fontWeight = FontWeight.Bold, fontSize = 12.sp, color = Color(0xFF0F172A))
                    }
                    Text("Esto puede tomar unos minutos", fontSize = 10.sp, color = Color.LightGray)
                }
            }
        }
    } else {
        Column(Modifier.fillMaxSize().padding(16.dp), Arrangement.spacedBy(12.dp)) {
            Card(Modifier.fillMaxWidth(), colors = CardDefaults.cardColors(containerColor = Color.White), shape = RoundedCornerShape(16.dp)) {
                Row(Modifier.padding(14.dp).fillMaxWidth(), Arrangement.SpaceEvenly, Alignment.CenterVertically) {
                    Column(horizontalAlignment = Alignment.CenterHorizontally) { Text("$totalSolicitado", fontWeight = FontWeight.Black, fontSize = 18.sp); Text("Solicitado", fontSize = 9.sp, color = Color.Gray) }
                    Column(horizontalAlignment = Alignment.CenterHorizontally) { Text("$totalEncontrado", fontWeight = FontWeight.Black, fontSize = 18.sp, color = Color(0xFF10B981)); Text("Encontrado", fontSize = 9.sp, color = Color.Gray) }
                    Column(horizontalAlignment = Alignment.CenterHorizontally) { Text("$totalFaltante", fontWeight = FontWeight.Black, fontSize = 18.sp, color = Color(0xFFEF4444)); Text("Faltante", fontSize = 9.sp, color = Color.Gray) }
                }
            }
            Row(Modifier.fillMaxWidth(), Arrangement.spacedBy(8.dp)) {
                Button(onClick = { filePickerLauncher.launch(arrayOf("text/csv", "text/comma-separated-values", "*/*")) }, modifier = Modifier.weight(1f), colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF0F172A)), shape = RoundedCornerShape(12.dp)) { Icon(Icons.Default.Upload, null, Modifier.size(16.dp)); Spacer(Modifier.width(6.dp)); Text("Cargar CSV", fontSize = 12.sp) }
                Button(onClick = { searchCloud() }, enabled = csvProducts.isNotEmpty() && !isLoading, modifier = Modifier.weight(1f), colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF7C3AED)), shape = RoundedCornerShape(12.dp)) {
                    if (isLoading) CircularProgressIndicator(Modifier.size(16.dp), color = Color.White, strokeWidth = 2.dp) else { Icon(Icons.Default.Cloud, null, Modifier.size(16.dp)); Spacer(Modifier.width(6.dp)); Text("Buscar en DB", fontSize = 12.sp) }
                }
            }
            if (csvProducts.isNotEmpty()) {
                OutlinedButton(onClick = clearAllData, modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(12.dp), colors = ButtonDefaults.outlinedButtonColors(contentColor = Color(0xFFEF4444))) {
                    Icon(Icons.Default.DeleteForever, null, Modifier.size(16.dp)); Spacer(Modifier.width(6.dp)); Text("Limpiar todos los datos", fontSize = 12.sp, fontWeight = FontWeight.Bold)
                }
            }

            if (csvProducts.isEmpty()) {
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { Column(horizontalAlignment = Alignment.CenterHorizontally) { Icon(Icons.Default.UploadFile, null, Modifier.size(64.dp), tint = Color.LightGray); Text("Carga un archivo CSV", fontWeight = FontWeight.Bold, color = Color.Gray, textAlign = TextAlign.Center) } }
            } else {
                Row(Modifier.padding(vertical = 4.dp).background(Color(0xFFE2E8F0), RoundedCornerShape(12.dp)).padding(2.dp)) {
                    listOf("dashboard" to "Dashboard", "results" to "Resultados", "segunda" to "2da Oport.", "cart" to "Carrito").forEach { (k, v) ->
                        val sel = activeSubTab == k; Box(Modifier.weight(1f).background(if (sel) Color.White else Color.Transparent, RoundedCornerShape(10.dp)).clickable { activeSubTab = k }.padding(vertical = 8.dp), contentAlignment = Alignment.Center) { Text(v, fontWeight = FontWeight.Bold, fontSize = 10.sp, color = if (sel) Color(0xFF0F172A) else Color.Gray, textAlign = TextAlign.Center) }
                    }
                }
                when (activeSubTab) {
                    "dashboard" -> DashboardTab(csvProducts)
                    "results" -> ResultsTab(csvProducts, cloudLocations, secondChanceList, searchCompleted, searchLog)
                    "cart" -> CartTab(csvProducts)
                    "segunda" -> SecondChanceTab(secondChanceList, pendingUploads, notFoundList, csvProducts, secondChanceSubTab, isScannerActive, isLoading, lifecycleOwner, { secondChanceSubTab = it }, { isScannerActive = it }, handleSecondChanceScan, registerPendingProducts, { isScannerActive = false }, lastScanResult, isScanProcessing, discardSecondChance, lastScannedCode, onSendToManifiesto)
                }
            }
        }
    }
}

@Composable
fun DashboardTab(products: List<CsvProductRow>) {
    Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState())) {
        Row(Modifier.fillMaxWidth().background(Color(0xFF0F172A)).padding(8.dp)) { listOf("Modelo", "Color", "Talla", "SKU", "Tipo", "Cant").forEach { Text(it, Modifier.weight(1f), fontSize = 9.sp, fontWeight = FontWeight.Black, color = Color.White, textAlign = TextAlign.Center, maxLines = 1) } }
        products.forEachIndexed { i, row ->
            val bgColor = when (row.estado) { "verde" -> Color(0xFFDCFCE7); "amarillo" -> Color(0xFFFEF3C7); else -> if (i % 2 == 0) Color.White else Color(0xFFF8FAFC) }
            Row(Modifier.fillMaxWidth().background(bgColor).padding(6.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(row.modeloGrupo.take(14), Modifier.weight(1f), fontSize = 9.sp, color = Color(0xFF1E293B), maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(row.codigoColor.take(6), Modifier.weight(1f), fontSize = 9.sp, color = Color(0xFF475569), textAlign = TextAlign.Center, maxLines = 1)
                Text(row.talla.take(6), Modifier.weight(1f), fontSize = 9.sp, color = Color(0xFF475569), textAlign = TextAlign.Center, maxLines = 1)
                Text(row.sku.take(14), Modifier.weight(1f), fontSize = 8.sp, color = Color(0xFF2563EB), textAlign = TextAlign.Center, maxLines = 1)
                Text(row.categoria.take(10), Modifier.weight(1f), fontSize = 8.sp, color = Color(0xFF475569), textAlign = TextAlign.Center, maxLines = 1)
                Text("${row.cantidadEncontrada}/${row.cantidadSolicitada}", Modifier.weight(1f), fontSize = 9.sp, fontWeight = FontWeight.Black, color = Color(0xFF0F172A), textAlign = TextAlign.Center)
            }
        }
    }
}

@Composable
fun ResultsTab(products: List<CsvProductRow>, cloudLocations: List<CloudLocationRow>, secondChance: List<SecondChanceRow>, searchCompleted: Boolean, searchLog: List<String>) {
    if (!searchCompleted || products.isEmpty()) {
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Icon(Icons.Default.Search, null, Modifier.size(48.dp), tint = Color.LightGray)
                Text("Presiona 'Buscar en DB' para encontrar productos", color = Color.Gray, fontSize = 12.sp, textAlign = TextAlign.Center)
            }
        }
        return
    }

    var showLog by remember { mutableStateOf(false) }
    val greenProducts = products.filter { it.estado == "verde" }
    val yellowProducts = products.filter { it.estado == "amarillo" }
    val redProducts = products.filter { it.estado == "rojo" }
    val groupedByProduct = cloudLocations.groupBy { it.csvProductId }

    Column(Modifier.fillMaxSize()) {
        Card(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp), colors = CardDefaults.cardColors(containerColor = Color.White), shape = RoundedCornerShape(12.dp)) {
            Row(Modifier.padding(12.dp).fillMaxWidth(), Arrangement.SpaceEvenly) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) { Text("${greenProducts.size + yellowProducts.size}", fontWeight = FontWeight.Black, fontSize = 18.sp, color = Color(0xFF10B981)); Text("Encontrados", fontSize = 9.sp, color = Color.Gray) }
                Column(horizontalAlignment = Alignment.CenterHorizontally) { Text("${cloudLocations.size}", fontWeight = FontWeight.Black, fontSize = 18.sp, color = Color(0xFF2563EB)); Text("Ubicaciones", fontSize = 9.sp, color = Color.Gray) }
                Column(horizontalAlignment = Alignment.CenterHorizontally) { Text("${cloudLocations.sumOf { it.cantidadEnUbicacion }}", fontWeight = FontWeight.Black, fontSize = 18.sp, color = Color(0xFF7C3AED)); Text("Unidades", fontSize = 9.sp, color = Color.Gray) }
                Column(horizontalAlignment = Alignment.CenterHorizontally) { Text("${redProducts.size}", fontWeight = FontWeight.Black, fontSize = 18.sp, color = Color(0xFFEF4444)); Text("Sin reg.", fontSize = 9.sp, color = Color.Gray) }
            }
        }

        if (searchLog.isNotEmpty()) {
            Card(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp).clickable { showLog = !showLog }, colors = CardDefaults.cardColors(containerColor = Color(0xFFF8FAFC)), shape = RoundedCornerShape(8.dp)) {
                Row(Modifier.padding(8.dp).fillMaxWidth(), Arrangement.SpaceBetween, Alignment.CenterVertically) {
                    Text("Diagnóstico (${searchLog.size})", fontSize = 10.sp, fontWeight = FontWeight.Bold, color = Color(0xFF475569))
                    Icon(if (showLog) Icons.Default.ExpandLess else Icons.Default.ExpandMore, null, Modifier.size(16.dp), tint = Color.Gray)
                }
                if (showLog) {
                    Column(Modifier.fillMaxWidth().heightIn(max = 150.dp).verticalScroll(rememberScrollState()).padding(horizontal = 8.dp, vertical = 4.dp)) {
                        for (entry in searchLog.takeLast(50)) {
                            val isFound = entry.contains("✓")
                            Text(entry, fontSize = 8.sp, fontFamily = androidx.compose.ui.text.font.FontFamily.Monospace, color = if (isFound) Color(0xFF10B981) else Color(0xFFEF4444), maxLines = 1, overflow = TextOverflow.Ellipsis)
                        }
                    }
                }
            }
        }

        Row(Modifier.fillMaxWidth().background(Color(0xFF0F172A)).padding(8.dp)) {
            listOf("Modelo", "Talla", "Almacén", "Caja", "Cant").forEach {
                Text(it, Modifier.weight(1f), fontSize = 9.sp, fontWeight = FontWeight.Black, color = Color.White, textAlign = TextAlign.Center)
            }
        }

        Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState())) {
            val allFound = greenProducts + yellowProducts
            for (product in allFound) {
                val locations = groupedByProduct[product.id] ?: emptyList()
                if (locations.isNotEmpty()) {
                    for (loc in locations) {
                        Row(Modifier.fillMaxWidth().background(Color(0xFFDCFCE7)).padding(6.dp), verticalAlignment = Alignment.CenterVertically) {
                            Text(product.modeloGrupo.take(14), Modifier.weight(1f), fontSize = 9.sp, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            Text(product.talla.take(6), Modifier.weight(1f), fontSize = 9.sp, textAlign = TextAlign.Center)
                            Text(loc.almacenNombre?.take(12) ?: "-", Modifier.weight(1f), fontSize = 8.sp, color = Color(0xFF475569), textAlign = TextAlign.Center, maxLines = 1)
                            Text(loc.cajaNombre ?: "-", Modifier.weight(1f), fontSize = 8.sp, fontWeight = FontWeight.Bold, color = Color(0xFF2563EB), textAlign = TextAlign.Center)
                            Text("${loc.cantidadEnUbicacion}", Modifier.weight(1f), fontSize = 9.sp, fontWeight = FontWeight.Black, textAlign = TextAlign.Center)
                        }
                    }
                } else {
                    Row(Modifier.fillMaxWidth().background(Color(0xFFFEF3C7)).padding(6.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text(product.modeloGrupo.take(14), Modifier.weight(1f), fontSize = 9.sp, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        Text(product.talla.take(6), Modifier.weight(1f), fontSize = 9.sp, textAlign = TextAlign.Center)
                        Text("-", Modifier.weight(1f), fontSize = 8.sp, color = Color.Gray, textAlign = TextAlign.Center)
                        Text("-", Modifier.weight(1f), fontSize = 8.sp, color = Color.Gray, textAlign = TextAlign.Center)
                        Text("${product.cantidadEncontrada}/${product.cantidadSolicitada}", Modifier.weight(1f), fontSize = 9.sp, fontWeight = FontWeight.Black, textAlign = TextAlign.Center, color = Color(0xFFD97706))
                    }
                }
            }

            if (redProducts.isNotEmpty()) {
                Row(Modifier.fillMaxWidth().padding(top = 8.dp, bottom = 4.dp, start = 16.dp)) {
                    Text("Sin registro (${redProducts.size})", fontSize = 10.sp, fontWeight = FontWeight.Black, color = Color(0xFFEF4444))
                }
                for (product in redProducts.take(100)) {
                    Row(Modifier.fillMaxWidth().background(Color(0xFFFEE2E2)).padding(6.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text(product.modeloGrupo.take(14), Modifier.weight(1f), fontSize = 9.sp, fontWeight = FontWeight.Bold, color = Color(0xFF991B1B), maxLines = 1, overflow = TextOverflow.Ellipsis)
                        Text(product.talla.take(6), Modifier.weight(1f), fontSize = 9.sp, textAlign = TextAlign.Center, color = Color(0xFF991B1B))
                        Text(product.sku.take(12), Modifier.weight(1f), fontSize = 8.sp, textAlign = TextAlign.Center, color = Color(0xFF991B1B))
                        Text("-", Modifier.weight(1f), fontSize = 8.sp, color = Color(0xFF991B1B), textAlign = TextAlign.Center)
                        Text("${product.cantidadSolicitada}", Modifier.weight(1f), fontSize = 9.sp, fontWeight = FontWeight.Black, textAlign = TextAlign.Center, color = Color(0xFF991B1B))
                    }
                }
                if (redProducts.size > 100) {
                    Text("... y ${redProducts.size - 100} más", fontSize = 9.sp, color = Color.Gray, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth().padding(8.dp))
                }
            }
        }
    }
}

@Composable
fun CartTab(products: List<CsvProductRow>) {
    val confirmed = products.filter { it.estado == "verde" }
    if (confirmed.isEmpty()) { Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { Text("No hay productos confirmados aún", color = Color.Gray, fontSize = 12.sp) } }
    else {
        Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState())) {
            Card(Modifier.fillMaxWidth().padding(bottom = 8.dp), colors = CardDefaults.cardColors(containerColor = Color(0xFFF0FDF4)), shape = RoundedCornerShape(12.dp)) { Row(Modifier.padding(12.dp).fillMaxWidth(), Arrangement.SpaceBetween) { Text("Productos listos para transferencia", fontWeight = FontWeight.Black, fontSize = 13.sp); Text("${confirmed.size} items · ${confirmed.sumOf { it.cantidadEncontrada }} uds", fontWeight = FontWeight.Bold, fontSize = 11.sp, color = Color(0xFF10B981)) } }
            confirmed.forEach { row ->
                Card(Modifier.fillMaxWidth().padding(vertical = 2.dp), colors = CardDefaults.cardColors(containerColor = Color.White), shape = RoundedCornerShape(8.dp)) {
                    Row(Modifier.padding(8.dp).fillMaxWidth(), Arrangement.SpaceBetween, Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) { Text(row.modeloGrupo, fontWeight = FontWeight.Black, fontSize = 11.sp); Text("T:${row.talla} · SKU:${row.sku}", fontSize = 9.sp, color = Color.Gray) }
                        Surface(color = Color(0xFFDCFCE7), shape = RoundedCornerShape(4.dp)) { Text("✓ ${row.cantidadEncontrada}/${row.cantidadSolicitada}", Modifier.padding(horizontal = 6.dp, vertical = 2.dp), fontSize = 10.sp, fontWeight = FontWeight.Bold, color = Color(0xFF10B981)) }
                    }
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SecondChanceTab(
    secondChance: List<SecondChanceRow>, pendingUploads: List<PendingUploadRow>, notFound: List<NotFoundRow>,
    products: List<CsvProductRow>, subTab: String, isScannerActive: Boolean, isLoading: Boolean,
    lifecycleOwner: androidx.lifecycle.LifecycleOwner,
    onSubTabChange: (String) -> Unit, onScannerToggle: (Boolean) -> Unit,
    onBarcodeScanned: (String) -> Unit, onRegisterPending: () -> Unit, onCloseScanner: () -> Unit,
    lastScanResult: String = "", isScanProcessing: Boolean = false,
    onDiscard: (SecondChanceRow) -> Unit = {},
    lastScannedCode: String = "", onSendToManifiesto: ((String) -> Unit)? = null
) {
    Column(Modifier.fillMaxWidth(), Arrangement.spacedBy(8.dp)) {
        Row(Modifier.background(Color(0xFFF1F5F9), RoundedCornerShape(8.dp)).padding(2.dp)) {
            listOf("list" to "Pendientes (${secondChance.size})", "scan" to "Escáner", "upload" to "Alta Nube (${pendingUploads.size})", "missing" to "No Existentes (${notFound.size})").forEach { (k, v) ->
                val sel = subTab == k; Box(Modifier.weight(1f).background(if (sel) Color.White else Color.Transparent, RoundedCornerShape(6.dp)).clickable { onSubTabChange(k) }.padding(vertical = 6.dp), contentAlignment = Alignment.Center) { Text(v, fontWeight = FontWeight.Bold, fontSize = 9.sp, color = if (sel) Color(0xFF0F172A) else Color.Gray, textAlign = TextAlign.Center) }
            }
        }
        when (subTab) {
            "scan" -> {
                val context = LocalContext.current
                var hasCamPerm by remember { mutableStateOf(ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) }
                val camPermLauncher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { hasCamPerm = it }
                if (isScannerActive && hasCamPerm) {
                Box(Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).border(2.dp, Color(0xFFF59E0B), RoundedCornerShape(12.dp))) {
                    AndroidView(factory = { ctx ->
                        val pv = PreviewView(ctx).apply { scaleType = PreviewView.ScaleType.FILL_CENTER }
                        var captured = false
                        ProcessCameraProvider.getInstance(ctx).addListener({
                            val cp = ProcessCameraProvider.getInstance(ctx).get()
                            val preview = Preview.Builder().build().also { it.setSurfaceProvider(pv.surfaceProvider) }
                            val barcodeScanner = BarcodeScanning.getClient(BarcodeScannerOptions.Builder().setBarcodeFormats(Barcode.FORMAT_ALL_FORMATS).build())
                            val ia = ImageAnalysis.Builder().setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST).build()
                            ia.setAnalyzer(ContextCompat.getMainExecutor(ctx)) { ip -> ip.image?.let { img -> barcodeScanner.process(InputImage.fromMediaImage(img, ip.imageInfo.rotationDegrees)).addOnSuccessListener { bcs -> if (!captured) { val raw = bcs.firstOrNull()?.rawValue; if (raw != null) { captured = true; onScannerToggle(false); onBarcodeScanned(raw) } } }.addOnCompleteListener { ip.close() } } ?: ip.close() }
                            try { cp.unbindAll(); cp.bindToLifecycle(lifecycleOwner, CameraSelector.Builder().requireLensFacing(CameraSelector.LENS_FACING_BACK).build(), preview, ia) } catch (_: Exception) {}
                        }, ContextCompat.getMainExecutor(ctx))
                        pv
                    }, Modifier.fillMaxSize())
                    Box(Modifier.fillMaxSize().padding(24.dp)) { Box(Modifier.size(40.dp).align(Alignment.TopStart).border(3.dp, Color(0xFFF59E0B), RoundedCornerShape(topStart = 8.dp))); Box(Modifier.size(40.dp).align(Alignment.TopEnd).border(3.dp, Color(0xFFF59E0B), RoundedCornerShape(topEnd = 8.dp))); Box(Modifier.size(40.dp).align(Alignment.BottomStart).border(3.dp, Color(0xFFF59E0B), RoundedCornerShape(bottomStart = 8.dp))); Box(Modifier.size(40.dp).align(Alignment.BottomEnd).border(3.dp, Color(0xFFF59E0B), RoundedCornerShape(bottomEnd = 8.dp))) }
                    IconButton(onClick = onCloseScanner, modifier = Modifier.align(Alignment.TopEnd).padding(8.dp).size(36.dp).background(Color.Black.copy(alpha = 0.5f), RoundedCornerShape(8.dp))) { Icon(Icons.Default.Close, null, tint = Color.White, modifier = Modifier.size(18.dp)) }
                    Text("Centra el código en el marco", color = Color.White.copy(alpha = 0.8f), fontSize = 11.sp, fontWeight = FontWeight.Bold, modifier = Modifier.align(Alignment.BottomCenter).padding(bottom = 12.dp).background(Color.Black.copy(alpha = 0.5f), RoundedCornerShape(6.dp)).padding(horizontal = 8.dp, vertical = 4.dp))
                }
            } else { Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(10.dp)) { Icon(Icons.Default.QrCodeScanner, null, Modifier.size(64.dp), tint = Color.LightGray); Text("Escanear productos pendientes", fontSize = 12.sp, color = Color.Gray); if (isScanProcessing) { CircularProgressIndicator(Modifier.size(28.dp), color = Color(0xFFF59E0B), strokeWidth = 3.dp) }; if (lastScanResult.isNotBlank()) { Card(colors = CardDefaults.cardColors(containerColor = Color(0xFFFEF3C7)), shape = RoundedCornerShape(8.dp)) { Text(lastScanResult, Modifier.padding(10.dp), fontSize = 11.sp, fontWeight = FontWeight.Bold, color = Color(0xFF0F172A), textAlign = TextAlign.Center) } }; if (onSendToManifiesto != null && lastScannedCode.isNotBlank() && (lastScanResult.contains("No Existentes") || lastScanResult.contains("no está en pendientes") || lastScanResult.contains("no existe"))) { OutlinedButton(onClick = { onSendToManifiesto(lastScannedCode) }, shape = RoundedCornerShape(12.dp), colors = ButtonDefaults.outlinedButtonColors(contentColor = Color(0xFF7C3AED))) { Icon(Icons.Default.DocumentScanner, null, Modifier.size(16.dp)); Spacer(Modifier.width(6.dp)); Text("OCR → Manifiesto", fontWeight = FontWeight.Bold, fontSize = 11.sp) } }; Button(onClick = { if (hasCamPerm) onScannerToggle(true) else camPermLauncher.launch(Manifest.permission.CAMERA) }, colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF0F172A)), shape = RoundedCornerShape(12.dp)) { Icon(Icons.Default.CameraAlt, null, Modifier.size(16.dp)); Spacer(Modifier.width(6.dp)); Text("Activar Escáner", fontWeight = FontWeight.Bold) } } } }
            }

            "upload" -> {
                if (pendingUploads.isEmpty()) Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { Text("No hay productos para dar de alta", color = Color.Gray, fontSize = 12.sp) }
                else { Button(onClick = onRegisterPending, enabled = !isLoading, colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF10B981)), shape = RoundedCornerShape(12.dp), modifier = Modifier.fillMaxWidth()) { if (isLoading) CircularProgressIndicator(Modifier.size(16.dp), color = Color.White, strokeWidth = 2.dp) else { Icon(Icons.Default.CloudUpload, null, Modifier.size(16.dp)); Spacer(Modifier.width(6.dp)); Text("Registrar ${pendingUploads.size} productos", fontWeight = FontWeight.Bold, fontSize = 12.sp) } }; Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState())) { pendingUploads.forEach { pu -> Card(Modifier.fillMaxWidth().padding(vertical = 2.dp), colors = CardDefaults.cardColors(containerColor = Color(0xFFFEF3C7)), shape = RoundedCornerShape(8.dp)) { Column(Modifier.padding(8.dp)) { Text(pu.modeloGrupo, fontWeight = FontWeight.Bold, fontSize = 11.sp); Text("SKU: ${pu.sku} | UPC: ${pu.scannedBarcode}", fontSize = 9.sp, color = Color.Gray) } } } } }
            }

            "missing" -> if (notFound.isEmpty()) Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { Text("No hay productos no existentes", color = Color.Gray, fontSize = 12.sp) } else Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState())) { notFound.forEach { nf -> Card(Modifier.fillMaxWidth().padding(vertical = 2.dp), colors = CardDefaults.cardColors(containerColor = Color(0xFFFEE2E2)), shape = RoundedCornerShape(8.dp)) { Column(Modifier.padding(8.dp)) { Text(nf.modeloGrupo, fontWeight = FontWeight.Bold, fontSize = 11.sp); Text("SKU: ${nf.sku} | Faltan: ${nf.cantidadFaltante}", fontSize = 9.sp, color = Color.Gray) } } } }

            else -> if (secondChance.isEmpty()) Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { Text("No hay productos en segunda oportunidad", color = Color.Gray, fontSize = 12.sp) } else Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState())) { secondChance.forEach { sc -> val motivoLabel = when (sc.motivo) { "sin_registro" -> "Sin registro"; "sin_stock" -> "Sin stock"; "parcial" -> "Parcial (${sc.cantidadEncontrada}/${sc.cantidadSolicitada})"; else -> sc.motivo }; Card(Modifier.fillMaxWidth().padding(vertical = 2.dp), colors = CardDefaults.cardColors(containerColor = Color.White), shape = RoundedCornerShape(8.dp)) { Row(Modifier.padding(8.dp).fillMaxWidth(), Arrangement.SpaceBetween, Alignment.CenterVertically) { Column(Modifier.weight(1f)) { Text(sc.modeloGrupo, fontWeight = FontWeight.Black, fontSize = 11.sp); Text("${sc.sku} · T:${sc.talla} · Faltan: ${sc.cantidadFaltante}", fontSize = 9.sp, color = Color.Gray) }; Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(4.dp)) { Surface(color = Color(0xFFFEF3C7), shape = RoundedCornerShape(4.dp)) { Text(motivoLabel, Modifier.padding(horizontal = 6.dp, vertical = 2.dp), fontSize = 9.sp, fontWeight = FontWeight.Bold, color = Color(0xFFD97706)) }; TextButton(onClick = { onDiscard(sc) }) { Text("Descartar", fontSize = 9.sp, fontWeight = FontWeight.Bold, color = Color(0xFFEF4444)) } } } } } }
        }
    }
}
