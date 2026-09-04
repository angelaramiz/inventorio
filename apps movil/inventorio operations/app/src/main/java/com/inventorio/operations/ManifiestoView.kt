package com.inventorio.operations

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.net.Uri
import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import com.google.mlkit.vision.barcode.BarcodeScanning
import com.google.mlkit.vision.common.InputImage
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.ByteArrayOutputStream
import java.io.File
import kotlin.coroutines.resume

private const val PREFS_MANIFIESTO = "manifiesto_prefs"
private const val KEY_CATEGORIAS = "categorias_cache"
private val CATEGORIAS_FALLBACK = listOf("pantalon", "accesorio", "camisa", "calzado", "chaqueta", "otro")

/**
 * Normaliza categoría para comparar sin importar acentos/mayúsculas.
 * Riesgo conocido (QA): si la central trae "joyería" y el fallback "joyeria",
 * son vocabularios distintos. Esta función evita duplicados visuales y mejora
 * la sugerencia automática, pero los ítems guardados conservan su string exacto.
 */
fun normCat(s: String): String =
    java.text.Normalizer.normalize(s.lowercase(), java.text.Normalizer.Form.NFD)
        .replace("\\p{Mn}+".toRegex(), "")

/** Modelo compuesto obligatorio: base + "-" + color (solo base si no hay color). */
fun composeModelo(base: String, color: String): String {
    val b = base.trim().uppercase()
    val c = color.trim().uppercase()
    if (b.isBlank()) return ""
    return if (c.isBlank()) b else "$b-$c"
}

fun csvCell(v: String): String = "\"" + v.replace("\"", "\"\"") + "\""

/** Recorte central al 70%: descarta fondo/monitor antes del OCR. */
fun cropCenter70(bmp: Bitmap): Bitmap {
    val w = (bmp.width * 0.7f).toInt().coerceAtLeast(1)
    val h = (bmp.height * 0.7f).toInt().coerceAtLeast(1)
    val x = ((bmp.width - w) / 2).coerceAtLeast(0)
    val y = ((bmp.height - h) / 2).coerceAtLeast(0)
    return Bitmap.createBitmap(bmp, x, y, w, h)
}

/** Lee EAN/código de barras con ML Kit BarcodeScanning (el OCR de texto no lee barras). */
suspend fun scanBarcodeEan(bmp: Bitmap): String? = suspendCancellableCoroutine { cont ->
    try {
        BarcodeScanning.getClient().process(InputImage.fromBitmap(bmp, 0))
            .addOnSuccessListener { barcodes ->
                val ean = barcodes.firstOrNull()?.rawValue?.filter { it.isDigit() }?.takeIf { it.length in 8..14 }
                cont.resume(ean)
            }
            .addOnFailureListener { cont.resume(null) }
    } catch (_: Exception) { cont.resume(null) }
}

/** JPEG q60, máx 1200px, para training (liviano para el POST). */
fun bitmapToBase64q60(bmp: Bitmap): String {
    val maxDim = 1200
    val scale = minOf(1f, maxDim / maxOf(bmp.width, bmp.height).toFloat())
    val small = if (scale < 1f) {
        Bitmap.createScaledBitmap(bmp, (bmp.width * scale).toInt(), (bmp.height * scale).toInt(), true)
    } else bmp
    val out = ByteArrayOutputStream()
    small.compress(Bitmap.CompressFormat.JPEG, 60, out)
    if (small !== bmp) small.recycle()
    return android.util.Base64.encodeToString(out.toByteArray(), android.util.Base64.NO_WRAP)
}

/** Vibración + beep al capturar (feedback de piso). */
fun feedbackCaptura(context: Context) {
    try {
        val vib = if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.S) {
            (context.getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as android.os.VibratorManager).defaultVibrator
        } else {
            @Suppress("DEPRECATION") context.getSystemService(Context.VIBRATOR_SERVICE) as android.os.Vibrator
        }
        if (vib.hasVibrator()) vib.vibrate(android.os.VibrationEffect.createOneShot(80, android.os.VibrationEffect.DEFAULT_AMPLITUDE))
    } catch (_: Exception) {}
    try {
        val tone = android.media.ToneGenerator(android.media.AudioManager.STREAM_NOTIFICATION, 80)
        tone.startTone(android.media.ToneGenerator.TONE_PROP_BEEP)
        tone.release()
    } catch (_: Exception) {}
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ManifiestoView(
    client: OkHttpClient,
    serverUrl: String,
    barcodeInicial: String? = null,
    onBarcodeConsumed: () -> Unit = {}
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val db = remember { OperationsDbHelper(context) }

    var manifiestos by remember { mutableStateOf<List<ManifiestoRow>>(emptyList()) }
    var selectedId by remember { mutableStateOf<Long?>(null) }
    var subTab by remember { mutableStateOf("ocr") }
    var items by remember { mutableStateOf<List<ManifiestoItemRow>>(emptyList()) }
    var categorias by remember { mutableStateOf<List<String>>(emptyList()) }
    var showCreate by remember { mutableStateOf(false) }
    var refreshTick by remember { mutableStateOf(0) }

    val refresh: () -> Unit = {
        manifiestos = db.getManifiestos()
        if (selectedId == null) selectedId = manifiestos.firstOrNull()?.id
        if (selectedId != null && manifiestos.none { it.id == selectedId }) {
            selectedId = manifiestos.firstOrNull()?.id
        }
        items = if (selectedId != null) db.getManifiestoItems(selectedId!!) else emptyList()
        refreshTick++
    }

    // Categorías fijas desde DB central (cache offline en SharedPreferences)
    val loadCategorias: () -> Unit = {
        scope.launch(Dispatchers.IO) {
            val prefs = context.getSharedPreferences(PREFS_MANIFIESTO, Context.MODE_PRIVATE)
            var loaded: List<String>? = null
            try {
                val req = Request.Builder().url("${serverUrl.trimEnd('/')}/api/conceptos/tipos").build()
                client.newCall(req).execute().use { res ->
                    if (res.isSuccessful) {
                        val arr = org.json.JSONArray(res.body?.string() ?: "[]")
                        val names = mutableListOf<String>()
                        for (i in 0 until arr.length()) {
                            arr.optJSONObject(i)?.optString("nombre")?.trim()?.takeIf { it.isNotBlank() }?.let { names.add(it) }
                        }
                        if (names.isNotEmpty()) {
                            loaded = names
                            prefs.edit().putString(KEY_CATEGORIAS, names.joinToString("|")).apply()
                        }
                    }
                }
            } catch (_: Exception) {}
            if (loaded == null) {
                val cached = prefs.getString(KEY_CATEGORIAS, null)
                loaded = if (!cached.isNullOrBlank()) cached.split("|").filter { it.isNotBlank() } else CATEGORIAS_FALLBACK
            }
            withContext(Dispatchers.Main) { categorias = loaded!! }
        }
    }

    LaunchedEffect(Unit) { refresh(); loadCategorias() }
    LaunchedEffect(refreshTick) { }

    // Barcode enviado desde el escáner CSV → pre-rellena y abre Manual
    LaunchedEffect(barcodeInicial) {
        if (barcodeInicial != null) {
            subTab = "manual"
            onBarcodeConsumed()
        }
    }

    val selected = manifiestos.firstOrNull { it.id == selectedId }

    Column(Modifier.fillMaxSize().padding(16.dp), Arrangement.spacedBy(12.dp)) {
        // Selector de manifiesto + crear
        Card(Modifier.fillMaxWidth(), colors = CardDefaults.cardColors(containerColor = Color.White), shape = RoundedCornerShape(16.dp)) {
            Column(Modifier.padding(14.dp), Arrangement.spacedBy(8.dp)) {
                Row(Modifier.fillMaxWidth(), Arrangement.SpaceBetween, Alignment.CenterVertically) {
                    Text("Manifiesto", fontWeight = FontWeight.Black, fontSize = 15.sp, color = Color(0xFF0F172A))
                    TextButton(onClick = { showCreate = true }) { Text("+ Nuevo", fontWeight = FontWeight.Bold, fontSize = 12.sp) }
                }
                if (manifiestos.isEmpty()) {
                    Text("Sin manifiestos — crea uno para empezar (ej. Joyería-Test)", fontSize = 11.sp, color = Color.Gray)
                } else {
                    var expanded by remember { mutableStateOf(false) }
                    ExposedDropdownMenuBox(expanded = expanded, onExpandedChange = { expanded = !expanded }) {
                        OutlinedTextField(
                            value = selected?.nombre ?: "", onValueChange = {},
                            readOnly = true, label = { Text("Activo", fontSize = 10.sp) },
                            trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded) },
                            modifier = Modifier.fillMaxWidth().menuAnchor(), singleLine = true
                        )
                        ExposedDropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
                            manifiestos.forEach { m ->
                                DropdownMenuItem(
                                    text = { Text("${m.nombre} (${db.countManifiestoItems(m.id)})", fontSize = 12.sp) },
                                    onClick = { selectedId = m.id; expanded = false; refresh() }
                                )
                            }
                        }
                    }
                }
            }
        }

        if (showCreate) {
            ManifiestoCreateDialog(
                categorias = categorias.ifEmpty { CATEGORIAS_FALLBACK },
                onDismiss = { showCreate = false },
                onCreate = { nombre, categoria ->
                    val id = db.createManifiesto(nombre, categoria)
                    showCreate = false
                    selectedId = id
                    refresh()
                    Toast.makeText(context, "Manifiesto creado", Toast.LENGTH_SHORT).show()
                }
            )
        }

        if (selected == null) {
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                Text("Crea un manifiesto para registrar ítems", color = Color.Gray, fontSize = 12.sp, textAlign = TextAlign.Center)
            }
            return@Column
        }

        // Sub-tabs
        Row(Modifier.fillMaxWidth().background(Color(0xFFE2E8F0), RoundedCornerShape(12.dp)).padding(2.dp)) {
            listOf("ocr" to "OCR", "manual" to "Manual", "lista" to "Lista (${items.size})", "exportar" to "Exportar").forEach { (k, v) ->
                val sel = subTab == k
                Box(
                    Modifier.weight(1f).background(if (sel) Color.White else Color.Transparent, RoundedCornerShape(10.dp))
                        .clickable { subTab = k }.padding(vertical = 8.dp),
                    contentAlignment = Alignment.Center
                ) { Text(v, fontWeight = FontWeight.Bold, fontSize = 10.sp, color = if (sel) Color(0xFF0F172A) else Color.Gray, textAlign = TextAlign.Center) }
            }
        }

        when (subTab) {
            "ocr" -> ManifiestoOcrTab(
                manifiestoId = selected.id,
                barcodeSugerido = barcodeInicial,
                db = db,
                client = client,
                serverUrl = serverUrl,
                categorias = categorias.ifEmpty { CATEGORIAS_FALLBACK },
                onSaved = { refresh() }
            )
            "manual" -> ManifiestoManualTab(
                manifiestoId = selected.id,
                barcodeInicial = barcodeInicial,
                db = db,
                categorias = categorias.ifEmpty { CATEGORIAS_FALLBACK },
                onSaved = { refresh() }
            )
            "lista" -> ManifiestoListaTab(
                items = items,
                db = db,
                categorias = categorias.ifEmpty { CATEGORIAS_FALLBACK },
                onChanged = { refresh() }
            )
            "exportar" -> ManifiestoExportTab(
                manifiesto = selected,
                items = items,
                onCerrar = { db.setManifiestoEstado(selected.id, "cerrado"); refresh() },
                onEliminar = { db.deleteManifiesto(selected.id); selectedId = null; refresh() }
            )
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ManifiestoCreateDialog(categorias: List<String>, onDismiss: () -> Unit, onCreate: (String, String) -> Unit) {
    var nombre by remember { mutableStateOf("") }
    var categoria by remember { mutableStateOf(categorias.firstOrNull() ?: "otro") }
    var expanded by remember { mutableStateOf(false) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Nuevo manifiesto", fontWeight = FontWeight.Bold) },
        text = {
            Column(Modifier.fillMaxWidth(), Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(value = nombre, onValueChange = { nombre = it }, label = { Text("Nombre (ej. Joyería-Test)") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                ExposedDropdownMenuBox(expanded = expanded, onExpandedChange = { expanded = !expanded }) {
                    OutlinedTextField(value = categoria, onValueChange = {}, readOnly = true, label = { Text("Categoría") },
                        trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded) },
                        modifier = Modifier.fillMaxWidth().menuAnchor(), singleLine = true)
                    ExposedDropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
                        categorias.forEach { c -> DropdownMenuItem(text = { Text(c) }, onClick = { categoria = c; expanded = false }) }
                    }
                }
            }
        },
        confirmButton = {
            Button(onClick = { if (nombre.isNotBlank()) onCreate(nombre, categoria) },
                colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF0F172A))) { Text("Crear") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancelar") } }
    )
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ManifiestoOcrTab(
    manifiestoId: Long,
    barcodeSugerido: String?,
    db: OperationsDbHelper,
    client: OkHttpClient,
    serverUrl: String,
    categorias: List<String>,
    onSaved: () -> Unit
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var hasCamPerm by remember { mutableStateOf(ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) }
    val camPermLauncher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { hasCamPerm = it }

    var photoFile by remember { mutableStateOf<File?>(null) }
    var isProcessing by remember { mutableStateOf(false) }
    var propuesta by remember { mutableStateOf<OcrPropuesta?>(null) }
    var lastBarcode by remember { mutableStateOf(barcodeSugerido ?: "") }
    // Bitmaps para training (se reciclan al guardar/descartar)
    var trainCrop by remember { mutableStateOf<Bitmap?>(null) }
    var trainPreB64 by remember { mutableStateOf<String?>(null) }

    val takePictureLauncher = rememberLauncherForActivityResult(ActivityResultContracts.TakePicture()) { success ->
        val file = photoFile
        if (success && file != null && file.exists()) {
            feedbackCaptura(context)
            isProcessing = true
            scope.launch(Dispatchers.IO) {
                try {
                    val uri = FileProvider.getUriForFile(context, "com.inventorio.operations.fileprovider", file)
                    val full: Bitmap? = if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.P) {
                        android.graphics.ImageDecoder.decodeBitmap(android.graphics.ImageDecoder.createSource(context.contentResolver, uri))
                    } else {
                        @Suppress("DEPRECATION")
                        android.provider.MediaStore.Images.Media.getBitmap(context.contentResolver, uri)
                    }
                    if (full == null) {
                        withContext(Dispatchers.Main) {
                            isProcessing = false
                            Toast.makeText(context, "No se pudo decodificar la foto", Toast.LENGTH_LONG).show()
                        }
                        return@launch
                    }
                    // Encuadre: crop central 70% ANTES del OCR (descarta monitor/fondo)
                    val crop = cropCenter70(full)
                    try { full.recycle() } catch (_: Exception) {}

                    // Doble motor en paralelo: barcode EAN + texto (orig+preproc) + pre para training
                    val eanDeferred = async { scanBarcodeEan(crop) }
                    val preDeferred = async {
                        try { ImagePreprocessor.preprocessLight(crop).bitmap } catch (_: Exception) { null }
                    }
                    val prop = ManifiestoOcrEngine.analyze(crop, barcode = lastBarcode.ifBlank { null })
                    val ean = eanDeferred.await()
                    val preBmp = preDeferred.await()
                    val cropB64 = bitmapToBase64q60(crop)
                    val preB64 = preBmp?.let { bitmapToBase64q60(it) }
                    try { preBmp?.recycle() } catch (_: Exception) {}

                    withContext(Dispatchers.Main) {
                        isProcessing = false
                        trainCrop?.recycle()
                        trainCrop = crop
                        trainPreB64 = preB64
                        if (!ean.isNullOrBlank()) lastBarcode = ean
                        propuesta = prop
                        if (!prop.hasAnyData) {
                            Toast.makeText(context, "ML Kit no extrajo datos — captúralos manualmente", Toast.LENGTH_LONG).show()
                        }
                    }
                } catch (e: Exception) {
                    withContext(Dispatchers.Main) {
                        isProcessing = false
                        Toast.makeText(context, "Error OCR: ${e.message}", Toast.LENGTH_LONG).show()
                    }
                }
            }
        }
    }

    LaunchedEffect(barcodeSugerido) { if (barcodeSugerido != null) lastBarcode = barcodeSugerido }

    Column(Modifier.fillMaxWidth(), Arrangement.spacedBy(10.dp)) {
        if (!lastBarcode.isBlank()) {
            Card(colors = CardDefaults.cardColors(containerColor = Color(0xFFEFF6FF)), shape = RoundedCornerShape(8.dp)) {
                Text("Barcode vinculado: $lastBarcode", Modifier.padding(10.dp), fontSize = 11.sp, fontWeight = FontWeight.Bold, color = Color(0xFF1D4ED8))
            }
        }
        // Guía de encuadre: el OCR analiza el 70% central (marco)
        Card(colors = CardDefaults.cardColors(containerColor = Color(0xFFFFFBEB)), shape = RoundedCornerShape(12.dp)) {
            Row(Modifier.padding(12.dp).fillMaxWidth(), Arrangement.spacedBy(10.dp), Alignment.CenterVertically) {
                Box(
                    Modifier.size(56.dp).background(Color.Transparent, RoundedCornerShape(6.dp))
                        .border(3.dp, Color(0xFFF59E0B), RoundedCornerShape(6.dp)),
                    contentAlignment = Alignment.Center
                ) { Text("70%", fontSize = 10.sp, fontWeight = FontWeight.Black, color = Color(0xFFB45309)) }
                Text(
                    "Encuadra SOLO la etiqueta dentro del marco. Evita monitores, cajas y manos detrás. Si sale torcida o con brillo, enderézala y repite.",
                    fontSize = 10.sp, color = Color(0xFF92400E), modifier = Modifier.weight(1f)
                )
            }
        }
        Button(
            onClick = {
                if (!hasCamPerm) { camPermLauncher.launch(Manifest.permission.CAMERA); return@Button }
                val dir = File(File(context.filesDir, "manifiestos"), manifiestoId.toString()).apply { mkdirs() }
                val file = File(dir, "IMG_${System.currentTimeMillis()}.jpg")
                photoFile = file
                takePictureLauncher.launch(FileProvider.getUriForFile(context, "com.inventorio.operations.fileprovider", file))
            },
            modifier = Modifier.fillMaxWidth(),
            colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF0F172A)),
            shape = RoundedCornerShape(12.dp)
        ) {
            Icon(Icons.Default.CameraAlt, null, Modifier.size(16.dp)); Spacer(Modifier.width(6.dp)); Text("Fotografiar etiqueta")
        }
        if (isProcessing) {
            Row(Modifier.fillMaxWidth(), Arrangement.Center, Alignment.CenterVertically) {
                CircularProgressIndicator(Modifier.size(24.dp), strokeWidth = 3.dp)
                Spacer(Modifier.width(8.dp)); Text("Analizando con ML Kit...", fontSize = 11.sp, color = Color.Gray)
            }
        }
    }

    val prop = propuesta
    if (prop != null) {
        OcrConfirmDialog(
            propuesta = prop,
            barcodeInicial = lastBarcode,
            categorias = categorias,
            onDismiss = {
                propuesta = null
                try { trainCrop?.recycle() } catch (_: Exception) {}
                trainCrop = null
                trainPreB64 = null
            },
            onConfirm = { barcode, base, color, nombre, categoria, cantidad, verificado ->
                val modelo = composeModelo(base, color)
                if (modelo.isBlank()) {
                    Toast.makeText(context, "El modelo base es obligatorio", Toast.LENGTH_SHORT).show()
                    return@OcrConfirmDialog
                }
                db.insertManifiestoItem(
                    manifiestoId = manifiestoId,
                    barcode = barcode.ifBlank { lastBarcode },
                    modelo = modelo,
                    nombre = nombre,
                    categoria = categoria,
                    cantidad = cantidad,
                    fotoPath = photoFile?.absolutePath ?: "",
                    mlkitRaw = prop.rawText,
                    origen = "ocr",
                    verificado = verificado
                )
                // Training para futuro PaddleOCR (fire-and-forget, offline-first: si falla, el ítem local queda)
                val cropBmp = trainCrop
                val preB64 = trainPreB64
                if (cropBmp != null) {
                    scope.launch(Dispatchers.IO) {
                        try {
                            postManifiestoTraining(
                                client, serverUrl,
                                cropB64 = bitmapToBase64q60(cropBmp),
                                preB64 = preB64,
                                prop = prop,
                                barcode = barcode.ifBlank { lastBarcode },
                                compuesto = modelo
                            )
                        } catch (_: Exception) {}
                        try { cropBmp.recycle() } catch (_: Exception) {}
                    }
                    trainCrop = null
                    trainPreB64 = null
                }
                propuesta = null
                onSaved()
                Toast.makeText(context, "Ítem guardado ($modelo)", Toast.LENGTH_SHORT).show()
            }
        )
    }
}

/** Envía el par (foto + preprocesada + ML Kit + verdad confirmada) al dataset de entrenamiento. */
suspend fun postManifiestoTraining(
    client: OkHttpClient,
    serverUrl: String,
    cropB64: String,
    preB64: String?,
    prop: OcrPropuesta,
    barcode: String,
    compuesto: String
) {
    try {
        val mlkitJson = org.json.JSONObject().apply {
            put("modelo_grupo", prop.modeloGrupo); put("codigo_color", prop.codigoColor)
            put("talla", prop.talla); put("sku", prop.sku); put("marca", prop.marca)
        }
        val truthJson = org.json.JSONObject().apply {
            put("modelo_grupo", compuesto)
            put("talla", prop.talla); put("sku", barcode.ifBlank { prop.sku })
        }
        val body = org.json.JSONObject().apply {
            put("image_original", cropB64)
            if (preB64 != null) put("image_preprocessed", preB64)
            put("mlkit_result", mlkitJson)
            put("barcode", barcode)
            put("user_truth", truthJson)
            put("device_info", "operations-manifiesto")
        }
        val req = Request.Builder()
            .url("${serverUrl.trimEnd('/')}/api/ocr/save-training")
            .post(body.toString().toRequestBody("application/json".toMediaType()))
            .build()
        client.newCall(req).execute().close()
    } catch (_: Exception) { /* offline: el ítem local ya quedó guardado */ }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun OcrConfirmDialog(
    propuesta: OcrPropuesta,
    barcodeInicial: String,
    categorias: List<String>,
    onDismiss: () -> Unit,
    onConfirm: (barcode: String, base: String, color: String, nombre: String, categoria: String, cantidad: Int, verificado: Int) -> Unit
) {
    var barcode by remember { mutableStateOf(barcodeInicial) }
    var base by remember { mutableStateOf(propuesta.modeloGrupo ?: "") }
    var color by remember { mutableStateOf(propuesta.codigoColor ?: "") }
    var nombre by remember { mutableStateOf("") }
    var categoria by remember { mutableStateOf(propuesta.marca?.let { m -> categorias.firstOrNull { normCat(it) == normCat(m) } } ?: categorias.firstOrNull() ?: "otro") }
    var cantidadTxt by remember { mutableStateOf("1") }
    var expanded by remember { mutableStateOf(false) }

    // Snapshot inicial: con confianza baja hay que editar al menos un campo
    val initBase = remember { propuesta.modeloGrupo ?: "" }
    val initColor = remember { propuesta.codigoColor ?: "" }
    val initBarcode = remember { barcodeInicial }
    val initCategoria = remember { categoria }
    val lowConf = propuesta.confidence < 60
    val edited = base != initBase || color != initColor || barcode != initBarcode ||
            nombre.isNotBlank() || categoria != initCategoria || cantidadTxt != "1"
    val puedeGuardar = !lowConf || edited

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Confirmar ítem (conf. ${propuesta.confidence}%)", fontWeight = FontWeight.Bold, fontSize = 14.sp, color = if (lowConf) Color(0xFFDC2626) else Color(0xFF0F172A)) },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState()), Arrangement.spacedBy(6.dp)) {
                if (lowConf) {
                    Text(
                        "⚠️ Confianza baja: edita al menos un campo para guardar. Si la etiqueta sale torcida o con brillo, enderézala y repite la foto.",
                        fontSize = 10.sp, fontWeight = FontWeight.Bold, color = Color(0xFFDC2626)
                    )
                }
                if (barcode.isBlank()) {
                    Text(
                        "Sin barcode: verifica el código manualmente (se guarda con verificado=0).",
                        fontSize = 10.sp, fontWeight = FontWeight.Bold, color = Color(0xFFD97706)
                    )
                }
                OutlinedTextField(value = barcode, onValueChange = { barcode = it }, label = { Text("Barcode", fontSize = 10.sp) }, singleLine = true, modifier = Modifier.fillMaxWidth())
                OutlinedTextField(value = base, onValueChange = { base = it }, label = { Text("Modelo base *", fontSize = 10.sp) }, singleLine = true, modifier = Modifier.fillMaxWidth())
                OutlinedTextField(value = color, onValueChange = { color = it }, label = { Text("Código color", fontSize = 10.sp) }, singleLine = true, modifier = Modifier.fillMaxWidth())
                Text("Compuesto: ${composeModelo(base, color).ifBlank { "—" }}", fontSize = 11.sp, fontWeight = FontWeight.Bold, color = Color(0xFF059669))
                OutlinedTextField(value = nombre, onValueChange = { nombre = it }, label = { Text("Nombre", fontSize = 10.sp) }, singleLine = true, modifier = Modifier.fillMaxWidth())
                ExposedDropdownMenuBox(expanded = expanded, onExpandedChange = { expanded = !expanded }) {
                    OutlinedTextField(value = categoria, onValueChange = {}, readOnly = true, label = { Text("Categoría (fija)", fontSize = 10.sp) },
                        trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded) },
                        modifier = Modifier.fillMaxWidth().menuAnchor(), singleLine = true)
                    ExposedDropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
                        categorias.forEach { c -> DropdownMenuItem(text = { Text(c) }, onClick = { categoria = c; expanded = false }) }
                    }
                }
                OutlinedTextField(value = cantidadTxt, onValueChange = { cantidadTxt = it.filter { ch -> ch.isDigit() } }, label = { Text("Cantidad", fontSize = 10.sp) }, singleLine = true, modifier = Modifier.fillMaxWidth())
                if (propuesta.talla != null) Text("Talla detectada: ${propuesta.talla} (referencia)", fontSize = 10.sp, color = Color.Gray)
                if (propuesta.sku != null) Text("SKU detectado: ${propuesta.sku} (referencia)", fontSize = 10.sp, color = Color.Gray)
            }
        },
        confirmButton = {
            Button(
                onClick = { onConfirm(barcode, base, color, nombre, categoria, cantidadTxt.toIntOrNull() ?: 1, if (barcode.isBlank()) 0 else 1) },
                enabled = puedeGuardar,
                colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF059669))
            ) { Text(if (puedeGuardar) "Guardar" else "Edita un campo") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Descartar") } }
    )
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ManifiestoManualTab(
    manifiestoId: Long,
    barcodeInicial: String?,
    db: OperationsDbHelper,
    categorias: List<String>,
    onSaved: () -> Unit
) {
    val context = LocalContext.current
    var barcode by remember(barcodeInicial) { mutableStateOf(barcodeInicial ?: "") }
    var base by remember { mutableStateOf("") }
    var color by remember { mutableStateOf("") }
    var nombre by remember { mutableStateOf("") }
    var categoria by remember { mutableStateOf(categorias.firstOrNull() ?: "otro") }
    var cantidadTxt by remember { mutableStateOf("1") }
    var expanded by remember { mutableStateOf(false) }

    Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()), Arrangement.spacedBy(8.dp)) {
        OutlinedTextField(value = barcode, onValueChange = { barcode = it }, label = { Text("Barcode") }, singleLine = true, modifier = Modifier.fillMaxWidth())
        OutlinedTextField(value = base, onValueChange = { base = it }, label = { Text("Modelo base *") }, singleLine = true, modifier = Modifier.fillMaxWidth())
        OutlinedTextField(value = color, onValueChange = { color = it }, label = { Text("Código color") }, singleLine = true, modifier = Modifier.fillMaxWidth())
        Text("Compuesto: ${composeModelo(base, color).ifBlank { "—" }}", fontWeight = FontWeight.Bold, fontSize = 13.sp, color = Color(0xFF059669))
        OutlinedTextField(value = nombre, onValueChange = { nombre = it }, label = { Text("Nombre") }, singleLine = true, modifier = Modifier.fillMaxWidth())
        ExposedDropdownMenuBox(expanded = expanded, onExpandedChange = { expanded = !expanded }) {
            OutlinedTextField(value = categoria, onValueChange = {}, readOnly = true, label = { Text("Categoría (fija)") },
                trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded) },
                modifier = Modifier.fillMaxWidth().menuAnchor(), singleLine = true)
            ExposedDropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
                categorias.forEach { c -> DropdownMenuItem(text = { Text(c) }, onClick = { categoria = c; expanded = false }) }
            }
        }
        OutlinedTextField(value = cantidadTxt, onValueChange = { cantidadTxt = it.filter { ch -> ch.isDigit() } }, label = { Text("Cantidad") }, singleLine = true, modifier = Modifier.fillMaxWidth())
        Button(
            onClick = {
                val modelo = composeModelo(base, color)
                if (modelo.isBlank()) { Toast.makeText(context, "El modelo base es obligatorio", Toast.LENGTH_SHORT).show(); return@Button }
                db.insertManifiestoItem(manifiestoId, barcode, modelo, nombre, categoria, cantidadTxt.toIntOrNull() ?: 1, "", "", "manual")
                base = ""; color = ""; nombre = ""; cantidadTxt = "1"
                onSaved()
                Toast.makeText(context, "Ítem guardado ($modelo)", Toast.LENGTH_SHORT).show()
            },
            modifier = Modifier.fillMaxWidth(),
            colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF0F172A)),
            shape = RoundedCornerShape(12.dp)
        ) { Icon(Icons.Default.Add, null, Modifier.size(16.dp)); Spacer(Modifier.width(6.dp)); Text("Guardar ítem") }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ManifiestoListaTab(
    items: List<ManifiestoItemRow>,
    db: OperationsDbHelper,
    categorias: List<String>,
    onChanged: () -> Unit
) {
    val context = LocalContext.current
    var editing by remember { mutableStateOf<ManifiestoItemRow?>(null) }

    if (items.isEmpty()) {
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            Text("Sin ítems — usa OCR o Manual para agregar", color = Color.Gray, fontSize = 12.sp, textAlign = TextAlign.Center)
        }
        return
    }
    Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()), Arrangement.spacedBy(4.dp)) {
        items.forEach { it ->
            Card(Modifier.fillMaxWidth(), colors = CardDefaults.cardColors(containerColor = Color.White), shape = RoundedCornerShape(8.dp)) {
                Row(Modifier.padding(10.dp).fillMaxWidth(), Arrangement.SpaceBetween, Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text(it.modelo.ifBlank { "SIN MODELO" }, fontWeight = FontWeight.Black, fontSize = 12.sp)
                        Text("${it.nombre.ifBlank { "—" }} · ${it.categoria} · x${it.cantidad} · ${it.origen}", fontSize = 10.sp, color = Color.Gray)
                        if (it.barcode.isNotBlank()) Text(it.barcode, fontSize = 9.sp, color = Color(0xFF2563EB))
                    }
                    Row {
                        IconButton(onClick = { editing = it }) { Icon(Icons.Default.Edit, null, tint = Color(0xFF475569), modifier = Modifier.size(18.dp)) }
                        IconButton(onClick = { db.deleteManifiestoItem(it.id); onChanged() }) { Icon(Icons.Default.Delete, null, tint = Color(0xFFEF4444), modifier = Modifier.size(18.dp)) }
                    }
                }
            }
        }
    }

    val e = editing
    if (e != null) {
        var nombre by remember { mutableStateOf(e.nombre) }
        var categoria by remember { mutableStateOf(e.categoria) }
        var cantidadTxt by remember { mutableStateOf(e.cantidad.toString()) }
        var modelo by remember { mutableStateOf(e.modelo) }
        var expanded by remember { mutableStateOf(false) }
        AlertDialog(
            onDismissRequest = { editing = null },
            title = { Text("Editar ítem", fontWeight = FontWeight.Bold) },
            text = {
                Column(Modifier.fillMaxWidth(), Arrangement.spacedBy(6.dp)) {
                    OutlinedTextField(value = modelo, onValueChange = { modelo = it }, label = { Text("Modelo *", fontSize = 10.sp) }, singleLine = true, modifier = Modifier.fillMaxWidth())
                    OutlinedTextField(value = nombre, onValueChange = { nombre = it }, label = { Text("Nombre", fontSize = 10.sp) }, singleLine = true, modifier = Modifier.fillMaxWidth())
                    ExposedDropdownMenuBox(expanded = expanded, onExpandedChange = { expanded = !expanded }) {
                        OutlinedTextField(value = categoria, onValueChange = {}, readOnly = true, label = { Text("Categoría (fija)", fontSize = 10.sp) },
                            trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded) },
                            modifier = Modifier.fillMaxWidth().menuAnchor(), singleLine = true)
                        ExposedDropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
                            categorias.forEach { c -> DropdownMenuItem(text = { Text(c) }, onClick = { categoria = c; expanded = false }) }
                        }
                    }
                    OutlinedTextField(value = cantidadTxt, onValueChange = { cantidadTxt = it.filter { ch -> ch.isDigit() } }, label = { Text("Cantidad", fontSize = 10.sp) }, singleLine = true, modifier = Modifier.fillMaxWidth())
                }
            },
            confirmButton = {
                Button(onClick = {
                    if (modelo.isBlank()) { Toast.makeText(context, "El modelo es obligatorio", Toast.LENGTH_SHORT).show(); return@Button }
                    db.updateManifiestoItem(e.id, nombre, categoria, cantidadTxt.toIntOrNull() ?: 1, modelo)
                    editing = null
                    onChanged()
                }, colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF0F172A))) { Text("Guardar") }
            },
            dismissButton = { TextButton(onClick = { editing = null }) { Text("Cancelar") } }
        )
    }
}

@Composable
fun ManifiestoExportTab(
    manifiesto: ManifiestoRow,
    items: List<ManifiestoItemRow>,
    onCerrar: () -> Unit,
    onEliminar: () -> Unit
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var showDelete by remember { mutableStateOf(false) }

    Column(Modifier.fillMaxWidth(), Arrangement.spacedBy(10.dp)) {
        Card(Modifier.fillMaxWidth(), colors = CardDefaults.cardColors(containerColor = Color.White), shape = RoundedCornerShape(12.dp)) {
            Column(Modifier.padding(14.dp), Arrangement.spacedBy(4.dp)) {
                Text(manifiesto.nombre, fontWeight = FontWeight.Black, fontSize = 14.sp)
                Text("${items.size} ítems · ${items.sumOf { it.cantidad }} uds · estado: ${manifiesto.estado}", fontSize = 11.sp, color = Color.Gray)
                Text("Header: manifiesto,barcode,modelo,nombre,categoria,cantidad,origen", fontSize = 9.sp, color = Color.LightGray)
            }
        }
        Button(
            onClick = {
                scope.launch(Dispatchers.IO) {
                    try {
                        val sb = StringBuilder()
                        sb.append("\uFEFFmanifiesto,barcode,modelo,nombre,categoria,cantidad,origen\n")
                        for (it in items) {
                            sb.append(listOf(manifiesto.nombre, it.barcode, it.modelo, it.nombre, it.categoria, it.cantidad.toString(), it.origen).joinToString(",") { cell ->
                                if (cell.all { ch -> ch.isDigit() }) cell else csvCell(cell)
                            })
                            sb.append("\n")
                        }
                        val file = File(context.cacheDir, "manifiesto_${manifiesto.id}_${System.currentTimeMillis()}.csv")
                        file.writeText(sb.toString(), Charsets.UTF_8)
                        val uri = FileProvider.getUriForFile(context, "com.inventorio.operations.fileprovider", file)
                        withContext(Dispatchers.Main) {
                            context.startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).apply {
                                type = "text/csv"
                                putExtra(Intent.EXTRA_SUBJECT, "Manifiesto ${manifiesto.nombre}")
                                putExtra(Intent.EXTRA_STREAM, uri)
                                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                            }, "Exportar manifiesto"))
                        }
                    } catch (e: Exception) {
                        withContext(Dispatchers.Main) {
                            Toast.makeText(context, "Error al exportar: ${e.message}", Toast.LENGTH_LONG).show()
                        }
                    }
                }
            },
            enabled = items.isNotEmpty(),
            modifier = Modifier.fillMaxWidth(),
            colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF059669)),
            shape = RoundedCornerShape(12.dp)
        ) { Icon(Icons.Default.Share, null, Modifier.size(16.dp)); Spacer(Modifier.width(6.dp)); Text("Exportar CSV (${items.size})") }
        OutlinedButton(
            onClick = onCerrar,
            modifier = Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(12.dp)
        ) { Text("Cerrar manifiesto") }
        OutlinedButton(
            onClick = { showDelete = true },
            modifier = Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(12.dp),
            colors = ButtonDefaults.outlinedButtonColors(contentColor = Color(0xFFEF4444))
        ) { Text("Eliminar manifiesto") }
    }

    if (showDelete) {
        AlertDialog(
            onDismissRequest = { showDelete = false },
            title = { Text("Eliminar manifiesto", fontWeight = FontWeight.Bold) },
            text = { Text("Se borrará ${manifiesto.nombre} con sus ${items.size} ítems. ¿Continuar?") },
            confirmButton = {
                Button(onClick = { showDelete = false; onEliminar() },
                    colors = ButtonDefaults.buttonColors(containerColor = Color(0xFFEF4444))) { Text("Eliminar") }
            },
            dismissButton = { TextButton(onClick = { showDelete = false }) { Text("Cancelar") } }
        )
    }
}
