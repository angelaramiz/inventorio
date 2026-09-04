package com.inventorio.operations

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.provider.Settings
import android.util.Log
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import coil.ImageLoader
import coil.Coil
import coil.disk.DiskCache
import coil.memory.MemoryCache
import com.google.gson.Gson
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.File
import java.util.concurrent.TimeUnit

// App entry for the catalog
data class AppEntry(
    val id: String,
    val name: String,
    val description: String,
    val packageName: String,
    val apkUrl: String,
    val versionName: String
)

data class AppVersionResponse(
    val versionCode: Int,
    val versionName: String,
    val apkUrl: String
)

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val imageLoader = ImageLoader.Builder(this)
            .memoryCache { MemoryCache.Builder(this).maxSizePercent(0.25).build() }
            .diskCache { DiskCache.Builder().directory(this.cacheDir.resolve("image_cache")).maxSizePercent(0.02).build() }
            .crossfade(true).build()
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
    var serverUrl by remember { mutableStateOf("https://inventorio.onrender.com") }
    var activeTab by remember { mutableStateOf("operations") }
    var updateAvailable by remember { mutableStateOf<AppVersionResponse?>(null) }
    var isDownloadingUpdate by remember { mutableStateOf(false) }
    var isCheckingUpdate by remember { mutableStateOf(false) }
    var scannerLogs by remember { mutableStateOf<List<String>>(emptyList()) }
    // Barcode enviado del escáner CSV al Manifiesto (botón "OCR → Manifiesto")
    var manifiestoPendingBarcode by remember { mutableStateOf<String?>(null) }

    val client = remember {
        OkHttpClient.Builder()
            .connectTimeout(60, TimeUnit.SECONDS)
            .readTimeout(60, TimeUnit.SECONDS)
            .writeTimeout(60, TimeUnit.SECONDS)
            .build()
    }

    val checkForUpdate: (Boolean) -> Unit = { manual ->
        if (manual) isCheckingUpdate = true
        scope.launch(Dispatchers.IO) {
            try {
                val currentVersionCode = try {
                    val pkgInfo = context.packageManager.getPackageInfo(context.packageName, 0)
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) pkgInfo.longVersionCode.toInt()
                    else @Suppress("DEPRECATION") pkgInfo.versionCode
                } catch (_: Exception) { 1 }

                val req = Request.Builder().url("${serverUrl.trimEnd('/')}/api/android-version?app=operations").build()
                client.newCall(req).execute().use { res ->
                    if (res.isSuccessful) {
                        val body = res.body?.string() ?: "{}"
                        val info = Gson().fromJson(body, AppVersionResponse::class.java)
                        withContext(Dispatchers.Main) {
                            if (info.versionCode > currentVersionCode) {
                                updateAvailable = info
                                if (manual) Toast.makeText(context, "Actualización disponible: ${info.versionName}", Toast.LENGTH_SHORT).show()
                            } else if (manual) Toast.makeText(context, "Estás en la última versión", Toast.LENGTH_SHORT).show()
                        }
                    } else if (manual) withContext(Dispatchers.Main) { Toast.makeText(context, "Error al comprobar", Toast.LENGTH_SHORT).show() }
                }
            } catch (_: Exception) { if (manual) withContext(Dispatchers.Main) { Toast.makeText(context, "Error de red", Toast.LENGTH_SHORT).show() } }
            finally { withContext(Dispatchers.Main) { isCheckingUpdate = false } }
        }
    }

    LaunchedEffect(Unit) { checkForUpdate(false) }

    val drawerState = rememberDrawerState(initialValue = DrawerValue.Closed)

    ModalNavigationDrawer(
        drawerState = drawerState,
        drawerContent = {
            ModalDrawerSheet {
                Spacer(modifier = Modifier.height(12.dp))
                Row(modifier = Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
                    Box(modifier = Modifier.size(40.dp).clip(RoundedCornerShape(8.dp)).background(Color(0xFF0F172A)), contentAlignment = Alignment.Center) {
                        Icon(Icons.Default.Build, contentDescription = "Logo", tint = Color.White)
                    }
                    Spacer(Modifier.width(10.dp))
                    Text("Inventorio Operations", fontWeight = FontWeight.Black, fontSize = 18.sp, color = Color(0xFF0F172A))
                }
                HorizontalDivider(color = Color(0xFFF1F5F9))
                Spacer(Modifier.height(10.dp))

                listOf(
                    Triple("operations", Icons.Default.Assessment, "Operaciones CSV"),
                    Triple("manifiesto", Icons.Default.Receipt, "Manifiesto"),
                    Triple("pos", Icons.Default.PointOfSale, "POS Salidas"),
                    Triple("logs", Icons.Default.BugReport, "Logs del Sistema"),
                    Triple("appcatalog", Icons.Default.Apps, "Catálogo Apps Inventorio"),
                    Triple("config", Icons.Default.Settings, "Configuración")
                ).forEach { (tabName, icon, label) ->
                    NavigationDrawerItem(
                        icon = { Icon(icon, contentDescription = label) },
                        label = { Text(label, fontWeight = FontWeight.Bold, fontSize = 12.sp) },
                        selected = activeTab == tabName,
                        onClick = { activeTab = tabName; scope.launch { drawerState.close() } },
                        modifier = Modifier.padding(NavigationDrawerItemDefaults.ItemPadding)
                    )
                }
                Spacer(Modifier.weight(1f))
                HorizontalDivider(color = Color(0xFFF1F5F9))
                NavigationDrawerItem(
                    icon = {
                        if (isCheckingUpdate) CircularProgressIndicator(Modifier.size(24.dp), color = Color(0xFF0F172A), strokeWidth = 2.dp)
                        else Icon(Icons.Default.SystemUpdate, contentDescription = "Actualización")
                    },
                    label = { Text("Comprobar Actualización", fontWeight = FontWeight.Bold, fontSize = 12.sp) },
                    selected = false,
                    onClick = { scope.launch { drawerState.close() }; checkForUpdate(true) },
                    modifier = Modifier.padding(NavigationDrawerItemDefaults.ItemPadding)
                )
                Spacer(Modifier.height(10.dp))
            }
        }
    ) {
        if (updateAvailable != null) {
            AlertDialog(
                onDismissRequest = { },
                title = { Text("Actualización Disponible", fontWeight = FontWeight.Bold) },
                text = { Text("Hay una nueva versión de Inventorio Operations (${updateAvailable!!.versionName}).") },
                confirmButton = {
                    Button(onClick = {
                        val apkUrl = updateAvailable!!.apkUrl
                        val baseUrl = if (apkUrl.startsWith("/")) "${serverUrl.trimEnd('/')}$apkUrl" else apkUrl
                        val fullUrl = if (baseUrl.contains("?")) "$baseUrl&t=${System.currentTimeMillis()}" else "$baseUrl?t=${System.currentTimeMillis()}"
                        isDownloadingUpdate = true
                        scope.launch(Dispatchers.IO) {
                            try {
                                client.newCall(Request.Builder().url(fullUrl).build()).execute().use { res ->
                                    if (res.isSuccessful) {
                                        val bytes = res.body?.bytes()
                                        if (bytes != null) {
                                            val dir = context.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS)
                                            dir?.listFiles()?.forEach { if (it.name.endsWith(".apk")) it.delete() }
                                            val file = File(dir, "inventorio_ops_update_${System.currentTimeMillis()}.apk")
                                            file.writeBytes(bytes)
                                            withContext(Dispatchers.Main) {
                                                isDownloadingUpdate = false; updateAvailable = null
                                                try {
                                                    val uri = FileProvider.getUriForFile(context, "com.inventorio.operations.fileprovider", file)
                                                    context.startActivity(Intent(Intent.ACTION_VIEW).apply {
                                                        setDataAndType(uri, "application/vnd.android.package-archive")
                                                        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
                                                    })
                                                } catch (_: Exception) { Toast.makeText(context, "No se pudo instalar", Toast.LENGTH_LONG).show() }
                                            }
                                        }
                                    } else withContext(Dispatchers.Main) { isDownloadingUpdate = false; Toast.makeText(context, "Error descarga", Toast.LENGTH_SHORT).show() }
                                }
                            } catch (_: Exception) { withContext(Dispatchers.Main) { isDownloadingUpdate = false; Toast.makeText(context, "Error de red", Toast.LENGTH_SHORT).show() } }
                        }
                    }) {
                        if (isDownloadingUpdate) CircularProgressIndicator(Modifier.size(20.dp), color = Color.White, strokeWidth = 2.dp)
                        else Text("Descargar e Instalar")
                    }
                },
                dismissButton = { TextButton(onClick = { updateAvailable = null }, enabled = !isDownloadingUpdate) { Text("Más tarde") } }
            )
        }

        Scaffold(
            topBar = {
                TopAppBar(
                    title = {
                        Text(
                            when (activeTab) { "operations" -> "OPERACIONES CSV"; "manifiesto" -> "MANIFIESTO"; "pos" -> "POS SALIDAS"; "logs" -> "LOGS DEL SISTEMA"; "appcatalog" -> "CATÁLOGO APPS"; else -> "CONFIGURACIÓN" },
                            fontWeight = FontWeight.Black, fontSize = 15.sp, color = Color(0xFF0F172A)
                        )
                    },
                    navigationIcon = { IconButton(onClick = { scope.launch { drawerState.open() } }) { Icon(Icons.Default.Menu, "Menu") } },
                    colors = TopAppBarDefaults.topAppBarColors(containerColor = Color.White)
                )
            },
            bottomBar = { if (activeTab in listOf("operations", "manifiesto", "pos", "logs")) {
                NavigationBar(containerColor = Color.White) {
                    NavigationBarItem(selected = activeTab == "operations", onClick = { activeTab = "operations" },
                        icon = { Icon(Icons.Default.Assessment, "Ops") }, label = { Text("Ops", fontWeight = FontWeight.Bold, fontSize = 9.sp) })
                    NavigationBarItem(selected = activeTab == "manifiesto", onClick = { activeTab = "manifiesto" },
                        icon = { Icon(Icons.Default.Receipt, "Manifiesto") }, label = { Text("Manif.", fontWeight = FontWeight.Bold, fontSize = 9.sp) })
                    NavigationBarItem(selected = activeTab == "pos", onClick = { activeTab = "pos" },
                        icon = { Icon(Icons.Default.PointOfSale, "POS") }, label = { Text("POS", fontWeight = FontWeight.Bold, fontSize = 9.sp) })
                    NavigationBarItem(selected = activeTab == "logs", onClick = { activeTab = "logs" },
                        icon = { Icon(Icons.Default.BugReport, "Logs") }, label = { Text("Logs", fontWeight = FontWeight.Bold, fontSize = 9.sp) })
                }
            } }
        ) { paddingValues ->
            Box(Modifier.fillMaxSize().padding(paddingValues).background(Color(0xFFF8FAFC))) {
                when (activeTab) {
                    "operations" -> CsvOperationsView(client = client, serverUrl = serverUrl, onLogsUpdate = { scannerLogs = it },
                        onSendToManifiesto = { code -> manifiestoPendingBarcode = code; activeTab = "manifiesto" })
                    "manifiesto" -> ManifiestoView(client = client, serverUrl = serverUrl,
                        barcodeInicial = manifiestoPendingBarcode,
                        onBarcodeConsumed = { manifiestoPendingBarcode = null })
                    "pos" -> POSView(client = client, serverUrl = serverUrl)
                    "logs" -> LogsView(serverUrl = serverUrl, scannerLogs = scannerLogs)
                    "appcatalog" -> AppCatalogView(client = client, serverUrl = serverUrl)
                    "config" -> ConfigTab(serverUrl = serverUrl, onUrlSaved = { serverUrl = it; Toast.makeText(context, "Servidor guardado", Toast.LENGTH_SHORT).show() })
                }
            }
        }
    }
}

@Composable
fun ConfigTab(serverUrl: String, onUrlSaved: (String) -> Unit) {
    var urlInput by remember { mutableStateOf(serverUrl) }
    Column(Modifier.fillMaxSize().padding(16.dp), Arrangement.spacedBy(14.dp)) {
        Card(Modifier.fillMaxWidth(), colors = CardDefaults.cardColors(containerColor = Color.White), shape = RoundedCornerShape(20.dp)) {
            Column(Modifier.padding(20.dp), Arrangement.spacedBy(10.dp)) {
                Text("Configuración del Servidor", fontWeight = FontWeight.Black, fontSize = 15.sp)
                Text("URL base del backend de Inventorio", fontSize = 11.sp, color = Color.Gray)
                OutlinedTextField(value = urlInput, onValueChange = { urlInput = it }, modifier = Modifier.fillMaxWidth(), label = { Text("URL del Servidor") }, singleLine = true)
                Button(onClick = { onUrlSaved(urlInput) }, modifier = Modifier.fillMaxWidth(), colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF0F172A)), shape = RoundedCornerShape(12.dp)) {
                    Text("Guardar Configuración", fontSize = 12.sp, fontWeight = FontWeight.Bold)
                }
            }
        }
    }
}
