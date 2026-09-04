package com.inventorio.conteo

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
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.FileProvider
import com.google.gson.Gson
import com.google.gson.reflect.TypeToken
import kotlinx.coroutines.Dispatchers
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

data class Caja(
    val id_caja: Int,
    val numero_caja: String,
    val sku: String?,
    val estado: String, // "vacia", "activa", "llena"
    val temporada_default: String?,
    val id_zona_almacen: Int?,
    val id_zona_seccion: Int?,
    val id_zona_nivel: Int?,
    val total_productos_unicos: Int?,
    val total_unidades: Int?,
    val tags: CajaTags?,
    val almacen_nombre: String?,
    val pasillo_nombre: String?,
    val seccion_nombre: String?
)

data class CajaTags(
    val tipo_producto: String?,
    val genero: String?,
    val marca: String?
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
    var activeTab by remember { mutableStateOf("conteo") }

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
                val req = Request.Builder().url("${serverUrl.trimEnd('/')}/api/android-version?app=conteo").build()
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
                        text = "Inventorio Conteo",
                        fontWeight = FontWeight.Black,
                        fontSize = 18.sp,
                        color = Color(0xFF0F172A)
                    )
                }
                HorizontalDivider(color = Color(0xFFF1F5F9))
                Spacer(modifier = Modifier.height(10.dp))

                listOf(
                    Triple("conteo", Icons.Default.Inventory, "Conteo Físico"),
                    Triple("contenedores", Icons.Default.List, "Contenedores Estatus"),
                    Triple("consulta", Icons.Default.ManageSearch, "Consulta Rápida"),
                    Triple("appcatalog", Icons.Default.Apps, "Catálogo Apps"),
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
                text = { Text("Hay una nueva versión de Inventorio Conteo (${updateAvailable!!.versionName}). Es recomendable descargarla para obtener las últimas funciones y correcciones.") },
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
                                            val file = File(dir, "inventorio_conteo_update_${System.currentTimeMillis()}.apk")
                                            file.writeBytes(bytes)
                                            
                                            withContext(Dispatchers.Main) {
                                                isDownloadingUpdate = false
                                                updateAvailable = null
                                                
                                                try {
                                                    val uri = FileProvider.getUriForFile(context, "com.inventorio.conteo.fileprovider", file)
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
                                    "conteo" -> "CONTEO FÍSICO"
                                    "contenedores" -> "CONTENEDORES"
                                    "consulta" -> "CONSULTA STOCK"
                                    "appcatalog" -> "CATÁLOGO APPS"
                                    else -> "CONFIGURACIÓN"
                                },
                                fontWeight = FontWeight.Black,
                                fontSize = 15.sp,
                                color = Color(0xFF0F172A)
                            )
                            
                            Box(
                                modifier = Modifier
                                    .padding(end = 8.dp)
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
                    },
                    navigationIcon = {
                        IconButton(onClick = { scope.launch { drawerState.open() } }) {
                            Icon(Icons.Default.Menu, contentDescription = "Menu")
                        }
                    },
                    actions = {},
                    colors = TopAppBarDefaults.topAppBarColors(containerColor = Color.White)
                )
            },
            bottomBar = {
                val showBottomBar = activeTab in listOf("conteo", "contenedores", "consulta", "appcatalog")
                if (showBottomBar) {
                    NavigationBar(containerColor = Color.White) {
                        NavigationBarItem(
                            selected = activeTab == "conteo",
                            onClick = { activeTab = "conteo" },
                            icon = { Icon(Icons.Default.Inventory, contentDescription = "Conteo") },
                            label = { Text("Conteo", fontWeight = FontWeight.Bold, fontSize = 9.sp) }
                        )
                        NavigationBarItem(
                            selected = activeTab == "contenedores",
                            onClick = { activeTab = "contenedores" },
                            icon = { Icon(Icons.Default.List, contentDescription = "Contenedores") },
                            label = { Text("Estatus", fontWeight = FontWeight.Bold, fontSize = 9.sp) }
                        )
                        NavigationBarItem(
                            selected = activeTab == "consulta",
                            onClick = { activeTab = "consulta" },
                            icon = { Icon(Icons.Default.ManageSearch, contentDescription = "Consulta") },
                            label = { Text("Consulta", fontWeight = FontWeight.Bold, fontSize = 9.sp) }
                        )
                        NavigationBarItem(
                            selected = activeTab == "appcatalog",
                            onClick = { activeTab = "appcatalog" },
                            icon = { Icon(Icons.Default.Apps, contentDescription = "Apps") },
                            label = { Text("Apps", fontWeight = FontWeight.Bold, fontSize = 9.sp) }
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
                    "conteo" -> {
                        ConteoView(
                            client = client,
                            serverUrl = serverUrl
                        )
                    }
                    "contenedores" -> {
                        ContenedoresStatusView(
                            client = client,
                            serverUrl = serverUrl
                        )
                    }
                    "consulta" -> {
                        ConsultaView(
                            client = client,
                            serverUrl = serverUrl
                        )
                    }
                    "appcatalog" -> {
                        AppCatalogView(
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
                            }
                        )
                    }
                }
            }
        }
    }
}

@Composable
fun ConfigTab(serverUrl: String, onUrlSaved: (String) -> Unit) {
    var urlInput by remember { mutableStateOf(serverUrl) }
    var autoApprove by remember { mutableStateOf(false) }
    var isLoadingSetting by remember { mutableStateOf(false) }
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val client = remember { OkHttpClient.Builder().connectTimeout(30, TimeUnit.SECONDS).readTimeout(30, TimeUnit.SECONDS).build() }
    val gson = remember { Gson() }

    LaunchedEffect(serverUrl) {
        scope.launch(Dispatchers.IO) {
            try {
                val req = Request.Builder().url("${serverUrl.trimEnd('/')}/api/inventory/auto-approve").build()
                client.newCall(req).execute().use { resp ->
                    if (resp.isSuccessful) {
                        val body = resp.body?.string() ?: "{}"
                        val data = gson.fromJson(body, Map::class.java)
                        withContext(Dispatchers.Main) { autoApprove = data["autoApprove"] == true }
                    }
                }
            } catch (_: Exception) {}
        }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
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
                    text = "Administración",
                    fontWeight = FontWeight.Black,
                    fontSize = 15.sp,
                    color = Color(0xFF0F172A)
                )
                HorizontalDivider(color = Color(0xFFF1F5F9))
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Column(modifier = Modifier.weight(1f)) {
                        Text(
                            text = "Auto-aprobación de Conteos",
                            fontWeight = FontWeight.Bold,
                            fontSize = 13.sp,
                            color = Color(0xFF0F172A)
                        )
                        Text(
                            text = if (autoApprove) "Los conteos se aprobarán automáticamente" else "Un administrador debe aprobar cada conteo manualmente",
                            fontSize = 10.sp,
                            color = Color.Gray
                        )
                    }
                    if (isLoadingSetting) {
                        CircularProgressIndicator(modifier = Modifier.size(24.dp), strokeWidth = 2.dp)
                    } else {
                        Switch(
                            checked = autoApprove,
                            onCheckedChange = { newVal ->
                                autoApprove = newVal
                                isLoadingSetting = true
                                scope.launch(Dispatchers.IO) {
                                    try {
                                        val json = gson.toJson(mapOf("autoApprove" to newVal))
                                        val req = Request.Builder()
                                            .url("${serverUrl.trimEnd('/')}/api/inventory/auto-approve")
                                            .put(json.toRequestBody("application/json".toMediaType()))
                                            .build()
                                        client.newCall(req).execute()
                                    } catch (_: Exception) {}
                                    withContext(Dispatchers.Main) { isLoadingSetting = false }
                                }
                            }
                        )
                    }
                }
            }
        }
    }
}
