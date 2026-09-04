package com.inventorio.alpha

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.media.AudioAttributes
import android.media.AudioManager
import android.media.SoundPool
import android.net.Uri
import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.util.Log
import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.camera.core.*
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.BlendMode
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.window.Dialog
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import androidx.lifecycle.compose.LocalLifecycleOwner
import coil.compose.AsyncImage
import com.google.gson.Gson
import com.google.gson.reflect.TypeToken
import com.google.mlkit.vision.barcode.BarcodeScanning
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.common.InputImage
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.FileOutputStream
import java.io.InputStream
import java.util.*
import kotlin.coroutines.resume

private const val CHANNEL_ID = "batch_ocr_channel"
private const val NOTIFICATION_ID = 1001
private const val TAG = "BatchOcrView"

enum class BatchItemStatus { PENDING, PROCESSING, SUCCESS, ERROR }

data class BatchItem(
    val id: String = UUID.randomUUID().toString(),
    val uri: Uri,
    val status: BatchItemStatus = BatchItemStatus.PENDING,
    val barcode: String? = null,
    val modeloGrupo: String? = null,
    val codigoColor: String? = null,
    val fechaTemporada: String? = null,
    val sku: String? = null,
    val marca: String? = null,
    val talla: String? = null,
    val tipoProducto: String? = null,
    val ocrSource: String? = null,  // "mlkit-75", etc. (solo on-device)
    val errorMessage: String? = null,
    val retryCount: Int = 0,
    val quantity: Int = 1
)

data class BatchOcrResponse(val parsedProducts: List<BatchOcrProduct>?)
data class BatchOcrProduct(
    val id: String = UUID.randomUUID().toString(),
    val modelo_grupo: String?,
    val codigo_color: String? = null,
    val fecha_temporada: String? = null,
    val sku: String?,
    val marca: String?,
    val talla: String?,
    val tipo_producto: String?,
    val genero: String?,
    val existeModelo: Boolean
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun BatchOcrView(
    client: OkHttpClient,
    serverUrl: String,
    ocrEngine: LabelOcrEngine,
    cajas: List<Caja>
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val lifecycleOwner = LocalLifecycleOwner.current

    // ── Permissions ────────────────────────────────────────────────
    var hasCameraPermission by remember {
        mutableStateOf(ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED)
    }
    val permissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted -> hasCameraPermission = granted }

    // ── Batch state ────────────────────────────────────────────────
    var batchQueue by remember { mutableStateOf<List<BatchItem>>(emptyList()) }
    var isProcessing by remember { mutableStateOf(false) }
    var rpmLimit by remember { mutableIntStateOf(5) }
    var showCamera by remember { mutableStateOf(false) }
    var autoReopenCamera by remember { mutableStateOf(true) }
    var isFlashEnabled by remember { mutableStateOf(false) }
    var cameraInstance by remember { mutableStateOf<Camera?>(null) }
    var selectedContainer by remember { mutableStateOf<Caja?>(null) }
    var showContainerSelector by remember { mutableStateOf(false) }
    var containerSearchQuery by remember { mutableStateOf("") }

    // ── Review dialog state ────────────────────────────────────────
    var showReviewDialog by remember { mutableStateOf(false) }
    var reviewItems by remember { mutableStateOf<List<BatchItem>>(emptyList()) }
    var pendingOfflineCount by remember { mutableStateOf(OfflineQueueManager.getQueue(context).size) }

    // ── Conflict resolution state ──────────────────────────────────
    var showConflictDialog by remember { mutableStateOf(false) }
    var conflictItems by remember { mutableStateOf<List<org.json.JSONObject>>(emptyList()) }
    var pendingSaveItems by remember { mutableStateOf<List<BatchItem>>(emptyList()) }

    // ── Inline scanner state ───────────────────────────────────────
    var showCameraPreview by remember { mutableStateOf(false) }
    var pendingBarcodeCallback by remember { mutableStateOf<((String) -> Unit)?>(null) }

    // ── Group photos ────────────────────────────────────────────────
    var groupPhotos by remember { mutableStateOf<Map<String, Uri?>>(emptyMap()) }
    var activeGroupModel by remember { mutableStateOf<String?>(null) }
    val groupPhotoLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.GetContent()
    ) { uri ->
        activeGroupModel?.let { model ->
            if (uri != null) groupPhotos = groupPhotos + (model to uri)
        }
        activeGroupModel = null
    }

    // ── Progress dialog state ──────────────────────────────────────
    var showProgressDialog by remember { mutableStateOf(false) }
    var progressPercent by remember { mutableFloatStateOf(0f) }
    var progressText by remember { mutableStateOf("") }
    var trainingSavedCount by remember { mutableIntStateOf(0) }
    var trainingFailedCount by remember { mutableIntStateOf(0) }

    // ── Queue stats ────────────────────────────────────────────────
    var statsPending by remember { mutableIntStateOf(0) }
    var statsSuccess by remember { mutableIntStateOf(0) }
    var statsError by remember { mutableIntStateOf(0) }
    var statsTotal by remember { mutableIntStateOf(0) }

    fun updateQueueStats() {
        statsTotal = batchQueue.size
        statsPending = batchQueue.count { it.status == BatchItemStatus.PENDING }
        statsSuccess = batchQueue.count { it.status == BatchItemStatus.SUCCESS }
        statsError = batchQueue.count { it.status == BatchItemStatus.ERROR }
    }

    // ── Gallery launcher ───────────────────────────────────────────
    val galleryLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.GetMultipleContents()
    ) { uris: List<Uri> ->
        val newItems = uris.map { uri -> BatchItem(uri = uri) }
        batchQueue = batchQueue + newItems
        updateQueueStats()
    }

    // ── Notification channel ───────────────────────────────────────
    LaunchedEffect(Unit) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(CHANNEL_ID, "Procesamiento por Lote", NotificationManager.IMPORTANCE_DEFAULT).apply {
                description = "Notificaciones de escaneo y OCR por lotes"
            }
            (context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).createNotificationChannel(channel)
        }
    }

    // ── Sound + vibration utility ──────────────────────────────────
    fun playCompletionFeedback() {
        try {
            val vibrator = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                (context.getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as VibratorManager).defaultVibrator
            } else {
                @Suppress("DEPRECATION")
                context.getSystemService(Context.VIBRATOR_SERVICE) as Vibrator
            }
            vibrator?.vibrate(VibrationEffect.createOneShot(300, VibrationEffect.DEFAULT_AMPLITUDE))
        } catch (_: Exception) {}
    }

    // ── ML Kit barcode scanner ─────────────────────────────────────
    suspend fun scanBarcodeFromBitmap(bitmap: Bitmap): String? = suspendCancellableCoroutine { cont ->
        try {
            val image = InputImage.fromBitmap(bitmap, 0)
            val scanner = BarcodeScanning.getClient()
            scanner.process(image)
                .addOnSuccessListener { barcodes ->
                    cont.resume(barcodes.firstOrNull()?.rawValue)
                }
                .addOnFailureListener { cont.resume(null) }
        } catch (e: Exception) {
            cont.resume(null)
        }
    }

    // ── Dedup check ────────────────────────────────────────────────
    fun findResolvedSibling(barcode: String): BatchItem? =
        batchQueue.firstOrNull { it.barcode == barcode && it.status == BatchItemStatus.SUCCESS }

    // ── Update item helper ─────────────────────────────────────────
    fun updateItem(id: String, transform: (BatchItem) -> BatchItem) {
        batchQueue = batchQueue.map { if (it.id == id) transform(it) else it }
        updateQueueStats()
    }

    // ── Core processing loop ───────────────────────────────────────
    suspend fun processSingleItem(item: BatchItem): BatchItem {
        val bmp = try {
            context.contentResolver.openInputStream(item.uri)?.use { BitmapFactory.decodeStream(it) }
        } catch (e: Exception) { null } ?: return item.copy(status = BatchItemStatus.ERROR, errorMessage = "No se pudo decodificar la imagen")

        // Step 1: Local barcode scan
        val barcode = scanBarcodeFromBitmap(bmp) ?: item.barcode

        // Step 2: Dedup — if sibling already resolved this barcode, increment its quantity
        if (barcode != null) {
            val sibling = findResolvedSibling(barcode)
            if (sibling != null) {
                // Increment sibling quantity, mark this one as duplicate (skipped)
                updateItem(sibling.id) { it.copy(quantity = it.quantity + 1) }
                return item.copy(
                    status = BatchItemStatus.SUCCESS,
                    barcode = barcode,
                    modeloGrupo = sibling.modeloGrupo,
                    codigoColor = sibling.codigoColor,
                    sku = sibling.sku,
                    marca = sibling.marca,
                    talla = sibling.talla,
                    fechaTemporada = sibling.fechaTemporada,
                    tipoProducto = sibling.tipoProducto,
                    quantity = 0 // auto-incremented into sibling
                )
            }
        }

        // Step 3: OCR con LabelOcrEngine (solo ML Kit on-device)
        val ocrResult = try {
            ocrEngine.analyze(bmp, barcode = barcode)
        } catch (e: Exception) {
            Log.e(TAG, "OCR failed", e)
            null
        }

        if (ocrResult == null || !ocrResult.hasAnyData) {
            if (item.retryCount < 2) {
                // Will be retried with backoff
                return item.copy(status = BatchItemStatus.PENDING, retryCount = item.retryCount + 1, barcode = barcode)
            }
            return item.copy(
                status = BatchItemStatus.ERROR,
                barcode = barcode,
                errorMessage = "OCR no extrajo datos (${item.retryCount + 1} intentos)"
            )
        }

        // Step 4: Save training data asynchronously (fire and forget)
        try {
            val trainingService = OcrTrainingService(client, serverUrl)
            val sample = trainingService.createSample(bmp, ocrResult, barcode)
            kotlinx.coroutines.CoroutineScope(kotlinx.coroutines.Dispatchers.IO).launch {
                val saved = trainingService.saveTrainingSample(sample)
                withContext(Dispatchers.Main) {
                    if (saved) {
                        trainingSavedCount++
                        Log.i(TAG, "✅ Training sample guardado (${trainingSavedCount} total)")
                    } else {
                        trainingFailedCount++
                        Log.w(TAG, "⚠️ Training sample NO guardado (${trainingFailedCount} fallos)")
                    }
                }
            }
        } catch (e: Exception) {
            trainingFailedCount++
            Log.e(TAG, "❌ Error creating training sample: ${e.message}", e)
        }

        return item.copy(
            status = BatchItemStatus.SUCCESS,
            barcode = barcode,
            modeloGrupo = ocrResult.modeloGrupo,
            codigoColor = ocrResult.codigoColor,
            fechaTemporada = ocrResult.fechaTemporada,
            sku = ocrResult.sku,
            marca = ocrResult.marca,
            talla = ocrResult.talla,
            tipoProducto = "ropa",
            ocrSource = ocrResult.source
        )
    }

    fun startBatchProcessing() {
        val pending = batchQueue.filter { it.status == BatchItemStatus.PENDING }
        if (pending.isEmpty()) {
            Toast.makeText(context, "No hay fotos pendientes", Toast.LENGTH_SHORT).show()
            return
        }
        if (selectedContainer == null) {
            Toast.makeText(context, "Selecciona un contenedor destino primero", Toast.LENGTH_SHORT).show()
            return
        }

        isProcessing = true
        showProgressDialog = true

        // Notification setup
        val notificationManager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        val builder = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.stat_notify_sync)
            .setContentTitle("Escaneo por Lote")
            .setContentText("Iniciando...")
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .setProgress(pending.size, 0, false)
        notificationManager.notify(NOTIFICATION_ID, builder.build())

        scope.launch(Dispatchers.IO) {
            var processedCount = 0
            val delayMs = (60_000L / rpmLimit.coerceIn(1, 15))

            for (item in pending) {
                updateItem(item.id) { it.copy(status = BatchItemStatus.PROCESSING) }

                val startTime = System.currentTimeMillis()
                progressText = "Procesando ${processedCount + 1}/${pending.size}..."
                progressPercent = processedCount.toFloat() / pending.size

                builder.setProgress(pending.size, processedCount, false)
                    .setContentText("(${processedCount + 1}/${pending.size}) ${item.uri.lastPathSegment?.take(20) ?: "..."}")
                notificationManager.notify(NOTIFICATION_ID, builder.build())

                // Retry loop
                var currentItem = item
                var success = false
                for (attempt in 0..2) {
                    currentItem = processSingleItem(currentItem.copy(retryCount = attempt))
                    if (currentItem.status == BatchItemStatus.SUCCESS) {
                        success = true
                        break
                    }
                    // Only retry if it came back as PENDING (means "retry me")
                    if (currentItem.status != BatchItemStatus.PENDING) break
                    val backoff = 2000L * (attempt + 1)
                    delay(backoff)
                }

                val finalItem = if (!success && currentItem.status == BatchItemStatus.PENDING) {
                    currentItem.copy(status = BatchItemStatus.ERROR, errorMessage = "Máximos intentos (3)")
                } else currentItem

                updateItem(finalItem.id) { finalItem }
                processedCount++

                // RPM throttle between items (not after the last one)
                if (processedCount < pending.size) {
                    val elapsed = System.currentTimeMillis() - startTime
                    val remaining = delayMs - elapsed
                    if (remaining > 0) delay(remaining)
                }
            }

            // Processing complete
            progressPercent = 1f
            progressText = "Procesamiento completado"
            isProcessing = false
            showProgressDialog = false

            // Update notification
            val successCount = batchQueue.count { it.status == BatchItemStatus.SUCCESS }
            val errorCount = batchQueue.count { it.status == BatchItemStatus.ERROR }
            builder.setContentText("$successCount éxito, $errorCount fallo(s)")
                .setProgress(0, 0, false)
            notificationManager.notify(NOTIFICATION_ID, builder.build())

            // Sound + vibration
            playCompletionFeedback()

            // Show review dialog on main thread
            withContext(Dispatchers.Main) {
                reviewItems = batchQueue.filter { it.status == BatchItemStatus.SUCCESS }
                if (reviewItems.isNotEmpty() || errorCount > 0) {
                    showReviewDialog = true
                }
                val msg = if (errorCount > 0) "Lote procesado. $successCount exitoso(s), $errorCount fallo(s)."
                    else "Lote procesado con éxito ($successCount productos)"
                val trainingMsg = if (trainingSavedCount > 0 || trainingFailedCount > 0) {
                    "\n📊 Training: $trainingSavedCount guardado(s), $trainingFailedCount fallo(s)"
                } else ""
                Toast.makeText(context, msg + trainingMsg, Toast.LENGTH_LONG).show()
                // Reset counters for next batch
                trainingSavedCount = 0
                trainingFailedCount = 0
            }
        }
    }

    // ── Bulk save ──────────────────────────────────────────────────
    fun saveReviewItems(items: List<BatchItem>) {
        if (items.isEmpty()) return
        isProcessing = true
        scope.launch(Dispatchers.IO) {
            try {
                val reqBodyJson = buildString {
                    append("{\"products\":[")
                    items.forEachIndexed { i, p ->
                        if (i > 0) append(",")
                        append("{")
                        append("\"modelo_grupo\":\"${p.modeloGrupo?.replace("\"", "\\\"") ?: ""}\",")
                        append("\"codigo_color\":\"${p.codigoColor?.replace("\"", "\\\"") ?: ""}\",")
                        append("\"fecha_temporada\":\"${p.fechaTemporada?.replace("\"", "\\\"") ?: ""}\",")
                        append("\"sku\":\"${p.sku?.replace("\"", "\\\"") ?: ""}\",")
                        append("\"marca\":\"${p.marca?.replace("\"", "\\\"") ?: ""}\",")
                        append("\"talla\":\"${p.talla?.replace("\"", "\\\"") ?: ""}\",")
                        append("\"tipo_producto\":\"${p.tipoProducto?.replace("\"", "\\\"") ?: ""}\"")
                        append("}")
                    }
                    append("],")
                    val container = selectedContainer
                    if (container != null) {
                        if (container.numero_caja.uppercase().startsWith("NIVEL:")) {
                            container.id_zona_nivel?.let { append("\"id_zona_nivel\":$it,") }
                        } else {
                            append("\"id_caja\":${container.id_caja},")
                        }
                    }
                    append("\"dummy\":0}")
                }

                val request = Request.Builder()
                    .url("${serverUrl.trimEnd('/')}/api/productos/batch-register")
                    .post(reqBodyJson.toRequestBody("application/json".toMediaType()))
                    .build()
                client.newCall(request).execute().use { response ->
                    withContext(Dispatchers.Main) {
                        isProcessing = false
                        if (response.isSuccessful) {
                            val body = response.body?.string() ?: "{}"
                            val json = org.json.JSONObject(body)
                            val conflicts = json.optJSONArray("conflicts")

                            if (conflicts != null && conflicts.length() > 0) {
                                // Hay conflictos — mostrar diálogo
                                conflictItems = (0 until conflicts.length()).map { conflicts.getJSONObject(it) }
                                pendingSaveItems = items
                                showConflictDialog = true
                            } else {
                                Toast.makeText(context, "${items.size} productos registrados", Toast.LENGTH_LONG).show()
                                batchQueue = emptyList()
                                showReviewDialog = false
                                updateQueueStats()
                            }
                        } else {
                            // Save offline
                            val offlineBatch = OfflineQueueManager.OfflineBatch(
                                idCaja = selectedContainer?.takeIf { !it.numero_caja.uppercase().startsWith("NIVEL:") }?.id_caja,
                                idZonaNivel = selectedContainer?.takeIf { it.numero_caja.uppercase().startsWith("NIVEL:") }?.id_zona_nivel,
                                products = items.map { BatchOcrProduct(
                                    modelo_grupo = it.modeloGrupo,
                                    codigo_color = it.codigoColor,
                                    fecha_temporada = it.fechaTemporada,
                                    sku = it.sku,
                                    marca = it.marca,
                                    talla = it.talla,
                                    tipo_producto = it.tipoProducto,
                                    genero = null,
                                    existeModelo = false
                                ) }
                            )
                            OfflineQueueManager.saveBatchToQueue(context, offlineBatch)
                            pendingOfflineCount = OfflineQueueManager.getQueue(context).size
                            Toast.makeText(context, "Sin conexión. Guardado offline.", Toast.LENGTH_LONG).show()
                        }
                    }
                }
            } catch (e: Exception) {
                withContext(Dispatchers.Main) {
                    isProcessing = false
                    Toast.makeText(context, "Error de red: ${e.message}", Toast.LENGTH_LONG).show()
                }
            }
        }
    }

    // ── Camera capture callback ────────────────────────────────────
    val onPhotoCaptured: (ImageProxy) -> Unit = { image ->
        val buffer = image.planes[0].buffer
        val bytes = ByteArray(buffer.remaining()).also { buffer.get(it) }
        val original = BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
        if (original != null) {
            val rotated = if (image.imageInfo.rotationDegrees != 0) {
                val m = Matrix().apply { postRotate(image.imageInfo.rotationDegrees.toFloat()) }
                Bitmap.createBitmap(original, 0, 0, original.width, original.height, m, true)
            } else original

            // If scanning barcode for review dialog
            if (showCameraPreview && pendingBarcodeCallback != null) {
                scope.launch(Dispatchers.IO) {
                    val barcode = scanBarcodeFromBitmap(rotated)
                    withContext(Dispatchers.Main) {
                        if (barcode != null) {
                            pendingBarcodeCallback?.invoke(barcode)
                            Toast.makeText(context, "Código: $barcode", Toast.LENGTH_SHORT).show()
                        } else {
                            Toast.makeText(context, "No se detectó código de barras", Toast.LENGTH_SHORT).show()
                        }
                        pendingBarcodeCallback = null
                        showCameraPreview = false
                        showReviewDialog = true
                    }
                }
            } else {
                // Normal batch capture flow
                val wFrac = 0.85f; val hFrac = wFrac * 0.6f
                val cw = (rotated.width * wFrac).toInt(); val ch = (rotated.height * hFrac).toInt()
                val cx = ((rotated.width - cw) / 2).coerceAtLeast(0); val cy = ((rotated.height - ch) / 2).coerceAtLeast(0)
                val cropped = Bitmap.createBitmap(rotated, cx, cy, cw, ch)

                val tempFile = File(context.cacheDir, "batch_${System.currentTimeMillis()}.jpg")
                try {
                    FileOutputStream(tempFile).use { cropped.compress(Bitmap.CompressFormat.JPEG, 90, it) }
                    val uri = FileProvider.getUriForFile(context, "com.inventorio.alpha.fileprovider", tempFile)
                    batchQueue = batchQueue + BatchItem(uri = uri)
                    updateQueueStats()
                } catch (e: Exception) {
                    Log.e(TAG, "Error saving photo", e)
                }
            }
        }
        image.close()
        if (!autoReopenCamera) showCamera = false
    }

    // ════════════════════════════════════════════════════════════════
    //  UI
    // ════════════════════════════════════════════════════════════════

    Box(modifier = Modifier.fillMaxSize()) {
        if (showCamera && hasCameraPermission) {
            CameraViewfinder(
                autoReopenCamera = autoReopenCamera,
                isFlashEnabled = isFlashEnabled,
                onFlashToggle = { isFlashEnabled = it },
                onPhotoCaptured = onPhotoCaptured,
                onClose = { showCamera = false },
                lifecycleOwner = lifecycleOwner
            )
        } else {
            Column(modifier = Modifier.fillMaxSize()) {

                // ── Config card ───────────────────────────────────
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .verticalScroll(rememberScrollState())
                        .padding(16.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    Card(
                        colors = CardDefaults.cardColors(containerColor = Color.White),
                        shape = RoundedCornerShape(20.dp)
                    ) {
                        Column(modifier = Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            Text("Escaneo por Lote", fontWeight = FontWeight.Black, fontSize = 16.sp, color = Color(0xFF0F172A))
                            Text("Toma fotos o súbelas de la galería. La IA procesará cada una con código de barras + OCR multi-proveedor.", fontSize = 11.sp, color = Color.Gray)

                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Text("Auto-reabrir cámara", fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
                                Switch(checked = autoReopenCamera, onCheckedChange = { autoReopenCamera = it },
                                    colors = SwitchDefaults.colors(checkedThumbColor = Color(0xFF7C3AED)))
                            }

                            // RPM slider
                            Column {
                                Row(
                                    modifier = Modifier.fillMaxWidth(),
                                    horizontalArrangement = Arrangement.SpaceBetween,
                                    verticalAlignment = Alignment.CenterVertically
                                ) {
                                    Text("RPM (requests/min)", fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
                                    Text("$rpmLimit", fontSize = 12.sp, fontWeight = FontWeight.Bold, color = Color(0xFF7C3AED))
                                }
                                Slider(
                                    value = rpmLimit.toFloat(),
                                    onValueChange = { rpmLimit = it.toInt().coerceIn(1, 15) },
                                    valueRange = 1f..15f,
                                    steps = 13,
                                    colors = SliderDefaults.colors(thumbColor = Color(0xFF7C3AED), activeTrackColor = Color(0xFF7C3AED))
                                )
                                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                                    Text("1", fontSize = 9.sp, color = Color.LightGray)
                                    Text("15", fontSize = 9.sp, color = Color.LightGray)
                                }
                            }
                        }
                    }

                    // ── Container selector ────────────────────────
                    Card(
                        modifier = Modifier.fillMaxWidth().clickable { showContainerSelector = true },
                        colors = CardDefaults.cardColors(containerColor = Color(0xFFF1F5F9)),
                        shape = RoundedCornerShape(12.dp)
                    ) {
                        Row(
                            modifier = Modifier.padding(14.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.SpaceBetween
                        ) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Icon(Icons.Default.Inbox, null, tint = Color.Gray)
                                Spacer(Modifier.width(10.dp))
                                Column {
                                    Text("Contenedor Destino", fontSize = 11.sp, color = Color.Gray, fontWeight = FontWeight.Bold)
                                    Text(
                                        selectedContainer?.numero_caja?.replace("(?i)^NIVEL:\\s*".toRegex(), "Nivel ") ?: "Seleccionar nivel o caja",
                                        fontSize = 13.sp, fontWeight = FontWeight.Black,
                                        color = if (selectedContainer != null) Color(0xFF7C3AED) else Color.DarkGray
                                    )
                                }
                            }
                            Icon(Icons.Default.ChevronRight, null, tint = Color.Gray)
                        }
                    }

                    // ── Offline pending banner ─────────────────────
                    if (pendingOfflineCount > 0) {
                        var isSyncing by remember { mutableStateOf(false) }
                        OfflineSyncBanner(
                            count = pendingOfflineCount,
                            isSyncing = isSyncing,
                            onSync = {
                                isSyncing = true
                                scope.launch(Dispatchers.IO) {
                                    val queue = OfflineQueueManager.getQueue(context)
                                    var ok = 0
                                    for (batch in queue) {
                                        try {
                                            val json = buildString {
                                                append("{\"products\":[")
                                                batch.products.forEachIndexed { i, p ->
                                                    if (i > 0) append(",")
                                                    append("{\"modelo_grupo\":\"${p.modelo_grupo ?: ""}\",\"codigo_color\":\"${p.codigo_color ?: ""}\",\"fecha_temporada\":\"${p.fecha_temporada ?: ""}\",\"sku\":\"${p.sku ?: ""}\",\"marca\":\"${p.marca ?: ""}\",\"talla\":\"${p.talla ?: ""}\",\"tipo_producto\":\"${p.tipo_producto ?: ""}\"}")
                                                }
                                                append("]")
                                                if (batch.idCaja != null) append(",\"id_caja\":${batch.idCaja}")
                                                if (batch.idZonaNivel != null) append(",\"id_zona_nivel\":${batch.idZonaNivel}")
                                                append(",\"dummy\":0}")
                                            }
                                            val req = Request.Builder()
                                                .url("${serverUrl.trimEnd('/')}/api/productos/batch-register")
                                                .post(json.toRequestBody("application/json".toMediaType()))
                                                .build()
                                            client.newCall(req).execute().use { if (it.isSuccessful) { OfflineQueueManager.removeBatch(context, batch.id); ok++ } }
                                        } catch (_: Exception) {}
                                    }
                                    withContext(Dispatchers.Main) {
                                        isSyncing = false
                                        pendingOfflineCount = OfflineQueueManager.getQueue(context).size
                                        Toast.makeText(context, if (ok > 0) "Sincronizados $ok lotes" else "Error de conexión", Toast.LENGTH_SHORT).show()
                                    }
                                }
                            }
                        )
                    }

                    // ── Action buttons ─────────────────────────────
                    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        Button(
                            onClick = {
                                if (!hasCameraPermission) permissionLauncher.launch(Manifest.permission.CAMERA)
                                else showCamera = true
                            },
                            modifier = Modifier.weight(1f),
                            colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF0F172A)),
                            shape = RoundedCornerShape(12.dp), enabled = !isProcessing
                        ) { Icon(Icons.Default.AddAPhoto, null, Modifier.size(18.dp)); Spacer(Modifier.width(6.dp)); Text("Cámara", fontSize = 12.sp, fontWeight = FontWeight.Bold) }

                        Button(
                            onClick = { galleryLauncher.launch("image/*") },
                            modifier = Modifier.weight(1f),
                            colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF475569)),
                            shape = RoundedCornerShape(12.dp), enabled = !isProcessing
                        ) { Icon(Icons.Default.PhotoLibrary, null, Modifier.size(18.dp)); Spacer(Modifier.width(6.dp)); Text("Galería", fontSize = 12.sp, fontWeight = FontWeight.Bold) }
                    }

                    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        Button(
                            onClick = { startBatchProcessing() },
                            modifier = Modifier.weight(1f),
                            colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF7C3AED)),
                            shape = RoundedCornerShape(12.dp),
                            enabled = !isProcessing && statsPending > 0 && selectedContainer != null
                        ) {
                            if (isProcessing) CircularProgressIndicator(Modifier.size(18.dp), color = Color.White, strokeWidth = 2.dp)
                            else { Icon(Icons.Default.PlayArrow, null, Modifier.size(18.dp)); Spacer(Modifier.width(6.dp)); Text("Procesar ($statsPending)", fontSize = 12.sp, fontWeight = FontWeight.Bold) }
                        }

                        if (statsSuccess > 0) {
                            Button(
                                onClick = {
                                    reviewItems = batchQueue.filter { it.status == BatchItemStatus.SUCCESS || it.status == BatchItemStatus.ERROR }
                                    showReviewDialog = true
                                },
                                modifier = Modifier.weight(1f),
                                colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF10B981)),
                                shape = RoundedCornerShape(12.dp)
                            ) { Icon(Icons.Default.CheckCircle, null, Modifier.size(18.dp)); Spacer(Modifier.width(6.dp)); Text("Revisar", fontSize = 12.sp, fontWeight = FontWeight.Bold) }
                        }
                    }

                    // ── Queue stats bar ────────────────────────────
                    if (batchQueue.isNotEmpty()) {
                        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            StatChip("Total", statsTotal, Color(0xFF64748B))
                            StatChip("Pend.", statsPending, Color(0xFFF59E0B))
                            StatChip("OK", statsSuccess, Color(0xFF10B981))
                            StatChip("Error", statsError, Color(0xFFEF4444))
                        }
                    }
                }

                // ── Queue grid ─────────────────────────────────────
                if (batchQueue.isEmpty()) {
                    Box(
                        modifier = Modifier.fillMaxSize().weight(1f).padding(horizontal = 16.dp),
                        contentAlignment = Alignment.Center
                    ) {
                        Column(horizontalAlignment = Alignment.CenterHorizontally) {
                            Icon(Icons.Default.PhotoLibrary, null, Modifier.size(48.dp), tint = Color.LightGray)
                            Spacer(Modifier.height(8.dp))
                            Text("No hay fotos en cola", color = Color.Gray, fontSize = 12.sp)
                            Text("Usa Cámara o Galería para agregar", fontSize = 10.sp, color = Color.LightGray)
                        }
                    }
                } else {
                    LazyVerticalGrid(
                        columns = GridCells.Fixed(3),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                        modifier = Modifier.fillMaxSize().weight(1f).padding(horizontal = 16.dp).padding(bottom = 16.dp),
                        contentPadding = PaddingValues(vertical = 4.dp)
                    ) {
                        items(batchQueue, key = { it.id }) { item ->
                            val borderColor = when (item.status) {
                                BatchItemStatus.SUCCESS -> Color(0xFF10B981)
                                BatchItemStatus.ERROR -> Color(0xFFEF4444)
                                BatchItemStatus.PROCESSING -> Color(0xFFF59E0B)
                                else -> Color.Transparent
                            }
                            val borderW = if (item.status != BatchItemStatus.PENDING) 2.dp else 0.dp

                            Box(modifier = Modifier
                                .aspectRatio(1f)
                                .clip(RoundedCornerShape(12.dp))
                                .background(Color(0xFFF1F5F9))
                                .border(borderW, borderColor, RoundedCornerShape(12.dp))
                            ) {
                                AsyncImage(model = item.uri, contentDescription = null, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())

                                // Status badge
                                Box(modifier = Modifier.align(Alignment.TopStart).padding(4.dp)
                                    .background(borderColor.copy(alpha = 0.85f), RoundedCornerShape(6.dp))
                                    .padding(horizontal = 4.dp, vertical = 2.dp)) {
                                    Text(
                                        when (item.status) { BatchItemStatus.SUCCESS -> "✓"; BatchItemStatus.ERROR -> "✗"; BatchItemStatus.PROCESSING -> "…"; else -> "" },
                                        fontSize = 9.sp, fontWeight = FontWeight.Black, color = Color.White
                                    )
                                }

                                // Barcode label
                                if (item.barcode != null) {
                                    Box(modifier = Modifier.align(Alignment.BottomStart).padding(4.dp)
                                        .background(Color(0xBB000000), RoundedCornerShape(4.dp))
                                        .padding(horizontal = 4.dp, vertical = 2.dp)) {
                                        Text(item.barcode, fontSize = 7.sp, fontFamily = FontFamily.Monospace, color = Color.White, maxLines = 1)
                                    }
                                }

                                // Delete button
                                if (item.status != BatchItemStatus.PROCESSING) {
                                    Box(modifier = Modifier.align(Alignment.TopEnd).padding(4.dp).size(24.dp)
                                        .background(Color(0x99000000), RoundedCornerShape(12.dp))
                                        .clickable { batchQueue = batchQueue.filter { it.id != item.id }; updateQueueStats() },
                                        contentAlignment = Alignment.Center) {
                                        Icon(Icons.Default.Close, null, tint = Color.White, modifier = Modifier.size(14.dp))
                                    }
                                }

                                // Retry button for errors
                                if (item.status == BatchItemStatus.ERROR) {
                                    Box(modifier = Modifier.align(Alignment.BottomEnd).padding(4.dp).size(24.dp)
                                        .background(Color(0x99000000), RoundedCornerShape(12.dp))
                                        .clickable {
                                            updateItem(item.id) { it.copy(status = BatchItemStatus.PENDING, errorMessage = null) }
                                        },
                                        contentAlignment = Alignment.Center) {
                                        Icon(Icons.Default.Refresh, null, tint = Color.White, modifier = Modifier.size(14.dp))
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    // ══════════════════════════════════════════════════════════════
    //  Dialogs
    // ══════════════════════════════════════════════════════════════

    // ── Container selector ─────────────────────────────────────────
    if (showContainerSelector) {
        ContainerSelectorDialog(
            cajas = cajas,
            selected = selectedContainer,
            searchQuery = containerSearchQuery,
            onSearchChange = { containerSearchQuery = it },
            onSelect = { selectedContainer = it; showContainerSelector = false },
            onDismiss = { showContainerSelector = false }
        )
    }

    // ── Progress dialog ────────────────────────────────────────────
    if (showProgressDialog) {
        Dialog(onDismissRequest = {}) {
            Card(modifier = Modifier.fillMaxWidth().padding(16.dp), shape = RoundedCornerShape(16.dp), colors = CardDefaults.cardColors(containerColor = Color.White)) {
                Column(modifier = Modifier.padding(24.dp).fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(16.dp)) {
                    CircularProgressIndicator(color = Color(0xFFF59E0B), modifier = Modifier.size(48.dp))
                    Text("Procesando Lote", fontWeight = FontWeight.Bold, fontSize = 18.sp, color = Color(0xFF0F172A))
                    LinearProgressIndicator(
                        progress = progressPercent,
                        modifier = Modifier.fillMaxWidth().height(8.dp).clip(RoundedCornerShape(4.dp)),
                        color = Color(0xFF7C3AED),
                        trackColor = Color(0xFFE2E8F0)
                    )
                    Text(progressText, fontSize = 13.sp, color = Color(0xFF475569), textAlign = TextAlign.Center)
                    // Show live status counts
                    Text("✓ ${statsSuccess} · ✗ ${statsError} · ⏳ ${statsPending}", fontSize = 11.sp, color = Color.Gray)
                }
            }
        }
    }

    // ── Review dialog ──────────────────────────────────────────────
    if (showReviewDialog) {
        ReviewResultsDialog(
            items = reviewItems,
            isSaving = isProcessing,
            groupPhotos = groupPhotos,
            onAssignGroupPhoto = { model ->
                activeGroupModel = model
                groupPhotoLauncher.launch("image/*")
            },
            onItemEdit = { edited ->
                reviewItems = reviewItems.map { if (it.id == edited.id) edited else it }

                // Save user correction as ground truth for training
                if (edited.barcode != null) {
                    scope.launch(Dispatchers.IO) {
                        try {
                            val originalItem = reviewItems.firstOrNull { it.id == edited.id }
                            val correctedJson = org.json.JSONObject().apply {
                                put("modelo_grupo", edited.modeloGrupo ?: org.json.JSONObject.NULL)
                                put("codigo_color", edited.codigoColor ?: org.json.JSONObject.NULL)
                                put("talla", edited.talla ?: org.json.JSONObject.NULL)
                                put("sku", edited.sku ?: org.json.JSONObject.NULL)
                                put("marca", edited.marca ?: org.json.JSONObject.NULL)
                            }
                            val mlkitJson = org.json.JSONObject().apply {
                                put("modelo_grupo", originalItem?.modeloGrupo ?: org.json.JSONObject.NULL)
                                put("codigo_color", originalItem?.codigoColor ?: org.json.JSONObject.NULL)
                                put("talla", originalItem?.talla ?: org.json.JSONObject.NULL)
                                put("sku", originalItem?.sku ?: org.json.JSONObject.NULL)
                                put("marca", originalItem?.marca ?: org.json.JSONObject.NULL)
                            }
                            val body = org.json.JSONObject().apply {
                                put("barcode", edited.barcode)
                                put("mlkit_result", mlkitJson)
                                put("corrected_result", correctedJson)
                                put("modelo_grupo", edited.modeloGrupo ?: "")
                            }
                            val req = Request.Builder()
                                .url("${serverUrl.trimEnd('/')}/api/ocr/save-correction")
                                .post(body.toString().toRequestBody("application/json".toMediaType()))
                                .build()
                            client.newCall(req).execute().close()
                        } catch (_: Exception) {}
                    }
                }
            },
            onSave = { saveReviewItems(it.filter { s -> s.status == BatchItemStatus.SUCCESS }) },
            onReprocess = { item ->
                batchQueue = batchQueue.map { if (it.id == item.id) item.copy(status = BatchItemStatus.PENDING, retryCount = 0, errorMessage = null) else it }
                updateQueueStats()
                reviewItems = reviewItems.filter { it.id != item.id }
                startBatchProcessing()
            },
            onScanBarcode = { onResult ->
                pendingBarcodeCallback = onResult
                showCameraPreview = true
                showCamera = true
            },
            onDismiss = { showReviewDialog = false }
        )
    }

    // ── Conflict resolution dialog ────────────────────────────────
    if (showConflictDialog && conflictItems.isNotEmpty()) {
        AlertDialog(
            onDismissRequest = { showConflictDialog = false },
            title = { Text("Productos en otro contenedor", fontWeight = FontWeight.Bold) },
            text = {
                Column {
                    Text(
                        "Estos productos ya existen en otro contenedor:",
                        fontSize = 14.sp, color = Color.Gray
                    )
                    Spacer(modifier = Modifier.height(8.dp))
                    conflictItems.forEach { conflict ->
                        val modelo = conflict.optString("modelo_grupo", "?")
                        val caja = conflict.optString("existing_caja", "?")
                        val qty = conflict.optInt("existing_cantidad", 0)
                        Card(
                            modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp),
                            colors = CardDefaults.cardColors(containerColor = Color(0xFFFFF3E0))
                        ) {
                            Column(modifier = Modifier.padding(12.dp)) {
                                Text("$modelo", fontWeight = FontWeight.Bold, fontSize = 14.sp)
                                Text("Actualmente en: $caja ($qty uds)", fontSize = 12.sp, color = Color.Gray)
                            }
                        }
                    }
                    Spacer(modifier = Modifier.height(8.dp))
                    Text("¿Qué deseas hacer?", fontSize = 14.sp, fontWeight = FontWeight.Bold)
                }
            },
            confirmButton = {
                Button(
                    onClick = {
                        showConflictDialog = false
                        // Mover al nuevo contenedor (quitar del anterior)
                        scope.launch(Dispatchers.IO) {
                            for (conflict in conflictItems) {
                                val prodId = conflict.optInt("id_producto", 0)
                                val fromCaja = conflict.optInt("existing_caja_id", 0)
                                val toCaja = selectedContainer?.id_caja ?: 0
                                if (prodId > 0 && toCaja > 0) {
                                    try {
                                        val moveBody = org.json.JSONObject().apply {
                                            put("id_producto", prodId)
                                            put("from_caja_id", fromCaja)
                                            put("to_caja_id", toCaja)
                                            put("cantidad", 1)
                                        }
                                        val moveReq = Request.Builder()
                                            .url("${serverUrl.trimEnd('/')}/api/productos/move-container")
                                            .post(moveBody.toString().toRequestBody("application/json".toMediaType()))
                                            .build()
                                        client.newCall(moveReq).execute().close()
                                    } catch (_: Exception) {}
                                }
                            }
                            withContext(Dispatchers.Main) {
                                Toast.makeText(context, "Productos movidos al nuevo contenedor", Toast.LENGTH_LONG).show()
                                batchQueue = emptyList()
                                showReviewDialog = false
                                updateQueueStats()
                            }
                        }
                    },
                    colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF7C3AED))
                ) { Text("Mover al nuevo contenedor") }
            },
            dismissButton = {
                Row {
                    TextButton(onClick = {
                        // Duplicar: permitir en ambos contenedores
                        showConflictDialog = false
                        Toast.makeText(context, "${pendingSaveItems.size} productos registrados (duplicados)", Toast.LENGTH_LONG).show()
                        batchQueue = emptyList()
                        showReviewDialog = false
                        updateQueueStats()
                    }) { Text("Duplicar") }
                    TextButton(onClick = { showConflictDialog = false }) { Text("Cancelar") }
                }
            }
        )
    }

    // ── Inline barcode scanner ────────────────────────────────────
    // When showCameraPreview is true, capture one photo, scan barcode, return to review
    if (showCameraPreview) {
        LaunchedEffect(Unit) {
            // Close review dialog temporarily
            showReviewDialog = false
            // Trigger single photo capture for barcode scanning
            // The onPhotoCaptured callback will handle barcode detection
            // and call pendingBarcodeCallback with the result
        }
    }
}

// ═══════════════════════════════════════════════════════════════════
//  Subcomponents
// ═══════════════════════════════════════════════════════════════════

@Composable
private fun StatChip(label: String, count: Int, color: Color) {
    Box(modifier = Modifier.background(color.copy(alpha = 0.1f), RoundedCornerShape(8.dp)).padding(horizontal = 10.dp, vertical = 4.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            Text("$count", fontWeight = FontWeight.Black, fontSize = 13.sp, color = color)
            Text(label, fontSize = 9.sp, color = color.copy(alpha = 0.7f))
        }
    }
}

@Composable
private fun CameraViewfinder(
    autoReopenCamera: Boolean,
    isFlashEnabled: Boolean,
    onFlashToggle: (Boolean) -> Unit,
    onPhotoCaptured: (ImageProxy) -> Unit,
    onClose: () -> Unit,
    lifecycleOwner: androidx.lifecycle.LifecycleOwner
) {
    val imageCapture = remember { ImageCapture.Builder().build() }
    var cameraInstance by remember { mutableStateOf<Camera?>(null) }
    val context = LocalContext.current

    LaunchedEffect(isFlashEnabled, cameraInstance) {
        try { cameraInstance?.cameraControl?.enableTorch(isFlashEnabled) } catch (_: Exception) {}
    }

    Box(modifier = Modifier.fillMaxSize().background(Color.Black)) {
        AndroidView(
            factory = { ctx ->
                val previewView = PreviewView(ctx).apply { scaleType = PreviewView.ScaleType.FILL_CENTER }
                val providerFuture = ProcessCameraProvider.getInstance(ctx)
                providerFuture.addListener({
                    try {
                        val provider = providerFuture.get()
                        provider.unbindAll()
                        cameraInstance = provider.bindToLifecycle(
                            lifecycleOwner, CameraSelector.DEFAULT_BACK_CAMERA,
                            Preview.Builder().build().also { it.setSurfaceProvider(previewView.surfaceProvider) },
                            imageCapture
                        )
                    } catch (e: Exception) { Log.e(TAG, "Camera init error", e) }
                }, ContextCompat.getMainExecutor(ctx))
                previewView
            },
            modifier = Modifier.fillMaxSize()
        )

        Box(modifier = Modifier.fillMaxSize().graphicsLayer(alpha = 0.99f).drawWithContent {
            drawContent()
            drawRect(color = Color.Black.copy(alpha = 0.6f))
            val rw = size.width * 0.85f; val rh = rw * 0.6f
            drawRoundRect(Color.Transparent, Offset((size.width - rw) / 2f, (size.height - rh) / 2f), Size(rw, rh), CornerRadius(16f), blendMode = BlendMode.Clear)
            drawRoundRect(Color(0xFFF59E0B), Offset((size.width - rw) / 2f, (size.height - rh) / 2f), Size(rw, rh), CornerRadius(16f), style = Stroke(4f), blendMode = BlendMode.SrcOver)
        })

        Column(modifier = Modifier.align(Alignment.TopCenter).padding(top = 40.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            Text("Alinea la etiqueta en el marco", color = Color.White, fontWeight = FontWeight.Bold, fontSize = 16.sp)
            Text("Se recortará automáticamente", color = Color.LightGray, fontSize = 12.sp)
        }

        Row(
            modifier = Modifier.align(Alignment.BottomCenter).fillMaxWidth().padding(bottom = 40.dp, start = 20.dp, end = 20.dp),
            horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically
        ) {
            IconButton(onClick = onClose, colors = IconButtonDefaults.iconButtonColors(containerColor = Color.Black.copy(alpha = 0.5f))) {
                Icon(Icons.Default.Close, "Cerrar", tint = Color.White)
            }
            Box(
                modifier = Modifier.size(72.dp).background(Color.White, RoundedCornerShape(36.dp)).clickable {
                    imageCapture.takePicture(ContextCompat.getMainExecutor(context), object : ImageCapture.OnImageCapturedCallback() {
                        override fun onCaptureSuccess(image: ImageProxy) { onPhotoCaptured(image) }
                        override fun onError(e: ImageCaptureException) { Log.e(TAG, "Capture failed", e) }
                    })
                },
                contentAlignment = Alignment.Center
            ) {
                Box(modifier = Modifier.size(60.dp).background(Color.White, RoundedCornerShape(30.dp)).border(2.dp, Color.Black, RoundedCornerShape(30.dp)))
            }
            IconButton(
                onClick = { onFlashToggle(!isFlashEnabled) },
                colors = IconButtonDefaults.iconButtonColors(containerColor = if (isFlashEnabled) Color(0xFFF59E0B) else Color.Black.copy(alpha = 0.5f))
            ) { Icon(if (isFlashEnabled) Icons.Default.FlashOn else Icons.Default.FlashOff, "Flash", tint = Color.White) }
        }
    }
}

@Composable
private fun ContainerSelectorDialog(
    cajas: List<Caja>,
    selected: Caja?,
    searchQuery: String,
    onSearchChange: (String) -> Unit,
    onSelect: (Caja) -> Unit,
    onDismiss: () -> Unit
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Selecciona Contenedor", fontWeight = FontWeight.Black, fontSize = 16.sp) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                OutlinedTextField(
                    value = searchQuery, onValueChange = onSearchChange,
                    placeholder = { Text("Buscar nivel o caja...", fontSize = 12.sp) },
                    modifier = Modifier.fillMaxWidth(), singleLine = true
                )
                val filtered = remember(searchQuery, cajas) {
                    cajas.filter {
                        (it.numero_caja.uppercase().startsWith("NIVEL:") || !listOf("SECCION:", "ALMACEN:", "ALMACÉN:", "ALMACÓN:").any { p -> it.numero_caja.uppercase().startsWith(p) }) &&
                        (it.numero_caja.contains(searchQuery, ignoreCase = true) || (it.seccion_nombre?.contains(searchQuery, ignoreCase = true) == true))
                    }
                }
                Box(Modifier.fillMaxWidth().height(250.dp)) {
                    LazyColumn(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        items(filtered) { container ->
                            val cleanName = container.numero_caja.replace("(?i)^NIVEL:\\s*".toRegex(), "").trim()
                            val isNivel = container.numero_caja.uppercase().startsWith("NIVEL:")
                            Card(modifier = Modifier.fillMaxWidth().clickable { onSelect(container) },
                                colors = CardDefaults.cardColors(containerColor = Color(0xFFF8FAFC)), shape = RoundedCornerShape(8.dp)) {
                                Row(modifier = Modifier.padding(12.dp), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                                    Column {
                                        Text(cleanName, fontWeight = FontWeight.Bold, fontSize = 13.sp)
                                        Text(text = if (isNivel) "Nivel" else "Caja · ${container.seccion_nombre ?: "—"}", fontSize = 10.sp, color = Color.Gray)
                                    }
                                    if (selected?.id_caja == container.id_caja) Icon(Icons.Default.Check, null, tint = Color(0xFF7C3AED))
                                }
                            }
                        }
                    }
                }
            }
        },
        confirmButton = { TextButton(onClick = onDismiss) { Text("Cerrar") } }
    )
}

@Composable
private fun ReviewResultsDialog(
    items: List<BatchItem>,
    isSaving: Boolean,
    groupPhotos: Map<String, Uri?>,
    onAssignGroupPhoto: (String) -> Unit,
    onItemEdit: (BatchItem) -> Unit,
    onSave: (List<BatchItem>) -> Unit,
    onReprocess: (BatchItem) -> Unit,
    onScanBarcode: (onResult: (String) -> Unit) -> Unit,
    onDismiss: () -> Unit
) {
    val successItems = items.filter { it.status == BatchItemStatus.SUCCESS }
    Dialog(onDismissRequest = onDismiss) {
        Card(
            modifier = Modifier.fillMaxWidth().fillMaxHeight(0.85f).padding(8.dp),
            shape = RoundedCornerShape(20.dp),
            colors = CardDefaults.cardColors(containerColor = Color.White)
        ) {
            Column(modifier = Modifier.fillMaxSize().padding(16.dp)) {
                // Header
                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                    Column {
                        Text("Revisar Resultados", fontWeight = FontWeight.Black, fontSize = 18.sp)
                        Text("${successItems.size} exitoso(s) · ${items.count { it.status == BatchItemStatus.ERROR }} fallo(s)", fontSize = 11.sp, color = Color.Gray)
                    }
                    TextButton(onClick = onDismiss) { Text("Cerrar") }
                }

                Spacer(Modifier.height(12.dp))

                // Item list
                LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.weight(1f)) {
                    items(items, key = { it.id }) { item ->
                        var editing by remember { mutableStateOf(false) }
                        var editModelo by remember { mutableStateOf(item.modeloGrupo ?: "") }
                        var editColor by remember { mutableStateOf(item.codigoColor ?: "") }
                        var editTalla by remember { mutableStateOf(item.talla ?: "") }
                        var editSku by remember { mutableStateOf(item.sku ?: "") }
                        var editMarca by remember { mutableStateOf(item.marca ?: "") }

                        val isError = item.status == BatchItemStatus.ERROR
                        Card(
                            modifier = Modifier.fillMaxWidth(),
                            colors = CardDefaults.cardColors(
                                containerColor = if (isError) Color(0xFFFEF2F2) else if (editing) Color(0xFFFFF7ED) else Color(0xFFF8FAFC)
                            ),
                            shape = RoundedCornerShape(12.dp),
                            border = if (isError) androidx.compose.foundation.BorderStroke(1.dp, Color(0xFFEF4444)) else null
                        ) {
                            Column(modifier = Modifier.padding(12.dp)) {
                                // Thumbnail + fields row
                                Row(verticalAlignment = Alignment.Top, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                                    // Thumbnail
                                    Box(modifier = Modifier.size(60.dp, 80.dp).clip(RoundedCornerShape(8.dp)).background(Color(0xFFF1F5F9))) {
                                        AsyncImage(model = item.uri, contentDescription = null, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
                                    }

                                    Column(modifier = Modifier.weight(1f)) {
                                        if (isError) {
                                            Text("Fallo", fontWeight = FontWeight.Bold, color = Color(0xFFEF4444), fontSize = 12.sp)
                                            Text(item.errorMessage ?: "", fontSize = 10.sp, color = Color.Gray)
                                            Spacer(Modifier.height(6.dp))
                                            Button(
                                                onClick = { onReprocess(item) },
                                                colors = ButtonDefaults.buttonColors(containerColor = Color(0xFFEF4444)),
                                                contentPadding = PaddingValues(horizontal = 12.dp, vertical = 4.dp)
                                            ) { Icon(Icons.Default.Refresh, null, Modifier.size(14.dp)); Spacer(Modifier.width(4.dp)); Text("Reintentar", fontSize = 10.sp) }
                                        } else if (editing) {
                                            OutlinedTextField(value = editModelo, onValueChange = { editModelo = it }, label = { Text("Modelo", fontSize = 9.sp) }, singleLine = true, modifier = Modifier.fillMaxWidth(), textStyle = LocalTextStyle.current.copy(fontSize = 11.sp))
                                            Spacer(Modifier.height(4.dp))
                                            Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                                                OutlinedTextField(value = editColor, onValueChange = { editColor = it }, label = { Text("Color", fontSize = 9.sp) }, singleLine = true, modifier = Modifier.weight(1f), textStyle = LocalTextStyle.current.copy(fontSize = 11.sp))
                                                OutlinedTextField(value = editTalla, onValueChange = { editTalla = it }, label = { Text("Talla", fontSize = 9.sp) }, singleLine = true, modifier = Modifier.weight(1f), textStyle = LocalTextStyle.current.copy(fontSize = 11.sp))
                                            }
                                            Spacer(Modifier.height(4.dp))
                                            Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                                                OutlinedTextField(value = editMarca, onValueChange = { editMarca = it }, label = { Text("Marca", fontSize = 9.sp) }, singleLine = true, modifier = Modifier.weight(1f), textStyle = LocalTextStyle.current.copy(fontSize = 11.sp))
                                                OutlinedTextField(value = editSku, onValueChange = { editSku = it }, label = { Text("SKU / Código", fontSize = 9.sp) }, singleLine = true, modifier = Modifier.weight(1f), textStyle = LocalTextStyle.current.copy(fontSize = 11.sp))
                                                IconButton(
                                                    onClick = { onScanBarcode { scanned -> editSku = scanned } },
                                                    modifier = Modifier.size(36.dp).align(Alignment.CenterVertically)
                                                ) {
                                                    Icon(Icons.Default.CameraAlt, "Escanear", tint = Color(0xFF7C3AED), modifier = Modifier.size(18.dp))
                                                }
                                            }
                                        } else {
                                            Text(item.modeloGrupo ?: "SIN MODELO", fontWeight = FontWeight.Bold, fontSize = 13.sp)
                                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                                if (!item.codigoColor.isNullOrBlank()) Text("Color: ${item.codigoColor}", fontSize = 11.sp, color = Color.Gray)
                                                if (!item.talla.isNullOrBlank()) Text("Talla: ${item.talla}", fontSize = 11.sp, color = Color.Gray)
                                            }
                                            if (!item.sku.isNullOrBlank()) Text("SKU: ${item.sku}", fontSize = 10.sp, fontFamily = FontFamily.Monospace, color = Color(0xFF7C3AED))
                                            if (!item.marca.isNullOrBlank()) Text("Marca: ${item.marca}", fontSize = 10.sp, color = Color.Gray)
                                            if (item.barcode != null) Text("Código: ${item.barcode}", fontSize = 10.sp, color = Color(0xFF059669))
                                            // OCR source indicator (solo ML Kit on-device)
                                            if (!item.ocrSource.isNullOrBlank()) {
                                                val label = when {
                                                    item.ocrSource.startsWith("mlkit") -> {
                                                        val conf = Regex("""(\d+)""").find(item.ocrSource)?.value ?: "?"
                                                        "ML Kit ($conf%)"
                                                    }
                                                    else -> item.ocrSource
                                                }
                                                val color = when {
                                                    item.ocrSource.startsWith("mlkit") -> Color(0xFF7C3AED)
                                                    else -> Color(0xFF2563EB)
                                                }
                                                Text("Motor: $label", fontSize = 9.sp, color = color)
                                            }
                                        }
                                    }
                                }

                                // Edit toggle
                                if (!isError) {
                                    Row(modifier = Modifier.fillMaxWidth().padding(top = 6.dp), horizontalArrangement = Arrangement.End) {
                                        TextButton(
                                            onClick = {
                                                if (editing) {
                                                    onItemEdit(item.copy(
                                                        modeloGrupo = editModelo.ifBlank { null },
                                                        codigoColor = editColor.ifBlank { null },
                                                        talla = editTalla.ifBlank { null },
                                                        sku = editSku.ifBlank { null },
                                                        marca = editMarca.ifBlank { null }
                                                    ))
                                                }
                                                editing = !editing
                                            },
                                            contentPadding = PaddingValues(horizontal = 8.dp, vertical = 2.dp)
                                        ) {
                                            Icon(if (editing) Icons.Default.Check else Icons.Default.Edit, null, Modifier.size(14.dp))
                                            Spacer(Modifier.width(4.dp))
                                            Text(if (editing) "Guardar" else "Editar", fontSize = 10.sp)
                                        }
                                    }
                                }
                            }
                        }
                    }
                }

                // Group photos section
                val modelGroups = remember(items) {
                    items.filter { it.status == BatchItemStatus.SUCCESS }.groupBy { it.modeloGrupo ?: "SIN MODELO" }
                }
                if (modelGroups.isNotEmpty()) {
                    Text("Fotos Grupales por Modelo", fontWeight = FontWeight.Bold, fontSize = 13.sp, modifier = Modifier.padding(top = 8.dp))
                    LazyColumn(modifier = Modifier.height(150.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        modelGroups.forEach { (modelName, group) ->
                            item {
                                Card(modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(8.dp), colors = CardDefaults.cardColors(containerColor = Color(0xFFF8FAFC))) {
                                    Row(modifier = Modifier.padding(8.dp), verticalAlignment = Alignment.CenterVertically) {
                                        // Thumbnail if photo assigned
                                        Box(modifier = Modifier.size(36.dp).clip(RoundedCornerShape(6.dp)).background(Color(0xFFF1F5F9))) {
                                            val photoUri = groupPhotos[modelName]
                                            if (photoUri != null) {
                                                AsyncImage(model = photoUri, contentDescription = null, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
                                            } else {
                                                Icon(Icons.Default.Image, null, Modifier.size(20.dp).align(Alignment.Center), tint = Color.LightGray)
                                            }
                                        }
                                        Spacer(Modifier.width(8.dp))
                                        Column(modifier = Modifier.weight(1f)) {
                                            Text(modelName, fontWeight = FontWeight.Bold, fontSize = 11.sp, maxLines = 1)
                                            val totalQty = group.sumOf { it.quantity }
                                            Text("${group.size} items · Total: $totalQty", fontSize = 10.sp, color = Color.Gray)
                                        }
                                        FilledTonalButton(
                                            onClick = { onAssignGroupPhoto(modelName) },
                                            contentPadding = PaddingValues(horizontal = 8.dp, vertical = 2.dp),
                                            modifier = Modifier.height(28.dp)
                                        ) { Icon(if (groupPhotos[modelName] != null) Icons.Default.CheckCircle else Icons.Default.AddAPhoto, null, Modifier.size(14.dp)); Spacer(Modifier.width(4.dp)); Text(if (groupPhotos[modelName] != null) "Lista" else "Foto", fontSize = 9.sp) }
                                    }
                                }
                            }
                        }
                    }
                }

                // Save button
                Button(
                    onClick = { onSave(items) },
                    enabled = !isSaving && successItems.isNotEmpty(),
                    modifier = Modifier.fillMaxWidth().height(48.dp),
                    colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF7C3AED)),
                    shape = RoundedCornerShape(14.dp)
                ) {
                    if (isSaving) {
                        CircularProgressIndicator(Modifier.size(20.dp), color = Color.White, strokeWidth = 2.dp)
                    } else {
                        Icon(Icons.Default.Save, null, Modifier.size(18.dp))
                        Spacer(Modifier.width(8.dp))
                        Text("Confirmar y Guardar (${successItems.size})", fontWeight = FontWeight.Bold)
                    }
                }
            }
        }
    }
}

@Composable
private fun OfflineSyncBanner(
    count: Int,
    isSyncing: Boolean,
    onSync: () -> Unit
) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = Color(0xFFFEF3C7)),
        shape = RoundedCornerShape(12.dp),
        border = androidx.compose.foundation.BorderStroke(1.dp, Color(0xFFF59E0B))
    ) {
        Row(modifier = Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween) {
            Row(modifier = Modifier.weight(1f), verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Default.WifiOff, null, tint = Color(0xFFD97706))
                Spacer(Modifier.width(8.dp))
                Column {
                    Text("Lotes pendientes offline: $count", fontWeight = FontWeight.Bold, fontSize = 12.sp, color = Color(0xFF92400E))
                    Text("Hay fotos procesadas guardadas localmente.", fontSize = 10.sp, color = Color(0xFFB45309))
                }
            }
            Button(
                onClick = onSync, enabled = !isSyncing,
                colors = ButtonDefaults.buttonColors(containerColor = Color(0xFFD97706)),
                contentPadding = PaddingValues(horizontal = 12.dp, vertical = 6.dp),
                shape = RoundedCornerShape(8.dp)
            ) {
                if (isSyncing) CircularProgressIndicator(color = Color.White, modifier = Modifier.size(14.dp))
                else Text("Sincronizar", fontSize = 11.sp, fontWeight = FontWeight.Bold)
            }
        }
    }
}

// ═══════════════════════════════════════════════════════════════════
//  Offline Queue Manager (preserved from original)
// ═══════════════════════════════════════════════════════════════════

object OfflineQueueManager {
    private const val FILE_NAME = "offline_batch_queue.json"

    data class OfflineBatch(
        val id: String = UUID.randomUUID().toString(),
        val idCaja: Int?,
        val idZonaNivel: Int?,
        val products: List<BatchOcrProduct>,
        val timestamp: Long = System.currentTimeMillis()
    )

    fun saveBatchToQueue(context: Context, batch: OfflineBatch) {
        val file = File(context.filesDir, FILE_NAME)
        val currentQueue = getQueue(context).toMutableList()
        currentQueue.add(batch)
        file.writeText(Gson().toJson(currentQueue))
    }

    fun getQueue(context: Context): List<OfflineBatch> {
        val file = File(context.filesDir, FILE_NAME)
        if (!file.exists()) return emptyList()
        return try {
            val type = object : TypeToken<List<OfflineBatch>>() {}.type
            Gson().fromJson(file.readText(), type) ?: emptyList()
        } catch (e: Exception) { emptyList() }
    }

    fun removeBatch(context: Context, batchId: String) {
        val file = File(context.filesDir, FILE_NAME)
        val currentQueue = getQueue(context).filter { it.id != batchId }
        file.writeText(Gson().toJson(currentQueue))
    }
}

fun compareTallas(t1: String?, t2: String?): Int {
    val clean1 = t1?.uppercase()?.trim() ?: ""
    val clean2 = t2?.uppercase()?.trim() ?: ""
    if (clean1 == clean2) return 0
    if (clean1.isEmpty()) return 1
    if (clean2.isEmpty()) return -1
    val listTallas = listOf("XXS", "XS", "S", "M", "L", "XL", "XXL", "XXXL", "XXXXL")
    val idx1 = listTallas.indexOf(clean1)
    val idx2 = listTallas.indexOf(clean2)
    if (idx1 != -1 && idx2 != -1) return idx1.compareTo(idx2)
    if (idx1 != -1) return -1
    if (idx2 != -1) return 1
    val num1 = clean1.toIntOrNull(); val num2 = clean2.toIntOrNull()
    if (num1 != null && num2 != null) return num1.compareTo(num2)
    if (num1 != null) return -1
    if (num2 != null) return 1
    return clean1.compareTo(clean2)
}
