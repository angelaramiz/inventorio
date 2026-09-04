package com.inventorio.alpha

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.os.Environment
import android.util.Log
import android.widget.Toast
import androidx.activity.ComponentActivity
import coil.ImageLoader
import coil.Coil
import coil.disk.DiskCache
import coil.memory.MemoryCache
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
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
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.FileProvider
import com.google.gson.Gson
import com.google.gson.reflect.TypeToken
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.File
import java.text.SimpleDateFormat
import java.util.*
import java.util.concurrent.TimeUnit

// Data Models matching inventorio Express backend
data class AppVersionResponse(
    val versionCode: Int,
    val versionName: String,
    val apkUrl: String
)

data class DashboardStats(
    val totalSKUs: Int,
    val totalUnits: Int,
    val boxStats: BoxStats,
    val layoutStats: LayoutStats,
    val recentExits: List<RecentExit>
)
data class BoxStats(val total: Int, val vacia: Int, val activa: Int, val llena: Int)
data class LayoutStats(val zonas: Int, val pasillos: Int, val secciones: Int, val niveles: Int)
data class RecentExit(
    val id: Int,
    val vendedor_id: String,
    val tipo_salida: String,
    val created_at: String,
    val total_unidades: Int,
    val detalles: List<ExitDetail>
)
data class ExitDetail(val sku: String, val cantidad: Int)

data class Producto(
    val id_producto: Int,
    val sku: String,
    val ean_13: String?,
    val talla: String?,
    val temporada: String?,
    val tipo: String?,
    val marca_sub: String?,
    val has_foto: Boolean,
    val activo: Boolean,
    val created_at: String?,
    val modelo_grupo: String?,
    val codigo_color: String? = null,
    val fecha_temporada: String? = null
)

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        
        // Configure Coil image loader with memory and disk cache
        val imageLoader = ImageLoader.Builder(this)
            .memoryCache {
                MemoryCache.Builder(this)
                    .maxSizePercent(0.25)
                    .build()
            }
            .diskCache {
                DiskCache.Builder()
                    .directory(this.cacheDir.resolve("image_cache"))
                    .maxSizePercent(0.02)
                    .build()
            }
            .crossfade(true)
            .build()
        Coil.setImageLoader(imageLoader)

        setContent {
            MaterialTheme {
                MainAppScreen()
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MainAppScreen() {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()

    // Config settings
    var serverUrl by remember { mutableStateOf("https://inventorio.onrender.com") }
    var activeTab by remember { mutableStateOf("dashboard") }

    // Dashboard stats states
    var stats by remember { mutableStateOf<DashboardStats?>(null) }
    var loadingStats by remember { mutableStateOf(false) }

    // Cajas state (shared so it updates across views)
    var cajasList by remember { mutableStateOf<List<Caja>>(emptyList()) }
    var loadingCajas by remember { mutableStateOf(false) }
    var activeCaja by remember { mutableStateOf<Caja?>(null) }

    // Update state
    var updateAvailable by remember { mutableStateOf<AppVersionResponse?>(null) }
    var isDownloadingUpdate by remember { mutableStateOf(false) }

    // Shared OkHttpClient with extended timeouts to wait for Render backend cold starts
    val client = remember {
        OkHttpClient.Builder()
            .connectTimeout(60, TimeUnit.SECONDS)
            .readTimeout(60, TimeUnit.SECONDS)
            .writeTimeout(60, TimeUnit.SECONDS)
            .build()
    }

    var isCheckingUpdate by remember { mutableStateOf(false) }

    // OCR Engine — ML Kit Text Recognition (on-device, always ready)
    val ocrEngine = remember {
        LabelOcrEngine(context)
    }

    // ML Kit siempre está listo — no necesita inicialización
    LaunchedEffect(ocrEngine) {
        AppLogger.i("MAIN", "=== App iniciada. ML Kit Text Recognition listo ===")
        AppLogger.i("MAIN", "✅ OCR on-device siempre disponible. Sin descarga necesaria.")
    }


    var showOcrDownloadDialog by remember { mutableStateOf(false) }
    var showAiStatusDialog by remember { mutableStateOf(false) }

    val checkForUpdate: (Boolean) -> Unit = { manual ->
        if (manual) isCheckingUpdate = true
        scope.launch(Dispatchers.IO) {
            try {
                val currentVersionCode = try {
                    val packageInfo = context.packageManager.getPackageInfo(context.packageName, 0)
                    if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.P) {
                        packageInfo.longVersionCode.toInt()
                    } else {
                        @Suppress("DEPRECATION")
                        packageInfo.versionCode
                    }
                } catch (e: Exception) {
                    1
                }
                val req = Request.Builder().url("${serverUrl.trimEnd('/')}/api/android-version").build()
                client.newCall(req).execute().use { res ->
                    if (res.isSuccessful) {
                        val body = res.body?.string() ?: "{}"
                        val info = Gson().fromJson(body, AppVersionResponse::class.java)
                        withContext(Dispatchers.Main) {
                            if (info.versionCode > currentVersionCode) {
                                updateAvailable = info
                                if (manual) Toast.makeText(context, "Actualización disponible: ${info.versionName}", Toast.LENGTH_SHORT).show()
                            } else {
                                if (manual) Toast.makeText(context, "Estás en la última versión", Toast.LENGTH_SHORT).show()
                            }
                        }
                    } else {
                        withContext(Dispatchers.Main) {
                            if (manual) Toast.makeText(context, "Error al comprobar", Toast.LENGTH_SHORT).show()
                        }
                    }
                }
            } catch (e: Exception) {
                withContext(Dispatchers.Main) {
                    if (manual) Toast.makeText(context, "Error de red al comprobar", Toast.LENGTH_SHORT).show()
                }
            } finally {
                withContext(Dispatchers.Main) {
                    isCheckingUpdate = false
                }
            }
        }
    }

    LaunchedEffect(Unit) {
        checkForUpdate(false)
    }

    // Load Cajas logic
    val loadCajas: () -> Unit = {
        loadingCajas = true
        scope.launch(Dispatchers.IO) {
            try {
                val url = "${serverUrl.trimEnd('/')}/api/cajas"
                val request = Request.Builder().url(url).build()
                client.newCall(request).execute().use { response ->
                    if (response.isSuccessful) {
                        val bodyText = response.body?.string() ?: "[]"
                        val typeToken = object : TypeToken<List<Caja>>() {}.type
                        val list: List<Caja> = Gson().fromJson(bodyText, typeToken)
                        withContext(Dispatchers.Main) {
                            cajasList = list

                            // Re-bind activeCaja if it was selected and still exists
                            val savedActiveId = activeCaja?.id_caja
                            if (savedActiveId != null) {
                                activeCaja = list.find { it.id_caja == savedActiveId }
                            }
                        }
                    } else {
                        withContext(Dispatchers.Main) {
                            Toast.makeText(context, "Error al cargar contenedores (HTTP ${response.code})", Toast.LENGTH_LONG).show()
                        }
                    }
                }
            } catch (e: Exception) {
                withContext(Dispatchers.Main) {
                    Toast.makeText(context, "Error de contenedores: ${e.message}", Toast.LENGTH_LONG).show()
                }
            } finally {
                withContext(Dispatchers.Main) {
                    loadingCajas = false
                }
            }
        }
    }

    // SSE real-time sync: reconectar cuando cambia el serverUrl
    LaunchedEffect(serverUrl) {
        SseClient.disconnect()
        SseClient.addListener { event ->
            // When products or boxes change, refresh relevant views (sincronización en tiempo real)
            when (event.type) {
                "producto:batch-registered", "caja:updated", "caja:deleted", "producto:deleted" -> {
                    Log.i("MainActivity", "SSE event: ${event.type} → refrescando contenedores")
                    loadCajas()
                }
            }
        }
        SseClient.connect(serverUrl, client)
    }

    // Load statistics logic
    val loadStats: (Boolean) -> Unit = { silent ->
        if (!silent) loadingStats = true
        scope.launch(Dispatchers.IO) {
            try {
                val url = "${serverUrl.trimEnd('/')}/api/dashboard/stats"
                val request = Request.Builder().url(url).build()
                client.newCall(request).execute().use { response ->
                    if (response.isSuccessful) {
                        val bodyText = response.body?.string() ?: ""
                        val parsed = Gson().fromJson(bodyText, DashboardStats::class.java)
                        withContext(Dispatchers.Main) {
                            stats = parsed
                            if (silent) Toast.makeText(context, "Estadísticas actualizadas", Toast.LENGTH_SHORT).show()
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
                    loadingStats = false
                }
            }
        }
    }

    // Load data on serverUrl change
    LaunchedEffect(serverUrl) {
        loadStats(false)
        loadCajas()
    }

    val drawerState = rememberDrawerState(initialValue = DrawerValue.Closed)

    ModalNavigationDrawer(
        drawerState = drawerState,
        drawerContent = {
            ModalDrawerSheet {
                Column(
                    modifier = Modifier
                        .verticalScroll(rememberScrollState())
                        .fillMaxHeight()
                ) {
                    Spacer(modifier = Modifier.height(12.dp))
                    Row(
                        modifier = Modifier.padding(16.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Box(
                            modifier = Modifier
                                .size(40.dp)
                                .clip(RoundedCornerShape(8.dp))
                                .background(Color(0xFF0F172A)),
                            contentAlignment = Alignment.Center
                        ) {
                            Icon(Icons.Default.List, contentDescription = "Logo", tint = Color.White)
                        }
                        Spacer(modifier = Modifier.width(10.dp))
                        Text(
                            text = "Inventorio Alpha",
                            fontWeight = FontWeight.Black,
                            fontSize = 18.sp,
                            color = Color(0xFF0F172A)
                        )
                    }
                    HorizontalDivider(color = Color(0xFFF1F5F9))
                    Spacer(modifier = Modifier.height(10.dp))

                    listOf(
                        Triple("dashboard", Icons.Default.Home, "Dashboard"),
                        Triple("scanner", Icons.Default.QrCodeScanner, "Escáner Barcode"),
                        Triple("batch_ocr", Icons.Default.Collections, "Escáner por Lote"),
                        Triple("transferir", Icons.Default.ArrowForward, "Transferencias"),
                        Triple("consulta", Icons.Default.ManageSearch, "Consulta Rápida"),
                        Triple("productos", Icons.Default.Category, "Productos (Stock)"),
                        Triple("cajas", Icons.Default.Inbox, "Contenedores (Cajas)"),
                        Triple("conceptos", Icons.Default.LocalOffer, "Conceptos Catálogo"),
                        Triple("almacen", Icons.Default.Warehouse, "Layout Almacén"),
                        Triple("logs", Icons.Default.BugReport, "Diagnóstico / Logs"),
                        Triple("config", Icons.Default.Settings, "Configuración"),
                        Triple("appcatalog", Icons.Default.Apps, "Catálogo Apps")
                    ).forEach { (tabName, icon, label) ->
                        val isSelected = activeTab == tabName
                        NavigationDrawerItem(
                            icon = { Icon(icon, contentDescription = label) },
                            label = { Text(label, fontWeight = FontWeight.Bold, fontSize = 12.sp) },
                            selected = isSelected,
                            onClick = {
                                activeTab = tabName
                                scope.launch { drawerState.close() }
                            },
                            modifier = Modifier.padding(NavigationDrawerItemDefaults.ItemPadding)
                        )
                    }
                    Spacer(modifier = Modifier.height(8.dp))
                    HorizontalDivider(color = Color(0xFFF1F5F9))

                    // OCR Status
                    NavigationDrawerItem(
                        icon = { Icon(Icons.Default.AutoAwesome, contentDescription = "OCR") },
                        label = {
                            Column {
                                Text("OCR — Motor de Lectura", fontWeight = FontWeight.Bold, fontSize = 12.sp)
                                Text(
                                    text = "✅ ML Kit Text Recognition",
                                    fontSize = 10.sp,
                                    color = Color(0xFF16A34A)
                                )
                            }
                        },
                        selected = false,
                        onClick = { },
                        modifier = Modifier.padding(NavigationDrawerItemDefaults.ItemPadding)
                    )

                    HorizontalDivider(color = Color(0xFFF1F5F9))
                    NavigationDrawerItem(
                        icon = {
                            if (isCheckingUpdate) {
                                CircularProgressIndicator(modifier = Modifier.size(24.dp), color = Color(0xFF0F172A), strokeWidth = 2.dp)
                            } else {
                                Icon(Icons.Default.SystemUpdate, contentDescription = "Actualización")
                            }
                        },
                        label = { Text("Comprobar Actualización", fontWeight = FontWeight.Bold, fontSize = 12.sp) },
                        selected = false,
                        onClick = {
                            scope.launch { drawerState.close() }
                            checkForUpdate(true)
                        },
                        modifier = Modifier.padding(NavigationDrawerItemDefaults.ItemPadding)
                    )
                    Spacer(modifier = Modifier.height(10.dp))
                }
            }
        }
    ) {
        if (updateAvailable != null) {
            AlertDialog(
                onDismissRequest = { /* Require user to click a button */ },
                title = { Text("Actualización Disponible", fontWeight = FontWeight.Bold) },
                text = { Text("Hay una nueva versión de Inventorio Alpha (${updateAvailable!!.versionName}). Es recomendable descargarla para obtener las últimas funciones y correcciones.") },
                confirmButton = {
                    Button(onClick = {
                        val apkUrl = updateAvailable!!.apkUrl
                        val baseFullUrl = if (apkUrl.startsWith("/")) "${serverUrl.trimEnd('/')}$apkUrl" else apkUrl
                        val fullUrl = if (baseFullUrl.contains("?")) "$baseFullUrl&t=${System.currentTimeMillis()}" else "$baseFullUrl?t=${System.currentTimeMillis()}"
                        isDownloadingUpdate = true
                        
                        scope.launch(Dispatchers.IO) {
                            try {
                                val req = Request.Builder().url(fullUrl).build()
                                client.newCall(req).execute().use { res ->
                                    if (res.isSuccessful) {
                                        val bytes = res.body?.bytes()
                                        if (bytes != null) {
                                            val dir = context.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS)
                                            dir?.listFiles()?.forEach { if (it.name.endsWith(".apk")) it.delete() }
                                            val file = File(dir, "inventorio_update_${System.currentTimeMillis()}.apk")
                                            file.writeBytes(bytes)
                                            
                                            withContext(Dispatchers.Main) {
                                                isDownloadingUpdate = false
                                                updateAvailable = null
                                                
                                                try {
                                                    val uri = FileProvider.getUriForFile(context, "com.inventorio.alpha.fileprovider", file)
                                                    val intent = Intent(Intent.ACTION_VIEW).apply {
                                                        setDataAndType(uri, "application/vnd.android.package-archive")
                                                        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                                                        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                                                    }
                                                    context.startActivity(intent)
                                                } catch (e: Exception) {
                                                    Toast.makeText(context, "No se pudo iniciar la instalación", Toast.LENGTH_LONG).show()
                                                }
                                            }
                                        }
                                    } else {
                                        withContext(Dispatchers.Main) {
                                            isDownloadingUpdate = false
                                            Toast.makeText(context, "Error al descargar el archivo", Toast.LENGTH_SHORT).show()
                                        }
                                    }
                                }
                            } catch (e: Exception) {
                                withContext(Dispatchers.Main) {
                                    isDownloadingUpdate = false
                                    Toast.makeText(context, "Error de red descargando actualización", Toast.LENGTH_SHORT).show()
                                }
                            }
                        }
                    }) {
                        if (isDownloadingUpdate) {
                            CircularProgressIndicator(modifier = Modifier.size(20.dp), color = Color.White)
                        } else {
                            Text("Descargar e Instalar")
                        }
                    }
                },
                dismissButton = {
                    TextButton(onClick = { updateAvailable = null }, enabled = !isDownloadingUpdate) {
                        Text("Más tarde")
                    }
                }
            )
        }

        Scaffold(
            topBar = {
                TopAppBar(
                    title = {
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.SpaceBetween,
                            modifier = Modifier.fillMaxWidth()
                        ) {
                            Text(
                                text = when (activeTab) {
                                    "dashboard" -> "DASHBOARD"
                                    "scanner" -> "ESCÁNER"
                                    "batch_ocr" -> "LOTE"
                                    "transferir" -> "TRANSFERENCIAS"
                                    "consulta" -> "CONSULTA"
                                    "productos" -> "CATÁLOGO"
                                    "cajas" -> "CONTENEDORES"
                                    "conceptos" -> "CONCEPTOS"
                                    "almacen" -> "ESTRUCTURA ALMACÉN"
                                    else -> "CONFIGURACIÓN"
                                },
                                fontWeight = FontWeight.Black,
                                fontSize = 15.sp,
                                color = Color(0xFF0F172A)
                            )
                            
                            Row(
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(4.dp),
                                modifier = Modifier.padding(end = 8.dp)
                            ) {
                                val isLocalAi = LlamacppBridge.isAvailable
                                Box(
                                    modifier = Modifier
                                        .background(
                                            if (isLocalAi) Color(0xFFDCFCE7) else Color(0xFFF1F5F9),
                                            shape = RoundedCornerShape(100.dp)
                                        )
                                        .clickable { showAiStatusDialog = true }
                                        .padding(horizontal = 8.dp, vertical = 2.dp)
                                ) {
                                    Text(
                                        text = if (isLocalAi) "IA Local" else "IA Nube",
                                        fontSize = 9.sp,
                                        fontWeight = FontWeight.Bold,
                                        color = if (isLocalAi) Color(0xFF166534) else Color(0xFF64748B)
                                    )
                                }

                                Box(
                                    modifier = Modifier
                                        .background(Color(0xFFF1F5F9), shape = RoundedCornerShape(100.dp))
                                        .padding(horizontal = 8.dp, vertical = 2.dp)
                                ) {
                                    Text(
                                        text = "v${BuildConfig.VERSION_NAME}",
                                        fontSize = 9.sp,
                                        fontWeight = FontWeight.Bold,
                                        color = Color(0xFF64748B)
                                    )
                                }
                            }
                        }
                    },
                    navigationIcon = {
                        IconButton(onClick = { scope.launch { drawerState.open() } }) {
                            Icon(Icons.Default.Menu, contentDescription = "Menu")
                        }
                    },
                    actions = {
                        if (activeTab == "dashboard") {
                            IconButton(onClick = { loadStats(true) }, enabled = !loadingStats) {
                                Icon(Icons.Default.Refresh, contentDescription = "Refrescar")
                            }
                        } else if (activeTab == "cajas") {
                            IconButton(onClick = { loadCajas() }, enabled = !loadingCajas) {
                                Icon(Icons.Default.Refresh, contentDescription = "Refrescar")
                            }
                        }
                    },
                    colors = TopAppBarDefaults.topAppBarColors(containerColor = Color.White)
                )
            },
            bottomBar = {
                // Bottom bar for the 5 primary operational tabs
                val showBottomBar = activeTab in listOf("dashboard", "scanner", "consulta", "productos", "cajas")
                if (showBottomBar) {
                    NavigationBar(containerColor = Color.White) {
                        NavigationBarItem(
                            selected = activeTab == "dashboard",
                            onClick = { activeTab = "dashboard" },
                            icon = { Icon(Icons.Default.Home, contentDescription = "Dashboard") },
                            label = { Text("Dash", fontWeight = FontWeight.Bold, fontSize = 9.sp) }
                        )
                        NavigationBarItem(
                            selected = activeTab == "scanner",
                            onClick = { activeTab = "scanner" },
                            icon = { Icon(Icons.Default.QrCodeScanner, contentDescription = "Escáner") },
                            label = { Text("Scanner", fontWeight = FontWeight.Bold, fontSize = 9.sp) }
                        )
                        NavigationBarItem(
                            selected = activeTab == "consulta",
                            onClick = { activeTab = "consulta" },
                            icon = { Icon(Icons.Default.ManageSearch, contentDescription = "Consulta") },
                            label = { Text("Consulta", fontWeight = FontWeight.Bold, fontSize = 9.sp) }
                        )
                        NavigationBarItem(
                            selected = activeTab == "productos",
                            onClick = { activeTab = "productos" },
                            icon = { Icon(Icons.Default.Category, contentDescription = "Stock") },
                            label = { Text("Stock", fontWeight = FontWeight.Bold, fontSize = 9.sp) }
                        )
                        NavigationBarItem(
                            selected = activeTab == "cajas",
                            onClick = { activeTab = "cajas" },
                            icon = { Icon(Icons.Default.Inbox, contentDescription = "Cajas") },
                            label = { Text("Cajas", fontWeight = FontWeight.Bold, fontSize = 9.sp) }
                        )
                    }
                }
            }
        ) { paddingValues ->
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(paddingValues)
                    .background(Color(0xFFF8FAFC))
            ) {
                when (activeTab) {
                    "dashboard" -> {
                        if (loadingStats && stats == null) {
                            Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                                CircularProgressIndicator(color = Color(0xFFF59E0B))
                            }
                        } else {
                            DashboardTab(stats, loadStats)
                        }
                    }
                    "scanner" -> {
                        ScannerView(
                            client = client,
                            serverUrl = serverUrl,
                            activeCaja = activeCaja,
                            cajas = cajasList,
                            onCajasUpdated = loadCajas,
                            onCajaSelected = { activeCaja = it },
                            ocrEngine = ocrEngine
                        )
                    }
                    "batch_ocr" -> {
                        BatchOcrView(
                            client = client,
                            serverUrl = serverUrl,
                            ocrEngine = ocrEngine,
                            cajas = cajasList
                        )
                    }
                    "transferir" -> {
                        TransferFormatView(
                            client = client,
                            serverUrl = serverUrl,
                            ocrEngine = ocrEngine,
                            cajas = cajasList,
                            onCajasUpdated = loadCajas
                        )
                    }
                    "consulta" -> {
                        ConsultaView(
                            client = client,
                            serverUrl = serverUrl,
                            ocrEngine = ocrEngine
                        )
                    }
                    "productos" -> {
                        ProductsView(
                            client = client,
                            serverUrl = serverUrl
                        )
                    }
                    "cajas" -> {
                        CajasView(
                            client = client,
                            serverUrl = serverUrl,
                            activeCajaId = activeCaja?.id_caja,
                            onCajaSelected = { activeCaja = it },
                            onCajasUpdated = loadCajas,
                            cajas = cajasList,
                            loading = loadingCajas
                        )
                    }
                    "conceptos" -> {
                        ConceptosView(
                            client = client,
                            serverUrl = serverUrl
                        )
                    }
                    "almacen" -> {
                        AlmacenView(
                            client = client,
                            serverUrl = serverUrl
                        )
                    }
                    "config" -> {
                        ConfigTab(
                            serverUrl = serverUrl,
                            onUrlSaved = {
                                serverUrl = it
                                Toast.makeText(context, "Servidor guardado correctamente", Toast.LENGTH_SHORT).show()
                            },
                            client = client
                        )
                    }
                    "appcatalog" -> {
                        AppCatalogView(client = client, serverUrl = serverUrl)
                    }
                    "logs" -> {
                        LogsView(ocrEngine = ocrEngine)
                    }
                }
            }
        }
        
        if (showOcrDownloadDialog) {
            ModelDownloadDialog(
                ocrEngine = ocrEngine,
                onDismiss = { showOcrDownloadDialog = false },
                onModelReady = {
                    showOcrDownloadDialog = false
                    Toast.makeText(context, "Modelo IA listo para usarse localmente", Toast.LENGTH_SHORT).show()
                }
            )
        }

        if (showAiStatusDialog) {
            AlertDialog(
                onDismissRequest = { showAiStatusDialog = false },
                title = { Text("Estado del OCR") },
                text = {
                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text("Motor principal: ML Kit Text Recognition (on-device)")
                        Text("Preprocesamiento: ImagePreprocessor (grayscale + CLAHE + Otsu)")
                        Text("Parser: LabelTextParser (40+ marcas, regex)")
                        Text("Sin IA externa: el usuario confirma o corrige (ground truth)")
                        Spacer(Modifier.height(4.dp))
                        Text(
                            "ML Kit siempre está disponible. No necesita descarga de modelos.",
                            color = Color(0xFF16A34A),
                            fontSize = 11.sp
                        )
                    }
                },
                confirmButton = {
                    TextButton(onClick = { showAiStatusDialog = false }) {
                        Text("Cerrar")
                    }
                }
            )
        }
    }
}

@Composable
fun DashboardTab(stats: DashboardStats?, onRefresh: (Boolean) -> Unit) {
    LazyColumn(
        modifier = Modifier
            .fillMaxSize()
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp)
    ) {
        // Main Metric Banner (Gradient)
        item {
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(20.dp))
                    .background(
                        Brush.horizontalGradient(
                            colors = listOf(Color(0xFFF59E0B), Color(0xFFD97706))
                        )
                    )
                    .padding(20.dp)
            ) {
                Column {
                    Text("Prendas en Sistema", color = Color.White.copy(alpha = 0.85f), fontSize = 12.sp, fontWeight = FontWeight.Bold)
                    Text(
                        text = (stats?.totalUnits ?: 0).toString(),
                        color = Color.White,
                        fontSize = 36.sp,
                        fontWeight = FontWeight.Black
                    )
                    Spacer(modifier = Modifier.height(10.dp))
                    Box(
                        modifier = Modifier
                            .background(Color.White.copy(alpha = 0.2f), shape = RoundedCornerShape(10.dp))
                            .padding(horizontal = 10.dp, vertical = 4.dp)
                    ) {
                        Text("Stock físico total consolidado", color = Color.White, fontSize = 10.sp, fontWeight = FontWeight.Bold)
                    }
                }
            }
        }

        // Stats grid (Row 1)
        item {
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                // Modelos Card
                Card(
                    modifier = Modifier.weight(1f),
                    colors = CardDefaults.cardColors(containerColor = Color.White),
                    shape = RoundedCornerShape(16.dp)
                ) {
                    Column(modifier = Modifier.padding(16.dp)) {
                        Text("Modelos Únicos", color = Color.Gray, fontSize = 11.sp, fontWeight = FontWeight.Bold)
                        Text(
                            text = (stats?.totalSKUs ?: 0).toString(),
                            color = Color(0xFF0F172A),
                            fontSize = 26.sp,
                            fontWeight = FontWeight.Black
                        )
                        Spacer(modifier = Modifier.height(4.dp))
                        Text("SKUs activos", color = Color.LightGray, fontSize = 9.sp)
                    }
                }

                // Cajas Card
                Card(
                    modifier = Modifier.weight(1f),
                    colors = CardDefaults.cardColors(containerColor = Color.White),
                    shape = RoundedCornerShape(16.dp)
                ) {
                    Column(modifier = Modifier.padding(16.dp)) {
                        Text("Total Cajas", color = Color.Gray, fontSize = 11.sp, fontWeight = FontWeight.Bold)
                        Text(
                            text = (stats?.boxStats?.total ?: 0).toString(),
                            color = Color(0xFF0F172A),
                            fontSize = 26.sp,
                            fontWeight = FontWeight.Black
                        )
                        Spacer(modifier = Modifier.height(4.dp))
                        Text(
                            text = "Llenas: ${stats?.boxStats?.llena ?: 0} | Activas: ${stats?.boxStats?.activa ?: 0}",
                            color = Color.LightGray,
                            fontSize = 9.sp
                        )
                    }
                }
            }
        }

        // Layout locations summary
        item {
            Card(
                modifier = Modifier.fillMaxWidth(),
                colors = CardDefaults.cardColors(containerColor = Color.White),
                shape = RoundedCornerShape(16.dp)
            ) {
                Column(modifier = Modifier.padding(16.dp)) {
                    Text("Estructura Física del Almacén", color = Color.Gray, fontSize = 11.sp, fontWeight = FontWeight.Bold)
                    Spacer(modifier = Modifier.height(10.dp))
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween
                    ) {
                        LayoutItemMetric(label = "Zonas", value = stats?.layoutStats?.zonas ?: 0)
                        LayoutItemMetric(label = "Pasillos", value = stats?.layoutStats?.pasillos ?: 0)
                        LayoutItemMetric(label = "Secciones", value = stats?.layoutStats?.secciones ?: 0)
                        LayoutItemMetric(label = "Niveles", value = stats?.layoutStats?.niveles ?: 0)
                    }
                }
            }
        }

        // Exits list header
        item {
            Text(
                text = "Historial Reciente de Salidas",
                fontWeight = FontWeight.Black,
                fontSize = 13.sp,
                color = Color(0xFF0F172A)
            )
        }

        // Exits items list
        val exits = stats?.recentExits ?: emptyList()
        if (exits.isEmpty()) {
            item {
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(vertical = 12.dp),
                    contentAlignment = Alignment.Center
                ) {
                    Text("No hay transacciones registradas.", color = Color.Gray, fontSize = 11.sp)
                }
            }
        } else {
            items(exits) { exit ->
                RecentExitRow(exit)
            }
        }
    }
}

@Composable
fun LayoutItemMetric(label: String, value: Int) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Text(value.toString(), color = Color(0xFF0F172A), fontSize = 18.sp, fontWeight = FontWeight.Black)
        Text(label.uppercase(), color = Color.Gray, fontSize = 8.sp, fontWeight = FontWeight.Bold)
    }
}

@Composable
fun RecentExitRow(exit: RecentExit) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = Color.White),
        shape = RoundedCornerShape(14.dp),
        border = androidx.compose.foundation.BorderStroke(1.dp, Color(0xFFF1F5F9))
    ) {
        Row(
            modifier = Modifier.padding(14.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        text = "ID #${exit.id}",
                        fontWeight = FontWeight.Bold,
                        fontSize = 12.sp,
                        color = Color(0xFF1E293B)
                    )
                    Spacer(modifier = Modifier.width(6.dp))
                    val isVenta = exit.tipo_salida == "venta en pos"
                    Box(
                        modifier = Modifier
                            .background(
                                color = if (isVenta) Color(0xFFFEF3C7) else Color(0xFFD1FAE5),
                                shape = RoundedCornerShape(4.dp)
                            )
                            .padding(horizontal = 6.dp, vertical = 2.dp)
                    ) {
                        Text(
                            text = exit.tipo_salida.uppercase(),
                            color = if (isVenta) Color(0xFFB45309) else Color(0xFF047857),
                            fontWeight = FontWeight.Black,
                            fontSize = 8.sp
                        )
                    }
                }
                Spacer(modifier = Modifier.height(2.dp))
                Text(
                    text = "Vendedor: ${exit.vendedor_id}",
                    color = Color.Gray,
                    fontSize = 10.sp
                )
            }
            Box(
                modifier = Modifier
                    .background(Color(0xFF0F172A), shape = RoundedCornerShape(8.dp))
                    .padding(horizontal = 8.dp, vertical = 4.dp)
            ) {
                Text(
                    text = "${exit.total_unidades} Uds",
                    color = Color.White,
                    fontWeight = FontWeight.Bold,
                    fontSize = 10.sp
                )
            }
        }
    }
}

@Composable
fun ConfigTab(
    serverUrl: String, 
    onUrlSaved: (String) -> Unit,
    client: OkHttpClient
) {
    var urlInput by remember { mutableStateOf(serverUrl) }
    var sourcesInput by remember { mutableStateOf("") }
    var loadingSources by remember { mutableStateOf(false) }
    var savingSources by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val context = LocalContext.current

    LaunchedEffect(serverUrl) {
        loadingSources = true
        scope.launch(Dispatchers.IO) {
            try {
                val req = Request.Builder().url("${serverUrl.trimEnd('/')}/api/settings/image-sources").build()
                client.newCall(req).execute().use { res ->
                    if (res.isSuccessful) {
                        val body = res.body?.string() ?: "[]"
                        val list = Gson().fromJson<List<String>>(body, object : TypeToken<List<String>>() {}.type)
                        withContext(Dispatchers.Main) {
                            sourcesInput = list.joinToString("\n")
                        }
                    }
                }
            } catch (e: Exception) {
                Log.e("ConfigTab", "Error loading sources: ${e.message}")
            } finally {
                withContext(Dispatchers.Main) {
                    loadingSources = false
                }
            }
        }
    }

    val saveSources: () -> Unit = {
        savingSources = true
        val list = sourcesInput.split("\n").map { it.trim() }.filter { it.isNotEmpty() }
        scope.launch(Dispatchers.IO) {
            try {
                val bodyJson = Gson().toJson(mapOf("sources" to list))
                val req = Request.Builder()
                    .url("${serverUrl.trimEnd('/')}/api/settings/image-sources")
                    .post(bodyJson.toRequestBody("application/json".toMediaType()))
                    .build()
                client.newCall(req).execute().use { res ->
                    withContext(Dispatchers.Main) {
                        if (res.isSuccessful) {
                            Toast.makeText(context, "Fuentes guardadas correctamente", Toast.LENGTH_SHORT).show()
                        } else {
                            Toast.makeText(context, "Error al guardar fuentes", Toast.LENGTH_SHORT).show()
                        }
                    }
                }
            } catch (e: Exception) {
                withContext(Dispatchers.Main) {
                    Toast.makeText(context, "Error de conexión: ${e.message}", Toast.LENGTH_SHORT).show()
                }
            } finally {
                withContext(Dispatchers.Main) {
                    savingSources = false
                }
            }
        }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp)
    ) {
        Card(
            modifier = Modifier.fillMaxWidth(),
            colors = CardDefaults.cardColors(containerColor = Color.White),
            shape = RoundedCornerShape(20.dp)
        ) {
            Column(
                modifier = Modifier.padding(20.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                Text(
                    text = "Configuración del Servidor",
                    fontWeight = FontWeight.Black,
                    fontSize = 15.sp,
                    color = Color(0xFF0F172A)
                )
                Text(
                    text = "Configura la URL base del backend de Inventorio (Render) con el cual se sincronizará la aplicación.",
                    fontSize = 11.sp,
                    color = Color.Gray
                )
                Spacer(modifier = Modifier.height(6.dp))

                OutlinedTextField(
                    value = urlInput,
                    onValueChange = { urlInput = it },
                    modifier = Modifier.fillMaxWidth(),
                    label = { Text("URL del Servidor") },
                    singleLine = true
                )

                Button(
                    onClick = { onUrlSaved(urlInput) },
                    modifier = Modifier.fillMaxWidth(),
                    colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF0F172A)),
                    shape = RoundedCornerShape(12.dp)
                ) {
                    Text("Guardar Configuración", fontSize = 12.sp, fontWeight = FontWeight.Bold)
                }
            }
        }

        Card(
            modifier = Modifier.fillMaxWidth(),
            colors = CardDefaults.cardColors(containerColor = Color.White),
            shape = RoundedCornerShape(20.dp)
        ) {
            Column(
                modifier = Modifier.padding(20.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                Text(
                    text = "Fuentes de Búsqueda de Imágenes",
                    fontWeight = FontWeight.Black,
                    fontSize = 15.sp,
                    color = Color(0xFF0F172A)
                )
                Text(
                    text = "Introduce una URL por línea. Debe incluir {q} que será reemplazado por la consulta del producto.",
                    fontSize = 11.sp,
                    color = Color.Gray
                )
                Spacer(modifier = Modifier.height(6.dp))

                OutlinedTextField(
                    value = sourcesInput,
                    onValueChange = { sourcesInput = it },
                    modifier = Modifier.fillMaxWidth().height(120.dp),
                    label = { Text("Fuentes (una por línea)") },
                    placeholder = { Text("https://www.zara.com/search?q={q}") },
                    enabled = !loadingSources && !savingSources
                )

                Button(
                    onClick = { saveSources() },
                    modifier = Modifier.fillMaxWidth(),
                    colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF0F172A)),
                    shape = RoundedCornerShape(12.dp),
                    enabled = !loadingSources && !savingSources
                ) {
                    Text("Guardar Fuentes", fontSize = 12.sp, fontWeight = FontWeight.Bold)
                }
            }
        }

        // ── OCR Training Dashboard ─────────────────────────────────
        OcrTrainingDashboard(serverUrl = serverUrl, client = client)
    }
}

@Composable
fun OcrTrainingDashboard(serverUrl: String, client: OkHttpClient) {
    val scope = rememberCoroutineScope()
    val context = LocalContext.current

    var stats by remember { mutableStateOf<Map<String, Any>?>(null) }
    var isLoadingStats by remember { mutableStateOf(false) }
    var isTraining by remember { mutableStateOf(false) }
    var lastTrainResult by remember { mutableStateOf<String?>(null) }
    var trainingLog by remember { mutableStateOf("") }
    // Job del polling cancelable: si el dashboard sale de composición, se cancela
    val pollJob = remember { mutableStateOf<Job?>(null) }
    DisposableEffect(serverUrl) {
        onDispose { pollJob.value?.cancel() }
    }

    // Load stats
    val loadStats = {
        isLoadingStats = true
        scope.launch(Dispatchers.IO) {
            try {
                val req = Request.Builder()
                    .url("${serverUrl.trimEnd('/')}/api/ocr/training-stats")
                    .build()
                client.newCall(req).execute().use { res ->
                    if (res.isSuccessful) {
                        val body = res.body?.string() ?: "{}"
                        val jsonObj = org.json.JSONObject(body)
                        val map = mutableMapOf<String, Any>()
                        for (key in jsonObj.keys()) {
                            map[key] = jsonObj.get(key)
                        }
                        withContext(Dispatchers.Main) { stats = map }
                    }
                }
            } catch (e: Exception) {
                Log.e("OcrTraining", "Error loading stats: ${e.message}")
            } finally {
                withContext(Dispatchers.Main) { isLoadingStats = false }
            }
        }
    }

    LaunchedEffect(serverUrl) { loadStats() }

    // Poll del estado del entrenamiento (el servidor lo ejecuta en background)
    val pollTrainingStatus = {
        pollJob.value?.cancel()
        pollJob.value = scope.launch(Dispatchers.IO) {
            var guard = 0
            var finished = false
            while (!finished && guard < 720) { // ~60 min máximo, cada 5 s
                delay(5000)
                guard++
                try {
                    val req = Request.Builder()
                        .url("${serverUrl.trimEnd('/')}/api/ocr/training-status")
                        .build()
                    client.newCall(req).execute().use { res ->
                        if (!res.isSuccessful) return@use
                        val st = org.json.JSONObject(res.body?.string() ?: "{}")
                        val status = st.optString("status", "idle")
                        val message = st.optString("message", "")
                        val tail = st.optJSONArray("log_tail")
                        // Tail cortado por salto de línea, nunca a mitad de línea
                        val full = if (tail != null) {
                            (0 until tail.length()).joinToString("\n") { tail.optString(it) }
                        } else ""
                        val tailText = if (full.length > 2000) full.takeLast(2000).substringAfter("\n") else full
                        withContext(Dispatchers.Main) {
                            trainingLog = tailText
                            lastTrainResult = when (status) {
                                "running" -> "⏳ $message"
                                "done" -> "✅ $message"
                                "error" -> "❌ $message"
                                else -> message.ifBlank { null }
                            }
                            if (status == "done" || status == "error") {
                                finished = true
                                isTraining = false
                                loadStats()
                            }
                        }
                    }
                } catch (_: Exception) { /* reintentar en el siguiente ciclo */ }
            }
            withContext(Dispatchers.Main) {
                if (!finished) {
                    isTraining = false
                    lastTrainResult = "⏳ Sigue en curso (límite de seguimiento alcanzado). Reabre para ver el estado."
                    loadStats()
                }
            }
        }
    }

    // Trigger training
    val triggerTraining = {
        isTraining = true
        lastTrainResult = null
        trainingLog = ""
        scope.launch(Dispatchers.IO) {
            try {
                val req = Request.Builder()
                    .url("${serverUrl.trimEnd('/')}/api/ocr/start-training")
                    .post("{}".toRequestBody("application/json".toMediaType()))
                    .build()
                client.newCall(req).execute().use { res ->
                    val result = res.body?.string() ?: "{}"
                    withContext(Dispatchers.Main) {
                        if (res.isSuccessful) {
                            val jsonObj = org.json.JSONObject(result)
                            if (jsonObj.optBoolean("started", false)) {
                                lastTrainResult = "⏳ ${jsonObj.optString("message", "Iniciado")}"
                                pollTrainingStatus()
                            } else {
                                lastTrainResult = "⚠️ ${jsonObj.optString("message", "No iniciado")}"
                                isTraining = false
                            }
                        } else {
                            lastTrainResult = "Error: ${res.code}"
                            isTraining = false
                        }
                    }
                }
            } catch (e: Exception) {
                withContext(Dispatchers.Main) {
                    lastTrainResult = "Error: ${e.message}"
                    isTraining = false
                }
            }
        }
    }

    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = Color.White),
        shape = RoundedCornerShape(20.dp)
    ) {
        Column(
            modifier = Modifier.padding(20.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            // Header
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Column {
                    Text(
                        text = "Entrenamiento OCR",
                        fontWeight = FontWeight.Black,
                        fontSize = 15.sp,
                        color = Color(0xFF0F172A)
                    )
                    Text(
                        text = "Dataset para PaddleOCR — datos recopilados automáticamente",
                        fontSize = 10.sp,
                        color = Color.Gray
                    )
                }
                if (isLoadingStats) {
                    CircularProgressIndicator(modifier = Modifier.size(20.dp), strokeWidth = 2.dp)
                }
            }

            // Stats grid
            if (stats != null) {
                val total = (stats!!["total_samples"] as? Number)?.toInt() ?: 0
                val verified = (stats!!["verified_samples"] as? Number)?.toInt() ?: 0
                val pending = (stats!!["pending_verification"] as? Number)?.toInt() ?: 0
                val mlkitCorrect = (stats!!["mlkit_correct"] as? Number)?.toInt() ?: 0
                val mlkitIncorrect = (stats!!["mlkit_incorrect"] as? Number)?.toInt() ?: 0
                val accuracy = (stats!!["mlkit_accuracy_pct"] as? Number)?.toDouble() ?: 0.0
                val ready = (stats!!["ready_for_training"] as? Number)?.toInt() ?: verified
                val userVerified = (stats!!["user_verified"] as? Number)?.toInt() ?: 0

                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OcrStatCard("Total", "$total", Color(0xFF7C3AED), Modifier.weight(1f))
                    OcrStatCard("Verificados", "$verified", Color(0xFF059669), Modifier.weight(1f))
                    OcrStatCard("Pendientes", "$pending", Color(0xFFF59E0B), Modifier.weight(1f))
                }
                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OcrStatCard("Listos p/entrenar", "$ready", Color(0xFF2563EB), Modifier.weight(1f))
                    OcrStatCard("Ground truth usuario", "$userVerified", Color(0xFF10B981), Modifier.weight(1f))
                    OcrStatCard("ML Kit OK (hist.)", "$mlkitCorrect", Color(0xFF64748B), Modifier.weight(1f))
                }

                // Category breakdown
                if (stats!!.containsKey("by_category")) {
                    val byCategory = stats!!["by_category"] as? Map<String, Any>
                    if (byCategory != null && byCategory.isNotEmpty()) {
                        Spacer(Modifier.height(8.dp))
                        Text("Por Categoría", fontSize = 10.sp, fontWeight = FontWeight.Bold, color = Color(0xFF475569))
                        Spacer(Modifier.height(4.dp))
                        Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                            val sorted = byCategory.entries.sortedWith(compareByDescending<Map.Entry<String, Any>> {
                                (it.value as? Map<*, *>)?.get("total") as? Int ?: 0
                            })
                            sorted.forEach { entry ->
                                val cat = entry.key
                                val catData = entry.value as? Map<*, *> ?: return@forEach
                                val catTotal = (catData["total"] as? Number)?.toInt() ?: 0
                                val catVerified = (catData["verified"] as? Number)?.toInt() ?: 0
                                val catCorrect = (catData["correct"] as? Number)?.toInt() ?: 0
                                val label = cat.replace("_", " ").replaceFirstChar { it.uppercase() }
                                Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                                    Text(text = label, fontSize = 9.sp, color = Color.Gray, modifier = Modifier.weight(1f))
                                    Text(text = "$catTotal", fontSize = 9.sp, color = Color(0xFF475569))
                                    if (catVerified > 0) {
                                        Text(text = " / ${catVerified}v ${catCorrect}✓", fontSize = 8.sp, color = if (catCorrect > 0) Color(0xFF10B981) else Color(0xFFEF4444))
                                    }
                                }
                            }
                        }
                    }
                }

                // Accuracy bar (histórico vs IA externa — solo referencia, ya no se usa para verificar)
                if (verified > 0) {
                    Column {
                        Text("Precisión ML Kit (histórico vs IA externa)", fontSize = 10.sp, fontWeight = FontWeight.Bold, color = Color(0xFF475569))
                        Spacer(Modifier.height(4.dp))
                        Box(modifier = Modifier.fillMaxWidth().height(8.dp).background(Color(0xFFF1F5F9), RoundedCornerShape(4.dp))) {
                            Box(modifier = Modifier
                                .fillMaxWidth((accuracy / 100f).toFloat())
                                .fillMaxHeight()
                                .background(
                                    when {
                                        accuracy >= 80 -> Color(0xFF10B981)
                                        accuracy >= 60 -> Color(0xFFF59E0B)
                                        else -> Color(0xFFEF4444)
                                    },
                                    RoundedCornerShape(4.dp)
                                )
                            )
                        }
                    }
                }
            } else {
                Text("No hay datos disponibles", fontSize = 11.sp, color = Color.Gray)
            }

            Divider(color = Color(0xFFF1F5F9))

            // Action buttons
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(
                    onClick = { loadStats() },
                    modifier = Modifier.weight(1f),
                    colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF7C3AED)),
                    shape = RoundedCornerShape(10.dp),
                    enabled = !isTraining && !isLoadingStats
                ) {
                    if (isLoadingStats) {
                        CircularProgressIndicator(modifier = Modifier.size(14.dp), strokeWidth = 2.dp, color = Color.White)
                    } else {
                        Text("Actualizar datos", fontSize = 10.sp, fontWeight = FontWeight.Bold)
                    }
                }
                Button(
                    onClick = { triggerTraining() },
                    modifier = Modifier.weight(1f),
                    colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF0F172A)),
                    shape = RoundedCornerShape(10.dp),
                    enabled = !isTraining
                ) {
                    if (isTraining) {
                        CircularProgressIndicator(modifier = Modifier.size(14.dp), strokeWidth = 2.dp, color = Color.White)
                    } else {
                        Text("Entrenar PaddleOCR", fontSize = 10.sp, fontWeight = FontWeight.Bold)
                    }
                }
            }

            // Result messages
            lastTrainResult?.let {
                Text(it, fontSize = 10.sp, color = when {
                    it.startsWith("✅") -> Color(0xFF059669)
                    it.startsWith("⏳") || it.startsWith("⚠️") -> Color(0xFF2563EB)
                    else -> Color(0xFFEF4444)
                })
            }
            if (trainingLog.isNotBlank()) {
                Text(trainingLog, fontSize = 8.sp, color = Color(0xFF64748B), fontFamily = androidx.compose.ui.text.font.FontFamily.Monospace, maxLines = 6)
            }

            // Info
            Text(
                text = "Escanea etiquetas en Lote: ML Kit detecta y tú confirmas o corriges. Eso crea el ground truth (verdad absoluta) para entrenar PaddleOCR. Mínimo 50 verificados.",
                fontSize = 9.sp,
                color = Color(0xFF94A3B8)
            )
        }
    }
}

@Composable
fun OcrStatCard(label: String, value: String, color: Color, modifier: Modifier = Modifier) {
    Column(
        modifier = modifier
            .background(color.copy(alpha = 0.08f), RoundedCornerShape(10.dp))
            .padding(10.dp),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Text(value, fontWeight = FontWeight.Black, fontSize = 16.sp, color = color)
        Text(label, fontSize = 8.sp, color = color.copy(alpha = 0.7f), fontWeight = FontWeight.Medium)
    }
}
