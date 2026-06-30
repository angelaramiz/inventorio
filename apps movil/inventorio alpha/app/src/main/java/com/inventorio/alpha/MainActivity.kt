package com.inventorio.alpha

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.os.Bundle
import android.os.Environment
import android.provider.MediaStore
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
import androidx.lifecycle.lifecycleScope
import com.google.gson.Gson
import com.google.gson.reflect.TypeToken
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.IOException
import java.io.InputStream
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

data class OcrResult(
    val modelo_grupo: String?,
    val sku: String?,
    val marca: String?,
    val talla: String?,
    val tipo_producto: String?
)

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
    val modelo_grupo: String?
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

    // OCR Engine — inicializa modelo local Qwen2.5-VL bajo demanda
    val ocrEngine = remember {
        LabelOcrEngine(context, client, serverUrl)
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
                    Triple("consulta", Icons.Default.ManageSearch, "Consulta Rápida"),
                    Triple("productos", Icons.Default.Category, "Productos (Stock)"),
                    Triple("cajas", Icons.Default.Inbox, "Contenedores (Cajas)"),
                    Triple("conceptos", Icons.Default.LocalOffer, "Conceptos Catálogo"),
                    Triple("almacen", Icons.Default.Warehouse, "Layout Almacén"),
                    Triple("config", Icons.Default.Settings, "Configuración")
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
                Spacer(modifier = Modifier.weight(1f))
                HorizontalDivider(color = Color(0xFFF1F5F9))

                // Gestión del Modelo IA
                var showOcrModelInfo by remember { mutableStateOf(false) }
                NavigationDrawerItem(
                    icon = { Icon(Icons.Default.AutoAwesome, contentDescription = "IA Model") },
                    label = {
                        Column {
                            Text("IA — Modelo Etiquetas", fontWeight = FontWeight.Bold, fontSize = 12.sp)
                            Text(
                                text = if (ocrEngine.isModelReady) "✅ Listo (${ocrEngine.modelSizeDescription})" else "⬇️ No descargado",
                                fontSize = 10.sp,
                                color = if (ocrEngine.isModelReady) Color(0xFF16A34A) else Color(0xFF9CA3AF)
                            )
                        }
                    },
                    selected = false,
                    onClick = { showOcrModelInfo = !showOcrModelInfo },
                    modifier = Modifier.padding(NavigationDrawerItemDefaults.ItemPadding)
                )

                if (showOcrModelInfo) {
                    Column(
                        modifier = Modifier
                            .padding(horizontal = 16.dp, vertical = 4.dp)
                            .background(Color(0xFFF8FAFC), RoundedCornerShape(8.dp))
                            .padding(10.dp),
                        verticalArrangement = Arrangement.spacedBy(6.dp)
                    ) {
                        Text(
                            "Qwen2.5-VL-2B · Q4 MNN",
                            fontSize = 11.sp, fontWeight = FontWeight.Bold, color = Color(0xFF374151)
                        )
                        if (ocrEngine.isModelReady) {
                            TextButton(
                                onClick = {
                                    ocrEngine.deleteModel()
                                    scope.launch { drawerState.close() }
                                    Toast.makeText(context, "Modelo eliminado", Toast.LENGTH_SHORT).show()
                                    showOcrModelInfo = false
                                },
                                modifier = Modifier.fillMaxWidth()
                            ) {
                                Icon(Icons.Default.Delete, null, Modifier.size(16.dp), tint = Color(0xFFDC2626))
                                Spacer(Modifier.width(4.dp))
                                Text("🗑️ Borrar modelo", color = Color(0xFFDC2626), fontSize = 11.sp)
                            }
                        } else {
                            Button(
                                onClick = {
                                    showOcrModelInfo = false
                                    scope.launch { drawerState.close() }
                                    showOcrDownloadDialog = true
                                },
                                colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF7C3AED)),
                                modifier = Modifier.fillMaxWidth(),
                                shape = RoundedCornerShape(8.dp)
                            ) {
                                Text("⬇️ Descargar modelo", fontSize = 11.sp, fontWeight = FontWeight.Bold)
                            }
                        }
                    }
                }

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
                                val isLocalAi = MnnLlmBridge.isAvailable
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
                            ocrEngine = ocrEngine
                        )
                    }
                    "consulta" -> {
                        ConsultaView(
                            client = client,
                            serverUrl = serverUrl
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
            val isLocalAi = MnnLlmBridge.isAvailable
            val err = MnnLlmBridge.lastInitError
            val modelValidation = remember(showAiStatusDialog) {
                if (ocrEngine.isModelReady) MnnLlmBridge.validateModelFiles(ocrEngine.modelDir) else null
            }
            AlertDialog(
                onDismissRequest = { showAiStatusDialog = false },
                title = { Text(if (isLocalAi) "IA Local Activa" else "IA Nube Activa") },
                text = {
                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text(
                            if (isLocalAi) "El motor nativo de IA local (Qwen2.5-VL-2B via MNN-LLM) se ha cargado e inicializado correctamente."
                            else "Se está utilizando la API en la nube como fallback para las tareas de OCR."
                        )
                        if (err != null) {
                            Text("Detalle del último error:", fontWeight = FontWeight.Bold, fontSize = 12.sp)
                            Text(
                                text = err,
                                fontFamily = FontFamily.Monospace,
                                fontSize = 11.sp,
                                color = MaterialTheme.colorScheme.error,
                                modifier = Modifier
                                    .background(Color(0xFFFEF2F2), shape = RoundedCornerShape(8.dp))
                                    .padding(8.dp)
                            )
                        } else if (!isLocalAi && !ocrEngine.isModelReady) {
                            Text(
                                "El modelo local de IA no está descargado. Puedes descargarlo en Configuración.",
                                color = Color.Gray,
                                fontSize = 12.sp
                            )
                        }
                        if (modelValidation != null) {
                            Text("Validación de archivos:", fontWeight = FontWeight.Bold, fontSize = 12.sp)
                            Text(
                                text = modelValidation,
                                fontFamily = FontFamily.Monospace,
                                fontSize = 11.sp,
                                color = MaterialTheme.colorScheme.error
                            )
                        }
                    }
                },
                confirmButton = {
                    Row(
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        if (!isLocalAi && ocrEngine.isModelReady) {
                            var initializing by remember { mutableStateOf(false) }
                            TextButton(
                                enabled = !initializing,
                                onClick = {
                                    initializing = true
                                    scope.launch(Dispatchers.IO) {
                                        ocrEngine.initNativeModel()
                                        withContext(Dispatchers.Main) {
                                            initializing = false
                                            if (MnnLlmBridge.isAvailable) {
                                                Toast.makeText(context, "IA Local inicializada correctamente", Toast.LENGTH_SHORT).show()
                                                showAiStatusDialog = false
                                            } else {
                                                Toast.makeText(context, "Fallo al inicializar IA Local", Toast.LENGTH_SHORT).show()
                                            }
                                        }
                                    }
                                }
                            ) {
                                Text(if (initializing) "Iniciando..." else "Inicializar Local")
                            }
                        }
                        Spacer(modifier = Modifier.weight(1f))
                        TextButton(onClick = { showAiStatusDialog = false }) {
                            Text("Cerrar")
                        }
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
    }
}

// Function to handle image file upload for Gemini OCR
fun uploadImageForOcr(
    context: Context,
    client: OkHttpClient,
    serverUrl: String,
    imageUri: Uri,
    setLoading: (Boolean) -> Unit,
    onResult: (OcrResult?) -> Unit
) {
    setLoading(true)
    val scope = (context as MainActivity).lifecycleScope

    scope.launch(Dispatchers.IO) {
        try {
            val inputStream: InputStream? = context.contentResolver.openInputStream(imageUri)
            val bitmap = BitmapFactory.decodeStream(inputStream)
            inputStream?.close()

            if (bitmap == null) {
                withContext(Dispatchers.Main) {
                    Toast.makeText(context, "No se pudo decodificar la imagen", Toast.LENGTH_SHORT).show()
                    setLoading(false)
                }
                return@launch
            }

            // Compress to JPEG for upload
            val outputStream = ByteArrayOutputStream()
            bitmap.compress(Bitmap.CompressFormat.JPEG, 85, outputStream)
            val byteArray = outputStream.toByteArray()

            val requestBody = MultipartBody.Builder()
                .setType(MultipartBody.FORM)
                .addFormDataPart(
                    "foto",
                    "captura.jpg",
                    RequestBody.create("image/jpeg".toMediaType(), byteArray)
                )
                .build()

            val url = "${serverUrl.trimEnd('/')}/api/ocr/extract-label"
            val request = Request.Builder()
                .url(url)
                .post(requestBody)
                .build()

            client.newCall(request).execute().use { response ->
                if (response.isSuccessful) {
                    val bodyText = response.body?.string() ?: ""
                    Log.d("OcrUpload", "Response: $bodyText")
                    val result = Gson().fromJson(bodyText, OcrResult::class.java)
                    withContext(Dispatchers.Main) {
                        onResult(result)
                        Toast.makeText(context, "Etiqueta analizada con éxito", Toast.LENGTH_SHORT).show()
                    }
                } else {
                    val errorText = response.body?.string() ?: "Error desconocido"
                    withContext(Dispatchers.Main) {
                        Toast.makeText(context, "Error OCR: $errorText", Toast.LENGTH_LONG).show()
                    }
                }
            }
        } catch (e: Exception) {
            Log.e("OcrUpload", "Error uploading", e)
            withContext(Dispatchers.Main) {
                Toast.makeText(context, "Error de red: ${e.message}", Toast.LENGTH_LONG).show()
            }
        } finally {
            withContext(Dispatchers.Main) {
                setLoading(false)
            }
        }
    }
}
