package com.inventorio.alpha

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.net.Uri
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
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import androidx.lifecycle.lifecycleScope
import com.google.gson.Gson
import com.google.mlkit.vision.barcode.BarcodeScanning
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.barcode.BarcodeScannerOptions
import androidx.compose.ui.window.Dialog
import com.google.mlkit.vision.common.InputImage
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.File
import java.util.concurrent.TimeUnit
import coil.compose.AsyncImage
import androidx.compose.ui.layout.ContentScale
import okhttp3.MultipartBody
import com.google.gson.reflect.TypeToken
import androidx.compose.ui.focus.onFocusChanged

data class VariationItem(val sku: String, val talla: String, val cantidad: Int)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ScannerView(
    client: OkHttpClient,
    serverUrl: String,
    activeCaja: Caja?,
    cajas: List<Caja>,
    onCajasUpdated: () -> Unit,
    onCajaSelected: (Caja) -> Unit,
    ocrEngine: LabelOcrEngine? = null
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val lifecycleOwner = LocalLifecycleOwner.current

    // Permissions state
    var hasCameraPermission by remember {
        mutableStateOf(
            ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED
        )
    }

    val launcher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.RequestPermission(),
        onResult = { granted -> hasCameraPermission = granted }
    )

    // Scanner States
    var activeMode by remember { mutableStateOf("caja") } // "caja", "nivel", "seccion", "almacen"
    var selectedContainerId by remember { mutableStateOf<Int?>(null) }
    var isScannerActive by remember { mutableStateOf(false) }
    var scannedResult by remember { mutableStateOf<String?>(null) }
    var isChecking by remember { mutableStateOf(false) }
    
    // Manual Input
    var manualCode by remember { mutableStateOf("") }
    
    // UI Dialog States
    var showQtyDialog by remember { mutableStateOf(false) }
    var verificationResult by remember { mutableStateOf<VerificationResult?>(null) }
    var qtyValue by remember { mutableStateOf("1") }
    var isAssigning by remember { mutableStateOf(false) }

    // Quick Register Dialog States
    var showQuickRegister by remember { mutableStateOf(false) }
    var qrSku by remember { mutableStateOf("") }
    var qrMarca by remember { mutableStateOf("") }
    var qrTalla by remember { mutableStateOf("") }
    var qrTemporada by remember { mutableStateOf("") }
    var qrTipo by remember { mutableStateOf("") }
    var qrModelGroup by remember { mutableStateOf("") }
    var isRegistering by remember { mutableStateOf(false) }

    var scanTargetMode by remember { mutableStateOf("product") } // "product" or "box"
    var brandsList by remember { mutableStateOf<List<String>>(emptyList()) }
    var typesList by remember { mutableStateOf<List<String>>(emptyList()) }
    var seasonsList by remember { mutableStateOf<List<String>>(emptyList()) }

    var isGroupMode by remember { mutableStateOf(false) }
    var variations by remember { mutableStateOf(listOf(VariationItem("", "", 1))) }
    var productPhotoUri by remember { mutableStateOf<Uri?>(null) }
    var tempProductFile by remember { mutableStateOf<File?>(null) }

    LaunchedEffect(Unit) {
        scope.launch(Dispatchers.IO) {
            try {
                val base = serverUrl.trimEnd('/')
                // Fetch Seasons
                val seasonsResp = client.newCall(Request.Builder().url("$base/api/conceptos/temporadas").build()).execute()
                if (seasonsResp.isSuccessful) {
                    val body = seasonsResp.body?.string() ?: "[]"
                    val parsed = Gson().fromJson(body, Array::class.java).map {
                        if (it is Map<*, *>) (it["nombre"] ?: it["temporada"] ?: "").toString()
                        else it.toString()
                    }.filter { it.isNotBlank() }
                    withContext(Dispatchers.Main) { seasonsList = parsed }
                }
                // Fetch Brands
                val brandsResp = client.newCall(Request.Builder().url("$base/api/conceptos/marcas").build()).execute()
                if (brandsResp.isSuccessful) {
                    val body = brandsResp.body?.string() ?: "[]"
                    val parsed = Gson().fromJson(body, Array::class.java).map {
                        if (it is Map<*, *>) (it["nombre"] ?: "").toString()
                        else it.toString()
                    }.filter { it.isNotBlank() }
                    withContext(Dispatchers.Main) { brandsList = parsed }
                }
                // Fetch Types
                val typesResp = client.newCall(Request.Builder().url("$base/api/conceptos/tipos").build()).execute()
                if (typesResp.isSuccessful) {
                    val body = typesResp.body?.string() ?: "[]"
                    val parsed = Gson().fromJson(body, Array::class.java).map {
                        if (it is Map<*, *>) (it["nombre"] ?: "").toString()
                        else it.toString()
                    }.filter { it.isNotBlank() }
                    withContext(Dispatchers.Main) { typesList = parsed }
                }
            } catch (e: Exception) {
                Log.e("ScannerView", "Error fetching concepts options", e)
            }
        }
    }

    // OCR inside Quick Register
    var ocrProcessing by remember { mutableStateOf(false) }
    var tempCameraFile by remember { mutableStateOf<File?>(null) }
    var cameraPhotoUri by remember { mutableStateOf<Uri?>(null) }
    var ocrSource by remember { mutableStateOf<String?>(null) }  // "local" | "servidor" | null
    var showModelDownloadDialog by remember { mutableStateOf(false) }

    // Camera launcher for OCR — usa LabelOcrEngine (local + fallback servidor)
    val ocrCameraLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.TakePicture()
    ) { success: Boolean ->
        if (success && cameraPhotoUri != null) {
            ocrProcessing = true
            ocrSource = null
            scope.launch(Dispatchers.IO) {
                try {
                    val bitmap = if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.P) {
                        android.graphics.ImageDecoder.decodeBitmap(
                            android.graphics.ImageDecoder.createSource(context.contentResolver, cameraPhotoUri!!)
                        ) { decoder, _, _ -> decoder.isMutableRequired = true }
                    } else {
                        @Suppress("DEPRECATION")
                        android.provider.MediaStore.Images.Media.getBitmap(context.contentResolver, cameraPhotoUri!!)
                    }

                    val result = if (ocrEngine != null) {
                        ocrEngine.analyze(bitmap)
                    } else {
                        // Fallback directo al servidor si no hay engine
                        LabelOcrEngine(context, client, serverUrl).analyzeRemote(bitmap)
                    }

                    withContext(Dispatchers.Main) {
                        ocrProcessing = false
                        if (result.hasAnyData) {
                            result.sku?.let { qrSku = it }
                            result.marca?.let { qrMarca = it }
                            result.talla?.let { qrTalla = it }
                            result.modeloGrupo?.let { qrModelGroup = it }
                            ocrSource = result.source
                            val sourceLabel = if (result.source == "local") "modelo local ⚡" else "servidor ☁️"
                            Toast.makeText(context, "Datos extraídos via $sourceLabel", Toast.LENGTH_SHORT).show()
                        } else {
                            ocrSource = result.source
                            Toast.makeText(context, "No se detectaron datos en la etiqueta", Toast.LENGTH_SHORT).show()
                        }
                    }
                } catch (e: Exception) {
                    withContext(Dispatchers.Main) {
                        ocrProcessing = false
                        Toast.makeText(context, "Error al procesar imagen: ${e.message}", Toast.LENGTH_SHORT).show()
                    }
                }
            }
        }
    }

    val productCameraLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.TakePicture()
    ) { success: Boolean ->
        if (!success) {
            productPhotoUri = null
            tempProductFile = null
        }
    }

    // Initialize/Resolve target container
    val resolvedTargetCaja = remember(activeMode, activeCaja, selectedContainerId, cajas) {
        when (activeMode) {
            "caja" -> activeCaja
            else -> cajas.find { it.id_caja == selectedContainerId }
        }
    }

    // Dropdown options for container selection based on mode
    val containerOptions = remember(activeMode, cajas) {
        when (activeMode) {
            "nivel" -> cajas.filter { it.numero_caja.startsWith("NIVEL:") }
            "seccion" -> cajas.filter { it.numero_caja.startsWith("SECCIÓN:") }
            "almacen" -> cajas.filter { it.numero_caja.startsWith("ALMACÉN:") }
            else -> emptyList()
        }
    }

    LaunchedEffect(activeMode) {
        selectedContainerId = null
    }

    // Trigger code verification
    val verifyCode: (String) -> Unit = { code ->
        val targetBox = resolvedTargetCaja
        if (targetBox == null) {
            Toast.makeText(context, "Selecciona un contenedor primero", Toast.LENGTH_LONG).show()
        } else {
            isChecking = true
            isScannerActive = false
            scannedResult = code
            scope.launch(Dispatchers.IO) {
                try {
                    val url = "${serverUrl.trimEnd('/')}/api/verificar/${code.trim()}"
                    val request = Request.Builder().url(url).build()
                    client.newCall(request).execute().use { response ->
                        val bodyText = response.body?.string() ?: ""
                        if (response.isSuccessful) {
                            val result = Gson().fromJson(bodyText, VerificationResult::class.java)
                            withContext(Dispatchers.Main) {
                                verificationResult = result
                                if (result.exists) {
                                    qtyValue = "1"
                                    showQtyDialog = true
                                } else {
                                    // Set fields and prompt Quick Register
                                    qrSku = code
                                    qrMarca = ""
                                    qrTalla = ""
                                    qrTemporada = ""
                                    qrTipo = ""
                                    qrModelGroup = ""
                                    isGroupMode = false
                                    variations = listOf(VariationItem("", "", 1))
                                    productPhotoUri = null
                                    tempProductFile = null
                                    showQuickRegister = true
                                    Toast.makeText(context, "Producto no registrado. Inicia registro rápido.", Toast.LENGTH_LONG).show()
                                }
                            }
                        } else {
                            withContext(Dispatchers.Main) {
                                Toast.makeText(context, "Error del servidor: ${response.code}", Toast.LENGTH_LONG).show()
                            }
                        }
                    }
                } catch (e: Exception) {
                    withContext(Dispatchers.Main) {
                        Toast.makeText(context, "Error de conexión: ${e.message}", Toast.LENGTH_LONG).show()
                    }
                } finally {
                    withContext(Dispatchers.Main) {
                        isChecking = false
                    }
                }
            }
        }
    }

    val handleScannedCode: (String) -> Unit = { code ->
        if (scanTargetMode == "box") {
            val codeClean = code.trim().uppercase()
            val match = cajas.find { it.sku?.uppercase() == codeClean || it.numero_caja.uppercase() == codeClean }
            if (match != null) {
                onCajaSelected(match)
                isScannerActive = false
                scanTargetMode = "product"
                Toast.makeText(context, "Caja seleccionada: ${match.numero_caja}", Toast.LENGTH_SHORT).show()
            } else {
                scope.launch(Dispatchers.IO) {
                    try {
                        val url = "${serverUrl.trimEnd('/')}/api/cajas"
                        val request = Request.Builder().url(url).build()
                        client.newCall(request).execute().use { response ->
                            if (response.isSuccessful) {
                                val bodyText = response.body?.string() ?: "[]"
                                val list: List<Caja> = Gson().fromJson(bodyText, object : TypeToken<List<Caja>>() {}.type)
                                val freshMatch = list.find { it.sku?.uppercase() == codeClean || it.numero_caja.uppercase() == codeClean }
                                withContext(Dispatchers.Main) {
                                    if (freshMatch != null) {
                                        onCajaSelected(freshMatch)
                                        onCajasUpdated()
                                        isScannerActive = false
                                        scanTargetMode = "product"
                                        Toast.makeText(context, "Caja seleccionada: ${freshMatch.numero_caja}", Toast.LENGTH_SHORT).show()
                                    } else {
                                        Toast.makeText(context, "No se encontró caja con código: $code", Toast.LENGTH_LONG).show()
                                    }
                                }
                            }
                        }
                    } catch (e: Exception) {
                        withContext(Dispatchers.Main) {
                            Toast.makeText(context, "No se encontró caja: $code", Toast.LENGTH_SHORT).show()
                        }
                    }
                }
            }
        } else {
            verifyCode(code)
        }
    }

    val checkSkuExists: (String) -> Unit = { sku ->
        if (sku.isNotBlank()) {
            scope.launch(Dispatchers.IO) {
                try {
                    val url = "${serverUrl.trimEnd('/')}/api/productos?exactSku=${sku.trim()}"
                    val request = Request.Builder().url(url).build()
                    client.newCall(request).execute().use { response ->
                        if (response.isSuccessful) {
                            val bodyText = response.body?.string() ?: "[]"
                            val typeToken = object : TypeToken<List<Producto>>() {}.type
                            val list: List<Producto> = Gson().fromJson(bodyText, typeToken)
                            if (list.isNotEmpty()) {
                                val match = list.first()
                                withContext(Dispatchers.Main) {
                                    if (qrModelGroup.isBlank() && !match.modelo_grupo.isNullOrBlank()) qrModelGroup = match.modelo_grupo!!
                                    if (!match.marca_sub.isNullOrBlank()) qrMarca = match.marca_sub!!
                                    if (!match.tipo.isNullOrBlank()) qrTipo = match.tipo!!
                                    if (!match.temporada.isNullOrBlank()) qrTemporada = match.temporada!!
                                    Toast.makeText(context, "Datos autocompletados desde base de datos (SKU: $sku)", Toast.LENGTH_SHORT).show()
                                }
                            }
                        }
                    }
                } catch (e: Exception) {
                    Log.e("ScannerView", "Error checking SKU", e)
                }
            }
        }
    }

    val checkModelExists: (String) -> Unit = { model ->
        if (model.isNotBlank()) {
            scope.launch(Dispatchers.IO) {
                try {
                    val url = "${serverUrl.trimEnd('/')}/api/productos?modelo_grupo=${model.trim()}"
                    val request = Request.Builder().url(url).build()
                    client.newCall(request).execute().use { response ->
                        if (response.isSuccessful) {
                            val bodyText = response.body?.string() ?: "[]"
                            val typeToken = object : TypeToken<List<Producto>>() {}.type
                            val list: List<Producto> = Gson().fromJson(bodyText, typeToken)
                            if (list.isNotEmpty()) {
                                val match = list.first()
                                withContext(Dispatchers.Main) {
                                    if (!match.marca_sub.isNullOrBlank()) qrMarca = match.marca_sub!!
                                    if (!match.tipo.isNullOrBlank()) qrTipo = match.tipo!!
                                    if (!match.temporada.isNullOrBlank()) qrTemporada = match.temporada!!
                                    Toast.makeText(context, "Datos autocompletados desde base de datos (Modelo: $model)", Toast.LENGTH_SHORT).show()
                                }
                            }
                        }
                    }
                } catch (e: Exception) {
                    Log.e("ScannerView", "Error checking Model", e)
                }
            }
        }
    }

    // Save product placement
    val assignProduct: (Int, Int) -> Unit = { idProducto, quantity ->
        val targetBox = resolvedTargetCaja
        if (targetBox != null) {
            isAssigning = true
            scope.launch(Dispatchers.IO) {
                try {
                    val url = "${serverUrl.trimEnd('/')}/api/cajas/${targetBox.id_caja}/asignar"
                    val json = """{"id_producto": $idProducto, "force": true, "cantidad": $quantity}"""
                    val request = Request.Builder()
                        .url(url)
                        .post(json.toRequestBody("application/json".toMediaType()))
                        .build()
                    client.newCall(request).execute().use { response ->
                        withContext(Dispatchers.Main) {
                            isAssigning = false
                            if (response.isSuccessful) {
                                showQtyDialog = false
                                scannedResult = null
                                verificationResult = null
                                onCajasUpdated()
                                Toast.makeText(context, "Asignado correctamente a ${targetBox.numero_caja}", Toast.LENGTH_SHORT).show()
                            } else {
                                Toast.makeText(context, "Error al asignar: ${response.code}", Toast.LENGTH_LONG).show()
                            }
                        }
                    }
                } catch (e: Exception) {
                    withContext(Dispatchers.Main) {
                        isAssigning = false
                        Toast.makeText(context, "Error: ${e.message}", Toast.LENGTH_LONG).show()
                    }
                }
            }
        }
    }

    // Quick Register & Assign
    val registerAndAssign: () -> Unit = {
        if (qrModelGroup.isBlank()) {
            Toast.makeText(context, "Modelo de Grupo es requerido", Toast.LENGTH_SHORT).show()
        } else if (!isGroupMode && qrSku.isBlank()) {
            Toast.makeText(context, "SKU es requerido", Toast.LENGTH_SHORT).show()
        } else if (isGroupMode && variations.any { it.sku.isBlank() || it.talla.isBlank() }) {
            Toast.makeText(context, "Variaciones deben tener SKU y Talla", Toast.LENGTH_SHORT).show()
        } else {
            isRegistering = true
            scope.launch(Dispatchers.IO) {
                try {
                    val base = serverUrl.trimEnd('/')
                    val requestBody = MultipartBody.Builder().setType(MultipartBody.FORM)

                    // Attach photo if captured
                    if (productPhotoUri != null) {
                        try {
                            val inputStream = context.contentResolver.openInputStream(productPhotoUri!!)
                            val bytes = inputStream?.readBytes()
                            inputStream?.close()
                            if (bytes != null) {
                                requestBody.addFormDataPart(
                                    "foto",
                                    "producto.jpg",
                                    bytes.toRequestBody("image/jpeg".toMediaType())
                                )
                            }
                        } catch (e: Exception) {
                            Log.e("ScannerView", "Error reading photo bytes", e)
                        }
                    }

                    val request = if (isGroupMode) {
                        // Group Registration Mode
                        requestBody.addFormDataPart("modelo_grupo", qrModelGroup.trim())
                        requestBody.addFormDataPart("temporada", qrTemporada.trim())
                        requestBody.addFormDataPart("tipo", qrTipo.trim())
                        requestBody.addFormDataPart("marca_sub", qrMarca.trim())

                        val variationsList = variations.map {
                            mapOf("sku" to it.sku.trim(), "talla" to it.talla.trim(), "cantidad" to it.cantidad)
                        }
                        val variationsJson = Gson().toJson(variationsList)
                        requestBody.addFormDataPart("variaciones", variationsJson)

                        val targetBox = resolvedTargetCaja
                        if (targetBox != null) {
                            requestBody.addFormDataPart("id_caja", targetBox.id_caja.toString())
                        }

                        Request.Builder()
                            .url("$base/api/productos/grupo")
                            .post(requestBody.build())
                            .build()
                    } else {
                        // Single Registration Mode
                        requestBody.addFormDataPart("sku", qrSku.trim())
                        requestBody.addFormDataPart("ean_13", qrSku.trim())
                        requestBody.addFormDataPart("talla", qrTalla.trim())
                        requestBody.addFormDataPart("temporada", qrTemporada.trim())
                        requestBody.addFormDataPart("tipo", qrTipo.trim())
                        requestBody.addFormDataPart("marca_sub", qrMarca.trim())
                        requestBody.addFormDataPart("modelo_grupo", qrModelGroup.trim())
                        requestBody.addFormDataPart("activo", "true")

                        Request.Builder()
                            .url("$base/api/productos")
                            .post(requestBody.build())
                            .build()
                    }

                    client.newCall(request).execute().use { response ->
                        val bodyText = response.body?.string() ?: ""
                        if (response.isSuccessful) {
                            withContext(Dispatchers.Main) {
                                showQuickRegister = false
                                productPhotoUri = null
                                tempProductFile = null
                                if (isGroupMode) {
                                    onCajasUpdated()
                                    Toast.makeText(context, "Grupo de productos registrado y asignado", Toast.LENGTH_LONG).show()
                                } else {
                                    val newProd = Gson().fromJson(bodyText, Producto::class.java)
                                    // Assign single product to box
                                    assignProduct(newProd.id_producto, 1)
                                }
                            }
                        } else {
                            withContext(Dispatchers.Main) {
                                Toast.makeText(context, "Error al registrar: $bodyText", Toast.LENGTH_LONG).show()
                            }
                        }
                    }
                } catch (e: Exception) {
                    withContext(Dispatchers.Main) {
                        Toast.makeText(context, "Error de red: ${e.message}", Toast.LENGTH_LONG).show()
                    }
                } finally {
                    withContext(Dispatchers.Main) {
                        isRegistering = false
                    }
                }
            }
        }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(16.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(14.dp)
    ) {
        // Container Target Card
        Card(
            modifier = Modifier.fillMaxWidth(),
            colors = CardDefaults.cardColors(containerColor = Color.White),
            shape = RoundedCornerShape(20.dp)
        ) {
            Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text(
                    text = "Configuración del Destino",
                    fontWeight = FontWeight.Black,
                    fontSize = 14.sp,
                    color = Color(0xFF0F172A)
                )

                // Tab Selector for active mode
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .background(Color(0xFFF1F5F9), RoundedCornerShape(10.dp))
                        .padding(3.dp),
                    horizontalArrangement = Arrangement.spacedBy(4.dp)
                ) {
                    listOf("caja" to "Cajas", "nivel" to "Niveles", "seccion" to "Secciones", "almacen" to "Almacenes").forEach { (mode, label) ->
                        val active = activeMode == mode
                        Box(
                            modifier = Modifier
                                .weight(1f)
                                .clip(RoundedCornerShape(8.dp))
                                .background(if (active) Color.White else Color.Transparent)
                                .clickable { activeMode = mode }
                                .padding(vertical = 8.dp),
                            contentAlignment = Alignment.Center
                        ) {
                            Text(
                                text = label,
                                fontSize = 10.sp,
                                fontWeight = FontWeight.Bold,
                                color = if (active) Color(0xFF0F172A) else Color.Gray
                            )
                        }
                    }
                }

                // Selection UI depending on activeMode
                if (activeMode == "caja") {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            modifier = Modifier.weight(1f)
                        ) {
                            Icon(Icons.Default.Inbox, contentDescription = "Caja", tint = Color(0xFFF59E0B), modifier = Modifier.size(20.dp))
                            Spacer(modifier = Modifier.width(8.dp))
                            Text(
                                text = if (activeCaja != null) "Caja activa: ${activeCaja.numero_caja}" else "Ninguna caja seleccionada (Selecciónala en la pestaña Cajas)",
                                fontSize = 12.sp,
                                fontWeight = FontWeight.Bold,
                                color = if (activeCaja != null) Color(0xFF1E293B) else Color.Red
                            )
                        }
                        IconButton(
                            onClick = {
                                scanTargetMode = "box"
                                isScannerActive = true
                            },
                            modifier = Modifier.size(32.dp)
                        ) {
                            Icon(
                                Icons.Default.QrCodeScanner,
                                contentDescription = "Escanear Código de Caja",
                                tint = Color(0xFFF59E0B),
                                modifier = Modifier.size(20.dp)
                            )
                        }
                    }
                } else {
                    var expandedDropdown by remember { mutableStateOf(false) }
                    Box(modifier = Modifier.fillMaxWidth()) {
                        OutlinedButton(
                            onClick = { expandedDropdown = true },
                            modifier = Modifier.fillMaxWidth(),
                            shape = RoundedCornerShape(10.dp)
                        ) {
                            Text(
                                text = resolvedTargetCaja?.numero_caja ?: "Selecciona contenedor...",
                                fontSize = 12.sp,
                                fontWeight = FontWeight.Bold,
                                color = Color(0xFF1E293B)
                            )
                        }

                        DropdownMenu(
                            expanded = expandedDropdown,
                            onDismissRequest = { expandedDropdown = false }
                        ) {
                            containerOptions.forEach { opt ->
                                DropdownMenuItem(
                                    text = { Text(opt.numero_caja) },
                                    onClick = {
                                        selectedContainerId = opt.id_caja
                                        expandedDropdown = false
                                    }
                                )
                            }
                        }
                    }
                }
            }
        }

        // Camera / Input Action Card
        Card(
            modifier = Modifier
                .fillMaxWidth()
                .weight(1f),
            colors = CardDefaults.cardColors(containerColor = Color.White),
            shape = RoundedCornerShape(20.dp)
        ) {
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(16.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Center
            ) {
                if (isScannerActive) {
                    if (hasCameraPermission) {
                        Box(
                            modifier = Modifier
                                .fillMaxWidth()
                                .weight(1f)
                                .clip(RoundedCornerShape(14.dp))
                                .border(2.dp, Color(0xFFF59E0B), RoundedCornerShape(14.dp))
                        ) {
                            AndroidView(
                                factory = { ctx ->
                                    val previewView = PreviewView(ctx).apply {
                                        scaleType = PreviewView.ScaleType.FILL_CENTER
                                    }
                                    val cameraProviderFuture = ProcessCameraProvider.getInstance(ctx)
                                    cameraProviderFuture.addListener({
                                        val cameraProvider = cameraProviderFuture.get()
                                        val preview = Preview.Builder().build().also {
                                            it.setSurfaceProvider(previewView.surfaceProvider)
                                        }

                                        val imageAnalysis = ImageAnalysis.Builder()
                                            .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                                            .build()
                                            .also {
                                                it.setAnalyzer(
                                                    ContextCompat.getMainExecutor(ctx),
                                                    BarcodeAnalyzer { code ->
                                                        handleScannedCode(code)
                                                    }
                                                )
                                            }

                                        try {
                                            cameraProvider.unbindAll()
                                            cameraProvider.bindToLifecycle(
                                                lifecycleOwner,
                                                CameraSelector.DEFAULT_BACK_CAMERA,
                                                preview,
                                                imageAnalysis
                                            )
                                        } catch (exc: Exception) {
                                            Log.e("CameraScanner", "Use case binding failed", exc)
                                        }
                                    }, ContextCompat.getMainExecutor(ctx))
                                    previewView
                                },
                                modifier = Modifier.fillMaxSize()
                            )

                            // Close scanner overlay button
                            Box(
                                modifier = Modifier
                                    .align(Alignment.TopEnd)
                                    .padding(10.dp)
                            ) {
                                IconButton(
                                    onClick = {
                                        isScannerActive = false
                                        scanTargetMode = "product"
                                    },
                                    colors = IconButtonDefaults.iconButtonColors(containerColor = Color.Black.copy(alpha = 0.5f))
                                ) {
                                    Icon(Icons.Default.Close, contentDescription = "Cerrar", tint = Color.White)
                                }
                            }
                        }
                    } else {
                        // Prompt Permission
                        Button(
                            onClick = { launcher.launch(Manifest.permission.CAMERA) },
                            colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF0F172A)),
                            shape = RoundedCornerShape(10.dp)
                        ) {
                            Text("Otorgar permiso de cámara", fontSize = 12.sp, fontWeight = FontWeight.Bold)
                        }
                    }
                } else {
                    // Idle state showing Barcode/Manual prompt
                    Column(
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.spacedBy(16.dp),
                        modifier = Modifier.padding(20.dp)
                    ) {
                        Icon(Icons.Default.QrCodeScanner, contentDescription = "Scanner", tint = Color.Gray, modifier = Modifier.size(54.dp))
                        Text(
                            text = if (scanTargetMode == "box") "Escanea Código de Contenedor / Caja" else "Escanea Código de Barras",
                            fontSize = 16.sp,
                            fontWeight = FontWeight.Black,
                            color = Color(0xFF0F172A)
                        )
                        Text(
                            text = "Apunta la cámara al código de barras del producto (EAN-13, Code-128, etc) para asignarlo al contenedor.",
                            fontSize = 11.sp,
                            color = Color.Gray,
                            textAlign = TextAlign.Center
                        )

                        Button(
                            onClick = {
                                if (resolvedTargetCaja == null) {
                                    Toast.makeText(context, "Selecciona un contenedor primero", Toast.LENGTH_LONG).show()
                                } else {
                                    isScannerActive = true
                                }
                            },
                            colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF0F172A)),
                            shape = RoundedCornerShape(12.dp),
                            modifier = Modifier.fillMaxWidth()
                        ) {
                            Icon(Icons.Default.CameraAlt, contentDescription = "Scanner")
                            Spacer(modifier = Modifier.width(8.dp))
                            Text("Iniciar Cámara", fontSize = 12.sp, fontWeight = FontWeight.Bold)
                        }

                        HorizontalDivider(color = Color(0xFFF1F5F9), thickness = 1.dp)

                        // Manual Code Entry Form
                        Column(verticalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.fillMaxWidth()) {
                            Text("Entrada Manual", fontSize = 11.sp, fontWeight = FontWeight.Bold, color = Color.Gray)
                            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                OutlinedTextField(
                                    value = manualCode,
                                    onValueChange = { manualCode = it },
                                    modifier = Modifier.weight(1f),
                                    placeholder = { Text("Escribe SKU o EAN...") },
                                    singleLine = true,
                                    textStyle = LocalTextStyle.current.copy(fontSize = 12.sp)
                                )
                                Button(
                                    onClick = {
                                        if (manualCode.isNotBlank()) {
                                            verifyCode(manualCode)
                                            manualCode = ""
                                        }
                                    },
                                    colors = ButtonDefaults.buttonColors(containerColor = Color(0xFFF59E0B)),
                                    shape = RoundedCornerShape(10.dp),
                                    modifier = Modifier.height(54.dp)
                                ) {
                                    Icon(Icons.Default.ArrowForward, contentDescription = "Enviar")
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    // --- DIALOGS ---

    // 1. Quantity Dialog (Assign to box)
    if (showQtyDialog && verificationResult?.product != null) {
        val prod = verificationResult!!.product!!
        AlertDialog(
            onDismissRequest = { showQtyDialog = false },
            title = {
                Text(
                    text = "Asignar a Contenedor",
                    fontWeight = FontWeight.Black,
                    fontSize = 16.sp
                )
            },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Text(
                        text = "SKU: ${prod.sku}",
                        fontWeight = FontWeight.Bold,
                        fontSize = 13.sp,
                        color = Color(0xFF0F172A)
                    )
                    Text(
                        text = "Detalle: Marca ${prod.marca_sub ?: "N/D"} | Talla ${prod.talla ?: "N/D"}",
                        fontSize = 11.sp,
                        color = Color.Gray
                    )
                    OutlinedTextField(
                        value = qtyValue,
                        onValueChange = { qtyValue = it },
                        label = { Text("Cantidad a Ingresar") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth()
                    )
                }
            },
            confirmButton = {
                Button(
                    onClick = {
                        val count = qtyValue.toIntOrNull() ?: 1
                        assignProduct(prod.id_producto, count)
                    },
                    colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF0F172A)),
                    enabled = !isAssigning
                ) {
                    if (isAssigning) {
                        CircularProgressIndicator(color = Color.White, modifier = Modifier.size(16.dp))
                    } else {
                        Text("Ingresar")
                    }
                }
            },
            dismissButton = {
                TextButton(onClick = { showQtyDialog = false }) {
                    Text("Cancelar")
                }
            }
        )
    }

    // 2. Quick Register Dialog
    if (showQuickRegister) {
        Dialog(onDismissRequest = { showQuickRegister = false }) {
            Card(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(10.dp),
                shape = RoundedCornerShape(16.dp),
                colors = CardDefaults.cardColors(containerColor = Color.White)
            ) {
                Column(
                    modifier = Modifier
                        .padding(16.dp)
                        .verticalScroll(rememberScrollState()),
                    verticalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    Text(
                        text = "Registro Rápido de Producto",
                        fontWeight = FontWeight.Black,
                        fontSize = 16.sp,
                        color = Color(0xFF0F172A)
                    )

                    // OCR trigger button inside Quick Register Dialog
                    Button(
                        onClick = {
                            // Si hay ocrEngine y el modelo está listo → usar local
                            // Si hay ocrEngine pero modelo no descargado → mostrar diálogo de descarga
                            // Si no hay ocrEngine → ir directo al servidor
                            if (ocrEngine != null && !ocrEngine.isModelReady) {
                                showModelDownloadDialog = true
                            } else {
                                try {
                                    val tempFile = File(context.cacheDir, "ocr_photo_${System.currentTimeMillis()}.jpg")
                                    tempCameraFile = tempFile
                                    val uri = FileProvider.getUriForFile(
                                        context,
                                        "com.inventorio.alpha.fileprovider",
                                        tempFile
                                    )
                                    cameraPhotoUri = uri
                                    ocrCameraLauncher.launch(uri)
                                } catch (e: Exception) {
                                    Toast.makeText(context, "Error de cámara: ${e.message}", Toast.LENGTH_LONG).show()
                                }
                            }
                        },
                        modifier = Modifier.fillMaxWidth(),
                        colors = ButtonDefaults.buttonColors(
                            containerColor = if (ocrEngine?.isModelReady == true) Color(0xFF4C1D95) else Color(0xFF0F172A)
                        ),
                        shape = RoundedCornerShape(10.dp),
                        enabled = !ocrProcessing
                    ) {
                        Icon(
                            imageVector = Icons.Default.AutoAwesome,
                            contentDescription = "OCR AI",
                            modifier = Modifier.size(18.dp)
                        )
                        Spacer(modifier = Modifier.width(6.dp))
                        Text(
                            text = when {
                                ocrProcessing -> "Analizando con IA..."
                                ocrEngine?.isModelReady == true -> "Leer Etiqueta (IA Local ⚡)"
                                else -> "Leer Etiqueta con IA"
                            },
                            fontSize = 11.sp,
                            fontWeight = FontWeight.Bold
                        )
                    }

                    // Badge de fuente OCR: local o servidor
                    if (ocrSource != null && !ocrProcessing) {
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .background(
                                    color = if (ocrSource == "local") Color(0xFFEDE9FE) else Color(0xFFDBEAFE),
                                    shape = RoundedCornerShape(8.dp)
                                )
                                .padding(horizontal = 10.dp, vertical = 5.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Text(
                                text = if (ocrSource == "local") "⚡ IA Local" else "☁️ IA Servidor",
                                color = if (ocrSource == "local") Color(0xFF5B21B6) else Color(0xFF1D4ED8),
                                fontSize = 10.sp,
                                fontWeight = FontWeight.Bold
                            )
                            Spacer(Modifier.width(4.dp))
                            Text(
                                text = if (ocrSource == "local") "Procesado en dispositivo" else "Procesado en nube",
                                color = Color(0xFF6B7280),
                                fontSize = 10.sp
                            )
                        }
                    }

                    if (ocrProcessing) {
                        LinearProgressIndicator(
                            modifier = Modifier.fillMaxWidth(),
                            color = if (ocrEngine?.isModelReady == true) Color(0xFF7C3AED) else Color(0xFFF59E0B)
                        )
                    }

                    // Diálogo de descarga del modelo IA
                    if (showModelDownloadDialog && ocrEngine != null) {
                        ModelDownloadDialog(
                            ocrEngine = ocrEngine,
                            onDismiss = { showModelDownloadDialog = false },
                            onModelReady = {
                                showModelDownloadDialog = false
                                // Lanzar cámara ahora que el modelo está listo
                                try {
                                    val tempFile = File(context.cacheDir, "ocr_photo_${System.currentTimeMillis()}.jpg")
                                    tempCameraFile = tempFile
                                    val uri = FileProvider.getUriForFile(
                                        context,
                                        "com.inventorio.alpha.fileprovider",
                                        tempFile
                                    )
                                    cameraPhotoUri = uri
                                    ocrCameraLauncher.launch(uri)
                                } catch (e: Exception) {
                                    Toast.makeText(context, "Error de cámara: ${e.message}", Toast.LENGTH_LONG).show()
                                }
                            }
                        )
                    }

                    HorizontalDivider(color = Color(0xFFF1F5F9))

                    // Group vs Single Mode Switch Row
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text("Registro Grupal", fontWeight = FontWeight.Bold, fontSize = 13.sp)
                        Switch(
                            checked = isGroupMode,
                            onCheckedChange = { isGroupMode = it },
                            colors = SwitchDefaults.colors(checkedThumbColor = Color(0xFFF59E0B))
                        )
                    }

                    OutlinedTextField(
                        value = qrModelGroup,
                        onValueChange = { qrModelGroup = it },
                        label = { Text("Modelo de Grupo (Obligatorio)") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth().onFocusChanged { state -> if (!state.isFocused) checkModelExists(qrModelGroup) }
                    )

                    // Brand Dropdown Selector
                    var brandExpanded by remember { mutableStateOf(false) }
                    Box(modifier = Modifier.fillMaxWidth()) {
                        OutlinedTextField(
                            value = qrMarca,
                            onValueChange = { qrMarca = it },
                            label = { Text("Marca") },
                            readOnly = true,
                            singleLine = true,
                            modifier = Modifier.fillMaxWidth(),
                            trailingIcon = {
                                IconButton(onClick = { brandExpanded = true }) {
                                    Icon(Icons.Default.ArrowDropDown, contentDescription = "Expandir")
                                }
                            }
                        )
                        Box(
                            modifier = Modifier
                                .matchParentSize()
                                .clickable { brandExpanded = true }
                        )
                        DropdownMenu(
                            expanded = brandExpanded,
                            onDismissRequest = { brandExpanded = false }
                        ) {
                            brandsList.forEach { brand ->
                                DropdownMenuItem(
                                    text = { Text(brand) },
                                    onClick = {
                                        qrMarca = brand
                                        brandExpanded = false
                                    }
                                )
                            }
                        }
                    }

                    // Product Type Dropdown Selector
                    var typeExpanded by remember { mutableStateOf(false) }
                    Box(modifier = Modifier.fillMaxWidth()) {
                        OutlinedTextField(
                            value = qrTipo,
                            onValueChange = { qrTipo = it },
                            label = { Text("Tipo de Producto") },
                            readOnly = true,
                            singleLine = true,
                            modifier = Modifier.fillMaxWidth(),
                            trailingIcon = {
                                IconButton(onClick = { typeExpanded = true }) {
                                    Icon(Icons.Default.ArrowDropDown, contentDescription = "Expandir")
                                }
                            }
                        )
                        Box(
                            modifier = Modifier
                                .matchParentSize()
                                .clickable { typeExpanded = true }
                        )
                        DropdownMenu(
                            expanded = typeExpanded,
                            onDismissRequest = { typeExpanded = false }
                        ) {
                            typesList.forEach { type ->
                                DropdownMenuItem(
                                    text = { Text(type) },
                                    onClick = {
                                        qrTipo = type
                                        typeExpanded = false
                                    }
                                )
                            }
                        }
                    }

                    // Season Dropdown Selector
                    var seasonExpanded by remember { mutableStateOf(false) }
                    Box(modifier = Modifier.fillMaxWidth()) {
                        OutlinedTextField(
                            value = qrTemporada,
                            onValueChange = { qrTemporada = it },
                            label = { Text("Temporada") },
                            readOnly = true,
                            singleLine = true,
                            modifier = Modifier.fillMaxWidth(),
                            trailingIcon = {
                                IconButton(onClick = { seasonExpanded = true }) {
                                    Icon(Icons.Default.ArrowDropDown, contentDescription = "Expandir")
                                }
                            }
                        )
                        Box(
                            modifier = Modifier
                                .matchParentSize()
                                .clickable { seasonExpanded = true }
                        )
                        DropdownMenu(
                            expanded = seasonExpanded,
                            onDismissRequest = { seasonExpanded = false }
                        ) {
                            seasonsList.forEach { season ->
                                DropdownMenuItem(
                                    text = { Text(season) },
                                    onClick = {
                                        qrTemporada = season
                                        seasonExpanded = false
                                    }
                                )
                            }
                        }
                    }

                    // Photo capture row
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Button(
                            onClick = {
                                try {
                                    val tempFile = File(context.cacheDir, "prod_photo_${System.currentTimeMillis()}.jpg")
                                    tempProductFile = tempFile
                                    val uri = FileProvider.getUriForFile(
                                        context,
                                        "com.inventorio.alpha.fileprovider",
                                        tempFile
                                    )
                                    productPhotoUri = uri
                                    productCameraLauncher.launch(uri)
                                } catch (e: Exception) {
                                    Toast.makeText(context, "Error al abrir cámara: ${e.message}", Toast.LENGTH_LONG).show()
                                }
                            },
                            modifier = Modifier.weight(1.5f),
                            colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF475569)),
                            shape = RoundedCornerShape(10.dp)
                        ) {
                            Icon(Icons.Default.PhotoCamera, contentDescription = "Tomar Foto")
                            Spacer(modifier = Modifier.width(6.dp))
                            Text("Tomar Foto Producto", fontSize = 11.sp, fontWeight = FontWeight.Bold)
                        }

                        if (productPhotoUri != null) {
                            AsyncImage(
                                model = productPhotoUri,
                                contentDescription = "Foto Producto",
                                modifier = Modifier
                                    .size(50.dp)
                                    .clip(RoundedCornerShape(8.dp))
                                    .border(1.dp, Color.Gray, RoundedCornerShape(8.dp))
                                    .clickable {
                                        productPhotoUri = null
                                        tempProductFile = null
                                    },
                                contentScale = ContentScale.Crop
                            )
                        } else {
                            Text("Sin foto", fontSize = 11.sp, color = Color.Gray)
                        }
                    }

                    if (!isGroupMode) {
                        // Single Mode SKU and Talla Fields
                        OutlinedTextField(
                            value = qrSku,
                            onValueChange = { qrSku = it },
                            label = { Text("EAN / SKU (Obligatorio)") },
                            singleLine = true,
                            modifier = Modifier.fillMaxWidth().onFocusChanged { state -> if (!state.isFocused) checkSkuExists(qrSku) }
                        )

                        OutlinedTextField(
                            value = qrTalla,
                            onValueChange = { qrTalla = it },
                            label = { Text("Talla") },
                            singleLine = true,
                            modifier = Modifier.fillMaxWidth()
                        )
                    } else {
                        // Group Mode Variations List
                        HorizontalDivider(color = Color(0xFFF1F5F9), thickness = 1.dp)
                        Text("Variaciones (SKU, Talla, Cantidad)", fontWeight = FontWeight.Bold, fontSize = 12.sp, color = Color(0xFF1E293B))
                        
                        variations.forEachIndexed { index, item ->
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.spacedBy(6.dp),
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                OutlinedTextField(
                                    value = item.sku,
                                    onValueChange = { valNew ->
                                        variations = variations.toMutableList().apply {
                                            this[index] = item.copy(sku = valNew)
                                        }
                                    },
                                    label = { Text("SKU") },
                                    singleLine = true,
                                    modifier = Modifier.weight(1.5f).onFocusChanged { state -> if (!state.isFocused) checkSkuExists(item.sku) }
                                )
                                OutlinedTextField(
                                    value = item.talla,
                                    onValueChange = { valNew ->
                                        variations = variations.toMutableList().apply {
                                            this[index] = item.copy(talla = valNew)
                                        }
                                    },
                                    label = { Text("Talla") },
                                    singleLine = true,
                                    modifier = Modifier.weight(1f)
                                )
                                OutlinedTextField(
                                    value = if (item.cantidad == 0) "" else item.cantidad.toString(),
                                    onValueChange = { valNew ->
                                        val qty = valNew.toIntOrNull() ?: 0
                                        variations = variations.toMutableList().apply {
                                            this[index] = item.copy(cantidad = qty)
                                        }
                                    },
                                    label = { Text("Cant") },
                                    singleLine = true,
                                    modifier = Modifier.weight(0.8f)
                                )
                                IconButton(
                                    onClick = {
                                        if (variations.size > 1) {
                                            variations = variations.toMutableList().apply { removeAt(index) }
                                        }
                                    },
                                    modifier = Modifier.size(24.dp)
                                ) {
                                    Icon(Icons.Default.Delete, contentDescription = "Eliminar", tint = Color.Red)
                                }
                            }
                        }

                        Button(
                            onClick = {
                                variations = variations + VariationItem("", "", 1)
                            },
                            colors = ButtonDefaults.buttonColors(containerColor = Color(0xFFE2E8F0)),
                            modifier = Modifier.fillMaxWidth(),
                            shape = RoundedCornerShape(8.dp)
                        ) {
                            Icon(Icons.Default.Add, contentDescription = "Agregar Variación", tint = Color.Black, modifier = Modifier.size(16.dp))
                            Spacer(modifier = Modifier.width(4.dp))
                            Text("Agregar Variación", color = Color.Black, fontSize = 11.sp, fontWeight = FontWeight.Bold)
                        }
                    }

                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        TextButton(
                            onClick = { showQuickRegister = false },
                            modifier = Modifier.weight(1f)
                        ) {
                            Text("Cancelar")
                        }
                        Button(
                            onClick = registerAndAssign,
                            colors = ButtonDefaults.buttonColors(containerColor = Color(0xFFF59E0B)),
                            modifier = Modifier.weight(1f),
                            enabled = !isRegistering
                        ) {
                            if (isRegistering) {
                                CircularProgressIndicator(color = Color.White, modifier = Modifier.size(16.dp))
                            } else {
                                Text("Registrar", fontWeight = FontWeight.Bold)
                            }
                        }
                    }
                }
            }
        }
    }
}

// Verification response container
data class VerificationResult(
    val exists: Boolean,
    val product: Producto?,
    val ubicacion: Caja?
)

@androidx.annotation.OptIn(androidx.camera.core.ExperimentalGetImage::class)
class BarcodeAnalyzer(private val onBarcodeDetected: (String) -> Unit) : ImageAnalysis.Analyzer {
    private val scanner = BarcodeScanning.getClient(
        BarcodeScannerOptions.Builder()
            .setBarcodeFormats(
                Barcode.FORMAT_EAN_13,
                Barcode.FORMAT_CODE_128,
                Barcode.FORMAT_UPC_A,
                Barcode.FORMAT_UPC_E
            )
            .build()
    )

    override fun analyze(imageProxy: ImageProxy) {
        val mediaImage = imageProxy.image
        if (mediaImage != null) {
            val image = InputImage.fromMediaImage(mediaImage, imageProxy.imageInfo.rotationDegrees)
            scanner.process(image)
                .addOnSuccessListener { barcodes ->
                    for (barcode in barcodes) {
                        barcode.rawValue?.let { value ->
                            onBarcodeDetected(value)
                        }
                    }
                }
                .addOnFailureListener {
                    // Ignore
                }
                .addOnCompleteListener {
                    imageProxy.close()
                }
        } else {
            imageProxy.close()
        }
    }
}
