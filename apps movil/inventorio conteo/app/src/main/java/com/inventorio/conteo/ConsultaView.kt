package com.inventorio.conteo

import android.Manifest
import android.content.pm.PackageManager
import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.camera.core.*
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.compose.animation.*
import androidx.compose.foundation.*
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
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import coil.compose.AsyncImage
import com.google.gson.Gson
import com.google.gson.annotations.SerializedName
import com.google.mlkit.vision.barcode.BarcodeScanning
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.common.InputImage
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.*
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

// ─── Data Models for Consulta ─────────────────────────────────────────────────

data class ConsultaBoxProducto(
    val id_producto: Int,
    val cantidad: Int,
    val productos: ConsultaProductoSimple?
)

data class ConsultaProductoSimple(
    val id_producto: Int,
    val sku: String,
    val ean_13: String?,
    val talla: String?,
    val tipo: String?,
    val temporada: String?,
    val marca_sub: String?,
    val has_foto: Boolean
)

data class ConsultaBoxResult(
    val id_caja: Int,
    val numero_caja: String,
    val sku: String?,
    val estado: String,
    val seccion_nombre: String?,
    val almacen_nombre: String?,
    val total_unidades: Int?,
    val temporada_default: String?,
    val productos: List<ConsultaBoxProducto>
)

data class ConsultaSeccionBox(
    val id_caja: Int,
    val numero_caja: String,
    val sku: String?,
    val estado: String,
    val total_unidades: Int?
)

data class ConsultaSeccionSection(
    val id_zona_seccion: Int,
    val nombre: String,
    val almacen_nombre: String?,
    val pasillo_nombre: String?
)

data class ConsultaSeccionResult(
    val section: ConsultaSeccionSection,
    val boxes: List<ConsultaSeccionBox>,
    val productos: List<ConsultaBoxProducto>
)

data class ConsultaProductoResult(
    val product: ConsultaProductoSimple,
    val boxes: List<ConsultaProductoBoxy>,
    val variantes: List<ConsultaModeloVariante>? = null
)

data class ConsultaProductoBoxy(
    val cantidad: Int,
    val cajas: ConsultaBoxRef?
)

data class ConsultaBoxRef(
    val id_caja: Int,
    val numero_caja: String,
    val sku: String?,
    val estado: String,
    val seccion_nombre: String?,
    val almacen_nombre: String?
)

data class ConsultaModeloVariante(
    val id_producto: Int,
    val sku: String,
    val ean_13: String?,
    val talla: String?,
    val tipo: String?,
    val marca_sub: String?,
    val has_foto: Boolean,
    val modelo_grupo: String?,
    val total_cantidad: Int
)

data class ConsultaModeloResult(
    val modelo_grupo: String,
    val variantes: List<ConsultaModeloVariante>,
    val total_unidades: Int
)

data class DinamicoResponse(
    val type: String,
    val data: Any?
)

// Sealed class for result state
sealed class ConsultaResultState {
    object Empty : ConsultaResultState()
    data class BoxResult(val box: ConsultaBoxResult) : ConsultaResultState()
    data class SeccionResult(val seccion: ConsultaSeccionResult) : ConsultaResultState()
    data class ProductoResult(val producto: ConsultaProductoResult) : ConsultaResultState()
    data class ModeloResult(val modelo: ConsultaModeloResult) : ConsultaResultState()
    data class BoxListResult(val boxes: List<ConsultaBoxResult>, val temporada: String) : ConsultaResultState()
    data class ProductListResult(val productos: List<ConsultaProductoSimple>) : ConsultaResultState()
}

// Local history entry
data class HistoryEntry(
    val label: String,
    val subtitle: String,
    val query: String
)

// ─── Main Composable ──────────────────────────────────────────────────────────

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ConsultaView(
    client: OkHttpClient,
    serverUrl: String
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val gson = remember { Gson() }

    // State
    var query by remember { mutableStateOf("") }
    var isLoading by remember { mutableStateOf(false) }
    var resultState by remember { mutableStateOf<ConsultaResultState>(ConsultaResultState.Empty) }
    var errorMessage by remember { mutableStateOf<String?>(null) }
    var isCameraActive by remember { mutableStateOf(false) }

    var hasCameraPermission by remember { mutableStateOf(
        ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED
    )}

    // Filters
    var filterBrand by remember { mutableStateOf("") }
    var filterSize by remember { mutableStateOf("") }
    var filterSeason by remember { mutableStateOf("") }
    var filterType by remember { mutableStateOf("") }
    var boxSeason by remember { mutableStateOf("") }
    var showFilters by remember { mutableStateOf(false) }
    var filterSeasons by remember { mutableStateOf<List<String>>(emptyList()) }
    var filterBrands by remember { mutableStateOf<List<String>>(emptyList()) }
    var filterTypes by remember { mutableStateOf<List<String>>(emptyList()) }

    // History
    var history by remember { mutableStateOf<List<HistoryEntry>>(emptyList()) }


    // Load filter options on start
    LaunchedEffect(Unit) {
        scope.launch(Dispatchers.IO) {
            try {
                val seasonsResp = client.newCall(
                    Request.Builder().url("${serverUrl.trimEnd('/')}/api/conceptos/temporadas").build()
                ).execute()
                val brandsResp = client.newCall(
                    Request.Builder().url("${serverUrl.trimEnd('/')}/api/conceptos/marcas").build()
                ).execute()
                val typesResp = client.newCall(
                    Request.Builder().url("${serverUrl.trimEnd('/')}/api/conceptos/tipos").build()
                ).execute()

                withContext(Dispatchers.Main) {
                    if (seasonsResp.isSuccessful) {
                        val body = seasonsResp.body?.string() ?: "[]"
                        val list = gson.fromJson(body, Array<Any>::class.java).map {
                            if (it is Map<*, *>) (it["nombre"] ?: it["temporada"] ?: "").toString()
                            else it.toString()
                        }.filter { it.isNotBlank() }
                        filterSeasons = list
                    }
                    if (brandsResp.isSuccessful) {
                        val body = brandsResp.body?.string() ?: "[]"
                        val list = gson.fromJson(body, Array<Any>::class.java).map {
                            if (it is Map<*, *>) (it["nombre"] ?: "").toString()
                            else it.toString()
                        }.filter { it.isNotBlank() }
                        filterBrands = list
                    }
                    if (typesResp.isSuccessful) {
                        val body = typesResp.body?.string() ?: "[]"
                        val list = gson.fromJson(body, Array<Any>::class.java).map {
                            if (it is Map<*, *>) (it["nombre"] ?: "").toString()
                            else it.toString()
                        }.filter { it.isNotBlank() }
                        filterTypes = list
                    }
                }
            } catch (_: Exception) {}
        }
    }

    fun addToHistory(label: String, subtitle: String, q: String) {
        val entry = HistoryEntry(label, subtitle, q)
        history = listOf(entry) + history.filter { it.query != q }.take(9)
    }

    fun doSearch(searchQuery: String, fallbackQuery: String? = null) {
        if (searchQuery.isBlank()) return
        isLoading = true
        errorMessage = null
        resultState = ConsultaResultState.Empty
        isCameraActive = false

        scope.launch(Dispatchers.IO) {
            try {
                val url = "${serverUrl.trimEnd('/')}/api/consultar-dinamico/${searchQuery.trim().encodeURL()}"
                val request = Request.Builder().url(url).build()
                client.newCall(request).execute().use { response ->
                    val body = response.body?.string() ?: ""
                    if (response.isSuccessful && body.isNotBlank()) {
                        val raw = gson.fromJson(body, Map::class.java)
                        val type = raw["type"]?.toString() ?: ""
                        withContext(Dispatchers.Main) {
                            when (type) {
                                "caja" -> {
                                    val data = gson.fromJson(gson.toJson(raw["data"]), ConsultaBoxResult::class.java)
                                    resultState = ConsultaResultState.BoxResult(data)
                                    addToHistory("Caja ${data.numero_caja}", data.sku ?: "Sin SKU", searchQuery)
                                }
                                "seccion" -> {
                                    val data = gson.fromJson(gson.toJson(raw["data"]), ConsultaSeccionResult::class.java)
                                    resultState = ConsultaResultState.SeccionResult(data)
                                    addToHistory("Sección ${data.section.nombre}", data.section.almacen_nombre ?: "", searchQuery)
                                }
                                "producto" -> {
                                    val data = gson.fromJson(gson.toJson(raw["data"]), ConsultaProductoResult::class.java)
                                    resultState = ConsultaResultState.ProductoResult(data)
                                    addToHistory("Producto ${data.product.sku}", data.product.talla ?: "", searchQuery)
                                }
                                "modelo" -> {
                                    val data = gson.fromJson(gson.toJson(raw["data"]), ConsultaModeloResult::class.java)
                                    resultState = ConsultaResultState.ModeloResult(data)
                                    addToHistory("Modelo ${data.modelo_grupo}", "${data.variantes.size} variante(s)", searchQuery)
                                }
                                else -> errorMessage = "Tipo de resultado desconocido"
                            }
                        }
                    } else {
                        if (!fallbackQuery.isNullOrBlank()) {
                            withContext(Dispatchers.Main) {
                                Toast.makeText(context, "Código no registrado, buscando por modelo...", Toast.LENGTH_SHORT).show()
                            }
                            val fallbackUrl = "${serverUrl.trimEnd('/')}/api/consultar-dinamico/${fallbackQuery.trim().encodeURL()}"
                            val fallbackRequest = Request.Builder().url(fallbackUrl).build()
                            client.newCall(fallbackRequest).execute().use { fallbackResponse ->
                                val fallbackBody = fallbackResponse.body?.string() ?: ""
                                if (fallbackResponse.isSuccessful && fallbackBody.isNotBlank()) {
                                    val raw = gson.fromJson(fallbackBody, Map::class.java)
                                    val type = raw["type"]?.toString() ?: ""
                                    withContext(Dispatchers.Main) {
                                        query = fallbackQuery
                                        when (type) {
                                            "caja" -> {
                                                val data = gson.fromJson(gson.toJson(raw["data"]), ConsultaBoxResult::class.java)
                                                resultState = ConsultaResultState.BoxResult(data)
                                                addToHistory("Caja ${data.numero_caja}", data.sku ?: "Sin SKU", fallbackQuery)
                                            }
                                            "seccion" -> {
                                                val data = gson.fromJson(gson.toJson(raw["data"]), ConsultaSeccionResult::class.java)
                                                resultState = ConsultaResultState.SeccionResult(data)
                                                addToHistory("Sección ${data.section.nombre}", data.section.almacen_nombre ?: "", fallbackQuery)
                                            }
                                            "producto" -> {
                                                val data = gson.fromJson(gson.toJson(raw["data"]), ConsultaProductoResult::class.java)
                                                resultState = ConsultaResultState.ProductoResult(data)
                                                addToHistory("Producto ${data.product.sku}", data.product.talla ?: "", fallbackQuery)
                                            }
                                            "modelo" -> {
                                                val data = gson.fromJson(gson.toJson(raw["data"]), ConsultaModeloResult::class.java)
                                                resultState = ConsultaResultState.ModeloResult(data)
                                                addToHistory("Modelo ${data.modelo_grupo}", "${data.variantes.size} variante(s)", fallbackQuery)
                                            }
                                            else -> errorMessage = "Tipo de resultado desconocido"
                                        }
                                    }
                                } else {
                                    withContext(Dispatchers.Main) {
                                        errorMessage = "Código y modelo no encontrados"
                                    }
                                }
                            }
                        } else {
                            withContext(Dispatchers.Main) {
                                errorMessage = if (body.isNotBlank()) {
                                    try { gson.fromJson(body, Map::class.java)["error"]?.toString() ?: "No encontrado" }
                                    catch (_: Exception) { "No encontrado" }
                                } else "No encontrado"
                            }
                        }
                    }
                }
            } catch (e: Exception) {
                withContext(Dispatchers.Main) {
                    errorMessage = "Error de conexión: ${e.message}"
                }
            } finally {
                withContext(Dispatchers.Main) { isLoading = false }
            }
        }
    }

    fun doBoxSeasonSearch(season: String) {
        if (season.isBlank()) {
            resultState = ConsultaResultState.Empty
            return
        }
        isLoading = true
        errorMessage = null
        scope.launch(Dispatchers.IO) {
            try {
                val url = "${serverUrl.trimEnd('/')}/api/cajas?temporada_default=${season.encodeURL()}"
                val request = Request.Builder().url(url).build()
                client.newCall(request).execute().use { response ->
                    val body = response.body?.string() ?: "[]"
                    if (response.isSuccessful) {
                        val list = gson.fromJson(body, Array<ConsultaBoxResult>::class.java).toList()
                        withContext(Dispatchers.Main) {
                            resultState = ConsultaResultState.BoxListResult(list, season)
                        }
                    } else {
                        withContext(Dispatchers.Main) { errorMessage = "Error al filtrar cajas" }
                    }
                }
            } catch (e: Exception) {
                withContext(Dispatchers.Main) { errorMessage = "Error: ${e.message}" }
            } finally {
                withContext(Dispatchers.Main) { isLoading = false }
            }
        }
    }

    fun doProductFilter() {
        isLoading = true
        errorMessage = null
        scope.launch(Dispatchers.IO) {
            try {
                val params = buildString {
                    if (query.isNotBlank()) append("q=${query.trim().encodeURL()}&")
                    if (filterBrand.isNotBlank()) append("marca=${filterBrand.encodeURL()}&")
                    if (filterSize.isNotBlank()) append("talla=${filterSize.encodeURL()}&")
                    if (filterSeason.isNotBlank()) append("temporada=${filterSeason.encodeURL()}&")
                    if (filterType.isNotBlank()) append("tipo=${filterType.encodeURL()}&")
                }.trimEnd('&')
                val url = "${serverUrl.trimEnd('/')}/api/productos?$params"
                val request = Request.Builder().url(url).build()
                client.newCall(request).execute().use { response ->
                    val body = response.body?.string() ?: "[]"
                    if (response.isSuccessful) {
                        val list = gson.fromJson(body, Array<ConsultaProductoSimple>::class.java).toList()
                        withContext(Dispatchers.Main) {
                            resultState = ConsultaResultState.ProductListResult(list)
                        }
                    } else {
                        withContext(Dispatchers.Main) { errorMessage = "Error al filtrar productos" }
                    }
                }
            } catch (e: Exception) {
                withContext(Dispatchers.Main) { errorMessage = "Error: ${e.message}" }
            } finally {
                withContext(Dispatchers.Main) { isLoading = false }
            }
        }
    }

    val permissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted ->
        hasCameraPermission = granted
        if (granted) isCameraActive = true
    }

    LazyColumn(
        modifier = Modifier
            .fillMaxSize()
            .background(Color(0xFFF8FAFC)),
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp)
    ) {
        // ── Search Bar ──────────────────────────────────────────────────────
        item {
            Card(
                shape = RoundedCornerShape(20.dp),
                colors = CardDefaults.cardColors(containerColor = Color.White),
                elevation = CardDefaults.cardElevation(2.dp)
            ) {
                Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Default.Search, contentDescription = null, tint = Color(0xFF0F172A), modifier = Modifier.size(18.dp))
                        Spacer(Modifier.width(6.dp))
                        Text("Escáner Inteligente", fontWeight = FontWeight.Black, fontSize = 15.sp, color = Color(0xFF0F172A))
                    }
                    Text("Busca por SKU, EAN, Caja, Sección o Modelo", fontSize = 11.sp, color = Color.Gray)

                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        OutlinedTextField(
                            value = query,
                            onValueChange = { query = it },
                            modifier = Modifier.weight(1f),
                            placeholder = { Text("SKU, EAN, CJ-X, Sección...", fontSize = 12.sp) },
                            singleLine = true,
                            shape = RoundedCornerShape(12.dp),
                            keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(
                                imeAction = androidx.compose.ui.text.input.ImeAction.Search
                            ),
                            keyboardActions = androidx.compose.foundation.text.KeyboardActions(
                                onSearch = { doSearch(query) }
                            )
                        )
                        IconButton(
                            onClick = { doSearch(query) },
                            enabled = !isLoading,
                            modifier = Modifier
                                .size(52.dp)
                                .clip(RoundedCornerShape(12.dp))
                                .background(Color(0xFF0F172A))
                        ) {
                            if (isLoading) CircularProgressIndicator(color = Color.White, modifier = Modifier.size(18.dp), strokeWidth = 2.dp)
                            else Icon(Icons.Default.Search, contentDescription = "Buscar", tint = Color.White)
                        }
                    }

                    // Camera button (escáner de códigos en vivo)
                    Button(
                        onClick = {
                            if (hasCameraPermission) {
                                isCameraActive = !isCameraActive
                            } else {
                                permissionLauncher.launch(Manifest.permission.CAMERA)
                            }
                        },
                        modifier = Modifier.fillMaxWidth(),
                        shape = RoundedCornerShape(12.dp),
                        colors = ButtonDefaults.buttonColors(
                            containerColor = if (isCameraActive) Color(0xFFDC2626) else Color(0xFFF59E0B)
                        )
                    ) {
                        Icon(
                            if (isCameraActive) Icons.Default.CameraAlt else Icons.Default.QrCodeScanner,
                            contentDescription = null,
                            modifier = Modifier.size(16.dp),
                            tint = if (isCameraActive) Color.White else Color(0xFF0F172A)
                        )
                        Spacer(Modifier.width(6.dp))
                        Text(
                            if (isCameraActive) "Apagar Cámara" else "Activar Cámara Barcode",
                            fontWeight = FontWeight.Black,
                            fontSize = 12.sp,
                            color = if (isCameraActive) Color.White else Color(0xFF0F172A)
                        )
                    }

                    // Camera preview
                    AnimatedVisibility(visible = isCameraActive) {
                        ConsultaCameraScanner(
                            onBarcodeDetected = { barcode ->
                                isCameraActive = false
                                query = barcode
                                doSearch(barcode)
                            },
                            onClose = { isCameraActive = false }
                        )
                    }
                }
            }
        }

        // ── Filters Toggle ──────────────────────────────────────────────────
        item {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                OutlinedButton(
                    onClick = { showFilters = !showFilters },
                    modifier = Modifier.weight(1f),
                    shape = RoundedCornerShape(12.dp)
                ) {
                    Icon(Icons.Default.FilterList, contentDescription = null, modifier = Modifier.size(14.dp))
                    Spacer(Modifier.width(4.dp))
                    Text(
                        if (showFilters) "Ocultar Filtros" else "Filtros Avanzados",
                        fontSize = 11.sp,
                        fontWeight = FontWeight.Bold
                    )
                }
            }
        }

        // ── Advanced Filters ────────────────────────────────────────────────
        if (showFilters) {
            item {
                Card(
                    shape = RoundedCornerShape(20.dp),
                    colors = CardDefaults.cardColors(containerColor = Color.White),
                    elevation = CardDefaults.cardElevation(2.dp)
                ) {
                    Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        Text("Filtros de Producto", fontWeight = FontWeight.Black, fontSize = 13.sp, color = Color(0xFF0F172A))

                        // Brand dropdown
                        ConsultaDropdown(
                            label = "MARCA",
                            options = filterBrands,
                            selected = filterBrand,
                            onSelect = { filterBrand = it },
                            placeholder = "Todas las marcas"
                        )
                        // Season dropdown
                        ConsultaDropdown(
                            label = "TEMPORADA",
                            options = filterSeasons,
                            selected = filterSeason,
                            onSelect = { filterSeason = it },
                            placeholder = "Todas las temporadas"
                        )
                        // Type dropdown
                        ConsultaDropdown(
                            label = "TIPO",
                            options = filterTypes,
                            selected = filterType,
                            onSelect = { filterType = it },
                            placeholder = "Todos los tipos"
                        )
                        // Size
                        ConsultaDropdown(
                            label = "TALLA",
                            options = listOf("XS","S","M","L","XL","XXL","38","40","42","44","46","48"),
                            selected = filterSize,
                            onSelect = { filterSize = it },
                            placeholder = "Todas las tallas"
                        )

                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            Button(
                                onClick = { doProductFilter() },
                                modifier = Modifier.weight(1f),
                                shape = RoundedCornerShape(12.dp),
                                colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF0F172A))
                            ) {
                                Icon(Icons.Default.Search, contentDescription = null, modifier = Modifier.size(14.dp))
                                Spacer(Modifier.width(4.dp))
                                Text("Filtrar Productos", fontSize = 11.sp, fontWeight = FontWeight.Bold)
                            }
                            if (filterBrand.isNotBlank() || filterSeason.isNotBlank() || filterType.isNotBlank() || filterSize.isNotBlank()) {
                                OutlinedButton(
                                    onClick = {
                                        filterBrand = ""; filterSeason = ""; filterType = ""; filterSize = ""
                                        resultState = ConsultaResultState.Empty
                                    },
                                    shape = RoundedCornerShape(12.dp)
                                ) {
                                    Icon(Icons.Default.Clear, contentDescription = null, modifier = Modifier.size(14.dp))
                                    Spacer(Modifier.width(4.dp))
                                    Text("Limpiar", fontSize = 11.sp)
                                }
                            }
                        }

                        HorizontalDivider(color = Color(0xFFF1F5F9))

                        // Box by season filter
                        Text("Filtro de Cajas por Temporada", fontWeight = FontWeight.Black, fontSize = 13.sp, color = Color(0xFF0F172A))
                        ConsultaDropdown(
                            label = "TEMPORADA",
                            options = filterSeasons,
                            selected = boxSeason,
                            onSelect = { boxSeason = it; doBoxSeasonSearch(it) },
                            placeholder = "Selecciona temporada"
                        )
                    }
                }
            }
        }

        // ── Error ────────────────────────────────────────────────────────────
        if (errorMessage != null) {
            item {
                Card(
                    shape = RoundedCornerShape(16.dp),
                    colors = CardDefaults.cardColors(containerColor = Color(0xFFFEF2F2))
                ) {
                    Row(modifier = Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Default.Error, contentDescription = null, tint = Color(0xFFDC2626), modifier = Modifier.size(18.dp))
                        Spacer(Modifier.width(8.dp))
                        Text(errorMessage ?: "", color = Color(0xFFDC2626), fontSize = 12.sp, fontWeight = FontWeight.Bold)
                    }
                }
            }
        }

        // ── Results ──────────────────────────────────────────────────────────
        when (val state = resultState) {
            is ConsultaResultState.Empty -> {
                // History
                if (history.isNotEmpty()) {
                    item {
                        Text("Historial Reciente", fontWeight = FontWeight.Black, fontSize = 13.sp, color = Color(0xFF0F172A))
                    }
                    items(history) { entry ->
                        ConsultaHistoryItem(entry = entry, onClick = {
                            query = entry.query
                            doSearch(entry.query)
                        })
                    }
                } else {
                    item {
                        Box(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(32.dp),
                            contentAlignment = Alignment.Center
                        ) {
                            Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp)) {
                                Icon(Icons.Default.Search, contentDescription = null, tint = Color.LightGray, modifier = Modifier.size(48.dp))
                                Text("Busca un código, caja o producto", color = Color.Gray, fontSize = 12.sp, textAlign = TextAlign.Center)
                            }
                        }
                    }
                }
            }

            is ConsultaResultState.BoxResult -> {
                item { ConsultaBoxCard(box = state.box, serverUrl = serverUrl) }
            }

            is ConsultaResultState.SeccionResult -> {
                item { ConsultaSeccionCard(seccion = state.seccion) }
            }

            is ConsultaResultState.ProductoResult -> {
                item {
                    ConsultaProductoCard(
                        producto = state.producto,
                        serverUrl = serverUrl,
                        onProductClick = { sku ->
                            query = sku
                            doSearch(sku)
                        }
                    )
                }
            }

            is ConsultaResultState.ModeloResult -> {
                item {
                    ConsultaModeloHeader(modelo = state.modelo)
                }
                items(state.modelo.variantes) { variante ->
                    ConsultaVarianteCard(
                        variante = variante,
                        serverUrl = serverUrl,
                        onClick = {
                            query = variante.sku
                            doSearch(variante.sku)
                        }
                    )
                }
            }

            is ConsultaResultState.BoxListResult -> {
                item {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text(
                            "${state.boxes.size} Caja(s) · ${state.temporada.uppercase()}",
                            fontWeight = FontWeight.Black,
                            fontSize = 13.sp,
                            color = Color(0xFF0F172A)
                        )
                        TextButton(onClick = { resultState = ConsultaResultState.Empty; boxSeason = "" }) {
                            Text("Limpiar", fontSize = 10.sp)
                        }
                    }
                }
                items(state.boxes) { box ->
                    ConsultaBoxMiniCard(box = box, onClick = {
                        query = box.numero_caja
                        doSearch(box.numero_caja)
                    })
                }
            }

            is ConsultaResultState.ProductListResult -> {
                item {
                    Text(
                        "${state.productos.size} Producto(s) encontrado(s)",
                        fontWeight = FontWeight.Black,
                        fontSize = 13.sp,
                        color = Color(0xFF0F172A)
                    )
                }
                items(state.productos) { prod ->
                    ConsultaProductoMiniCard(prod = prod, serverUrl = serverUrl, onClick = {
                        query = prod.sku
                        doSearch(prod.sku)
                    })
                }
            }
        }
    }
}

// ─── Camera Scanner Composable ────────────────────────────────────────────────

@Composable
fun ConsultaCameraScanner(
    onBarcodeDetected: (String) -> Unit,
    onClose: () -> Unit
) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    var isScanning by remember { mutableStateOf(true) }
    val cameraExecutor: ExecutorService = remember { Executors.newSingleThreadExecutor() }

    DisposableEffect(Unit) {
        onDispose { cameraExecutor.shutdown() }
    }

    Box(
        modifier = Modifier
            .fillMaxWidth()
            .height(240.dp)
            .clip(RoundedCornerShape(16.dp))
            .background(Color.Black)
    ) {
        AndroidView(
            factory = { ctx ->
                val previewView = PreviewView(ctx)
                val cameraProviderFuture = ProcessCameraProvider.getInstance(ctx)
                cameraProviderFuture.addListener({
                    val cameraProvider = cameraProviderFuture.get()
                    val preview = Preview.Builder().build().also {
                        it.setSurfaceProvider(previewView.surfaceProvider)
                    }
                    val barcodeScanner = BarcodeScanning.getClient()
                    val imageAnalyzer = ImageAnalysis.Builder()
                        .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                        .build()
                        .also { analysis ->
                            analysis.setAnalyzer(cameraExecutor) { imageProxy ->
                                if (!isScanning) {
                                    imageProxy.close()
                                    return@setAnalyzer
                                }
                                val mediaImage = imageProxy.image
                                if (mediaImage != null) {
                                    val image = InputImage.fromMediaImage(
                                        mediaImage,
                                        imageProxy.imageInfo.rotationDegrees
                                    )
                                    barcodeScanner.process(image)
                                        .addOnSuccessListener { barcodes ->
                                            barcodes.firstOrNull()?.let { barcode ->
                                                val raw = barcode.rawValue
                                                if (!raw.isNullOrBlank()) {
                                                    isScanning = false
                                                    onBarcodeDetected(raw)
                                                }
                                            }
                                        }
                                        .addOnCompleteListener { imageProxy.close() }
                                } else {
                                    imageProxy.close()
                                }
                            }
                        }
                    try {
                        cameraProvider.unbindAll()
                        cameraProvider.bindToLifecycle(
                            lifecycleOwner,
                            CameraSelector.DEFAULT_BACK_CAMERA,
                            preview,
                            imageAnalyzer
                        )
                    } catch (e: Exception) {
                        Toast.makeText(ctx, "Error de cámara: ${e.message}", Toast.LENGTH_SHORT).show()
                    }
                }, ContextCompat.getMainExecutor(ctx))
                previewView
            },
            modifier = Modifier.fillMaxSize()
        )

        // Corner indicators overlay
        Box(modifier = Modifier.fillMaxSize()) {
            Box(modifier = Modifier
                .size(40.dp)
                .align(Alignment.TopStart)
                .padding(8.dp)
                .border(3.dp, Color(0xFFF59E0B), RoundedCornerShape(topStart = 8.dp)))
            Box(modifier = Modifier
                .size(40.dp)
                .align(Alignment.TopEnd)
                .padding(8.dp)
                .border(3.dp, Color(0xFFF59E0B), RoundedCornerShape(topEnd = 8.dp)))
            Box(modifier = Modifier
                .size(40.dp)
                .align(Alignment.BottomStart)
                .padding(8.dp)
                .border(3.dp, Color(0xFFF59E0B), RoundedCornerShape(bottomStart = 8.dp)))
            Box(modifier = Modifier
                .size(40.dp)
                .align(Alignment.BottomEnd)
                .padding(8.dp)
                .border(3.dp, Color(0xFFF59E0B), RoundedCornerShape(bottomEnd = 8.dp)))
        }

        Text(
            "Apunta al código de barras",
            color = Color.White.copy(alpha = 0.85f),
            fontSize = 11.sp,
            fontWeight = FontWeight.Bold,
            modifier = Modifier
                .align(Alignment.BottomCenter)
                .padding(bottom = 12.dp)
                .background(Color.Black.copy(alpha = 0.5f), RoundedCornerShape(8.dp))
                .padding(horizontal = 10.dp, vertical = 4.dp)
        )
    }
}

// ─── Result Cards ─────────────────────────────────────────────────────────────

@Composable
fun ConsultaBoxCard(box: ConsultaBoxResult, serverUrl: String) {
    Card(
        shape = RoundedCornerShape(20.dp),
        colors = CardDefaults.cardColors(containerColor = Color.White),
        elevation = CardDefaults.cardElevation(4.dp)
    ) {
        Column {
            // Header
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(Color(0xFF0F172A))
                    .padding(16.dp)
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Box(
                        modifier = Modifier
                            .size(44.dp)
                            .clip(RoundedCornerShape(12.dp))
                            .background(Color(0xFFF59E0B)),
                        contentAlignment = Alignment.Center
                    ) {
                        Icon(Icons.Default.Inbox, contentDescription = null, tint = Color(0xFF0F172A), modifier = Modifier.size(22.dp))
                    }
                    Spacer(Modifier.width(12.dp))
                    Column(modifier = Modifier.weight(1f)) {
                        Text("Caja ${box.numero_caja}", color = Color.White, fontWeight = FontWeight.Black, fontSize = 18.sp)
                        Text(box.sku ?: "Sin SKU", color = Color.Gray, fontSize = 11.sp, fontFamily = FontFamily.Monospace)
                        if (box.almacen_nombre != null) {
                            Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(top = 4.dp)) {
                                Icon(Icons.Default.LocationOn, contentDescription = null, tint = Color(0xFFF59E0B), modifier = Modifier.size(12.dp))
                                Spacer(Modifier.width(3.dp))
                                Text(
                                    "${box.almacen_nombre}${if (box.seccion_nombre != null) " · ${box.seccion_nombre}" else ""}",
                                    color = Color(0xFFF59E0B),
                                    fontSize = 10.sp,
                                    fontWeight = FontWeight.Bold
                                )
                            }
                        }
                    }
                    val estadoColor = when (box.estado) {
                        "llena" -> Color(0xFFDC2626)
                        "activa" -> Color(0xFFF59E0B)
                        else -> Color(0xFF6B7280)
                    }
                    Box(
                        modifier = Modifier
                            .background(estadoColor, RoundedCornerShape(8.dp))
                            .padding(horizontal = 8.dp, vertical = 4.dp)
                    ) {
                        Text(box.estado.uppercase(), color = if (box.estado == "activa") Color(0xFF0F172A) else Color.White, fontSize = 9.sp, fontWeight = FontWeight.Black)
                    }
                }
            }

            // Content
            Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text("Contenido de la Caja", fontWeight = FontWeight.Black, fontSize = 12.sp, color = Color.Gray)
                    Box(
                        modifier = Modifier
                            .background(Color(0xFF0F172A), RoundedCornerShape(8.dp))
                            .padding(horizontal = 8.dp, vertical = 4.dp)
                    ) {
                        Text("${box.productos.sumOf { it.cantidad }} Uds", color = Color.White, fontSize = 10.sp, fontWeight = FontWeight.Bold)
                    }
                }

                if (box.productos.isEmpty()) {
                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(24.dp),
                        contentAlignment = Alignment.Center
                    ) {
                        Text("Esta caja no contiene productos", color = Color.Gray, fontSize = 11.sp, textAlign = TextAlign.Center)
                    }
                } else {
                    box.productos.forEach { item ->
                        item.productos?.let { prod ->
                            ConsultaProductRowItem(prod = prod, cantidad = item.cantidad, serverUrl = serverUrl)
                        }
                    }
                }
            }
        }
    }
}

@Composable
fun ConsultaProductRowItem(prod: ConsultaProductoSimple, cantidad: Int, serverUrl: String) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .background(Color(0xFFF8FAFC), RoundedCornerShape(10.dp))
            .padding(8.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        // Thumbnail
        val imageUrl = "${serverUrl.trimEnd('/')}/api/productos/${prod.id_producto}/image"
        if (prod.has_foto) {
            AsyncImage(
                model = imageUrl,
                contentDescription = prod.sku,
                modifier = Modifier
                    .size(44.dp)
                    .clip(RoundedCornerShape(8.dp))
                    .background(Color(0xFFF1F5F9)),
                contentScale = ContentScale.Crop
            )
        } else {
            Box(
                modifier = Modifier
                    .size(44.dp)
                    .clip(RoundedCornerShape(8.dp))
                    .background(Color(0xFFF1F5F9)),
                contentAlignment = Alignment.Center
            ) {
                Icon(Icons.Default.Image, contentDescription = null, tint = Color.LightGray, modifier = Modifier.size(20.dp))
            }
        }
        Spacer(Modifier.width(10.dp))
        Column(modifier = Modifier.weight(1f)) {
            Text(prod.sku, fontWeight = FontWeight.Black, fontSize = 12.sp, color = Color(0xFF0F172A))
            Text(prod.ean_13 ?: "Sin EAN", fontSize = 10.sp, color = Color.Gray, fontFamily = FontFamily.Monospace)
            Row(horizontalArrangement = Arrangement.spacedBy(4.dp), modifier = Modifier.padding(top = 2.dp)) {
                if (!prod.tipo.isNullOrBlank()) ConsultaChip(prod.tipo)
                if (!prod.talla.isNullOrBlank()) ConsultaChip(prod.talla)
                if (!prod.temporada.isNullOrBlank()) ConsultaChip(prod.temporada)
            }
        }
        Box(
            modifier = Modifier
                .background(Color(0xFF0F172A), RoundedCornerShape(8.dp))
                .padding(horizontal = 8.dp, vertical = 4.dp)
        ) {
            Text("$cantidad", color = Color.White, fontWeight = FontWeight.Black, fontSize = 11.sp)
        }
    }
}

@Composable
fun ConsultaChip(text: String) {
    Box(
        modifier = Modifier
            .background(Color(0xFFF1F5F9), RoundedCornerShape(4.dp))
            .padding(horizontal = 5.dp, vertical = 2.dp)
    ) {
        Text(text.uppercase(), fontSize = 8.sp, fontWeight = FontWeight.Bold, color = Color(0xFF475569))
    }
}

@Composable
fun ConsultaSeccionCard(seccion: ConsultaSeccionResult) {
    Card(
        shape = RoundedCornerShape(20.dp),
        colors = CardDefaults.cardColors(containerColor = Color.White),
        elevation = CardDefaults.cardElevation(4.dp)
    ) {
        Column {
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(Color(0xFF0F172A))
                    .padding(16.dp)
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Box(
                        modifier = Modifier
                            .size(44.dp)
                            .clip(RoundedCornerShape(12.dp))
                            .background(Color(0xFFF59E0B)),
                        contentAlignment = Alignment.Center
                    ) {
                        Icon(Icons.Default.LocationOn, contentDescription = null, tint = Color(0xFF0F172A), modifier = Modifier.size(22.dp))
                    }
                    Spacer(Modifier.width(12.dp))
                    Column {
                        Text("Sección: ${seccion.section.nombre.uppercase()}", color = Color.White, fontWeight = FontWeight.Black, fontSize = 16.sp)
                        if (seccion.section.almacen_nombre != null) {
                            Text("📍 ${seccion.section.almacen_nombre}", color = Color(0xFFF59E0B), fontSize = 10.sp, fontWeight = FontWeight.Bold)
                        }
                        if (seccion.section.pasillo_nombre != null) {
                            Text("🚪 Pasillo: ${seccion.section.pasillo_nombre}", color = Color(0xFFAFB8C4), fontSize = 10.sp)
                        }
                    }
                }
            }
            Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text("Cajas en esta sección (${seccion.boxes.size})", fontWeight = FontWeight.Black, fontSize = 12.sp, color = Color.Gray)
                seccion.boxes.forEach { box ->
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .background(Color(0xFFF8FAFC), RoundedCornerShape(10.dp))
                            .padding(10.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        val estadoColor = when (box.estado) {
                            "llena" -> Color(0xFFDC2626)
                            "activa" -> Color(0xFFF59E0B)
                            else -> Color(0xFF6B7280)
                        }
                        Box(
                            modifier = Modifier
                                .size(32.dp)
                                .clip(RoundedCornerShape(8.dp))
                                .background(estadoColor),
                            contentAlignment = Alignment.Center
                        ) {
                            Icon(Icons.Default.Inbox, contentDescription = null, tint = Color.White, modifier = Modifier.size(16.dp))
                        }
                        Spacer(Modifier.width(10.dp))
                        Column(modifier = Modifier.weight(1f)) {
                            Text("Caja ${box.numero_caja}", fontWeight = FontWeight.Black, fontSize = 12.sp, color = Color(0xFF0F172A))
                            Text(box.sku ?: "Sin SKU", fontSize = 9.sp, color = Color.Gray, fontFamily = FontFamily.Monospace)
                        }
                        Text("${box.total_unidades ?: 0} uds", fontSize = 10.sp, fontWeight = FontWeight.Bold, color = Color(0xFF0F172A))
                    }
                }
            }
        }
    }
}

@Composable
fun ConsultaProductoCard(
    producto: ConsultaProductoResult, 
    serverUrl: String,
    onProductClick: (String) -> Unit
) {
    val prod = producto.product
    Card(
        shape = RoundedCornerShape(20.dp),
        colors = CardDefaults.cardColors(containerColor = Color.White),
        elevation = CardDefaults.cardElevation(4.dp)
    ) {
        Column {
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(
                        Brush.horizontalGradient(listOf(Color(0xFF0F172A), Color(0xFF1E293B)))
                    )
                    .padding(16.dp)
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    val imageUrl = "${serverUrl.trimEnd('/')}/api/productos/${prod.id_producto}/image"
                    if (prod.has_foto) {
                        AsyncImage(
                            model = imageUrl,
                            contentDescription = prod.sku,
                            modifier = Modifier
                                .size(60.dp)
                                .clip(RoundedCornerShape(12.dp)),
                            contentScale = ContentScale.Crop
                        )
                    } else {
                        Box(
                            modifier = Modifier
                                .size(60.dp)
                                .clip(RoundedCornerShape(12.dp))
                                .background(Color(0xFF334155)),
                            contentAlignment = Alignment.Center
                        ) {
                            Icon(Icons.Default.Image, contentDescription = null, tint = Color.Gray, modifier = Modifier.size(28.dp))
                        }
                    }
                    Spacer(Modifier.width(12.dp))
                    Column(modifier = Modifier.weight(1f)) {
                        Text(prod.sku, color = Color.White, fontWeight = FontWeight.Black, fontSize = 18.sp)
                        Text(prod.ean_13 ?: "Sin EAN", color = Color.Gray, fontSize = 10.sp, fontFamily = FontFamily.Monospace)
                        Row(horizontalArrangement = Arrangement.spacedBy(4.dp), modifier = Modifier.padding(top = 4.dp)) {
                            if (!prod.talla.isNullOrBlank()) ConsultaChip(prod.talla)
                            if (!prod.tipo.isNullOrBlank()) ConsultaChip(prod.tipo)
                            if (!prod.temporada.isNullOrBlank()) ConsultaChip(prod.temporada)
                            if (!prod.marca_sub.isNullOrBlank()) ConsultaChip(prod.marca_sub)
                        }
                    }
                }
            }

            Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("Ubicaciones en Cajas", fontWeight = FontWeight.Black, fontSize = 12.sp, color = Color.Gray)
                if (producto.boxes.isEmpty()) {
                    Text("No hay cajas con este producto", color = Color.Gray, fontSize = 11.sp)
                } else {
                    producto.boxes.forEach { boxy ->
                        boxy.cajas?.let { caja ->
                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .background(Color(0xFFF8FAFC), RoundedCornerShape(10.dp))
                                    .padding(10.dp),
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.SpaceBetween
                            ) {
                                Column {
                                    Text("Caja ${caja.numero_caja}", fontWeight = FontWeight.Black, fontSize = 12.sp)
                                    if (caja.almacen_nombre != null) {
                                        Text("📍 ${caja.almacen_nombre}${if (caja.seccion_nombre != null) " · ${caja.seccion_nombre}" else ""}", fontSize = 10.sp, color = Color.Gray)
                                    }
                                }
                                Box(
                                    modifier = Modifier
                                        .background(Color(0xFF0F172A), RoundedCornerShape(8.dp))
                                        .padding(horizontal = 8.dp, vertical = 4.dp)
                                ) {
                                    Text("${boxy.cantidad} uds", color = Color.White, fontSize = 10.sp, fontWeight = FontWeight.Bold)
                                }
                            }
                        }
                    }
                }

                if (!producto.variantes.isNullOrEmpty()) {
                    Spacer(Modifier.height(12.dp))
                    HorizontalDivider(color = Color(0xFFF1F5F9))
                    Spacer(Modifier.height(8.dp))
                    Text("Otras Variantes en Tallas (Mismo Estilo)", fontWeight = FontWeight.Black, fontSize = 12.sp, color = Color.Gray)
                    Spacer(Modifier.height(4.dp))
                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        producto.variantes.forEach { variante ->
                            ConsultaVarianteCard(
                                variante = variante,
                                serverUrl = serverUrl,
                                onClick = { onProductClick(variante.sku) }
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
fun ConsultaModeloHeader(modelo: ConsultaModeloResult) {
    Card(
        shape = RoundedCornerShape(20.dp),
        colors = CardDefaults.cardColors(containerColor = Color.White),
        elevation = CardDefaults.cardElevation(4.dp)
    ) {
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .background(Brush.horizontalGradient(listOf(Color(0xFF0F172A), Color(0xFF1E3A5F))))
                .padding(20.dp)
        ) {
            Column {
                Text("Modelo / Grupo", color = Color.Gray, fontSize = 11.sp, fontWeight = FontWeight.Bold)
                Text(modelo.modelo_grupo, color = Color.White, fontWeight = FontWeight.Black, fontSize = 22.sp)
                Spacer(Modifier.height(8.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Box(
                        modifier = Modifier
                            .background(Color(0xFFF59E0B), RoundedCornerShape(8.dp))
                            .padding(horizontal = 10.dp, vertical = 4.dp)
                    ) {
                        Text("${modelo.total_unidades} Uds Total", color = Color(0xFF0F172A), fontSize = 10.sp, fontWeight = FontWeight.Black)
                    }
                    Box(
                        modifier = Modifier
                            .background(Color(0xFF1E293B), RoundedCornerShape(8.dp))
                            .padding(horizontal = 10.dp, vertical = 4.dp)
                    ) {
                        Text("${modelo.variantes.size} Variante(s)", color = Color.White, fontSize = 10.sp, fontWeight = FontWeight.Black)
                    }
                }
            }
        }
    }
}

@Composable
fun ConsultaVarianteCard(variante: ConsultaModeloVariante, serverUrl: String, onClick: (() -> Unit)? = null) {
    Card(
        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(containerColor = Color.White),
        elevation = CardDefaults.cardElevation(2.dp),
        border = androidx.compose.foundation.BorderStroke(1.dp, Color(0xFFF1F5F9)),
        modifier = if (onClick != null) Modifier.clickable { onClick() } else Modifier
    ) {
        Row(
            modifier = Modifier.padding(12.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            val imageUrl = "${serverUrl.trimEnd('/')}/api/productos/${variante.id_producto}/image"
            if (variante.has_foto) {
                AsyncImage(
                    model = imageUrl,
                    contentDescription = variante.sku,
                    modifier = Modifier
                        .size(52.dp)
                        .clip(RoundedCornerShape(10.dp)),
                    contentScale = ContentScale.Crop
                )
            } else {
                Box(
                    modifier = Modifier
                        .size(52.dp)
                        .clip(RoundedCornerShape(10.dp))
                        .background(Color(0xFFF1F5F9)),
                    contentAlignment = Alignment.Center
                ) {
                    Icon(Icons.Default.Image, contentDescription = null, tint = Color.LightGray, modifier = Modifier.size(22.dp))
                }
            }
            Spacer(Modifier.width(12.dp))
            Column(modifier = Modifier.weight(1f)) {
                Text(variante.sku, fontWeight = FontWeight.Black, fontSize = 13.sp, color = Color(0xFF0F172A))
                Text(variante.ean_13 ?: "Sin EAN", fontSize = 9.sp, color = Color.Gray, fontFamily = FontFamily.Monospace)
                Row(horizontalArrangement = Arrangement.spacedBy(4.dp), modifier = Modifier.padding(top = 3.dp)) {
                    if (!variante.talla.isNullOrBlank()) ConsultaChip(variante.talla)
                    if (!variante.tipo.isNullOrBlank()) ConsultaChip(variante.tipo)
                }
            }
            Box(
                modifier = Modifier
                    .background(Color(0xFF0F172A), RoundedCornerShape(8.dp))
                    .padding(horizontal = 10.dp, vertical = 6.dp)
            ) {
                Text("${variante.total_cantidad}", color = Color.White, fontWeight = FontWeight.Black, fontSize = 13.sp)
            }
        }
    }
}

@Composable
fun ConsultaBoxMiniCard(box: ConsultaBoxResult, onClick: () -> Unit) {
    Card(
        shape = RoundedCornerShape(14.dp),
        colors = CardDefaults.cardColors(containerColor = Color.White),
        elevation = CardDefaults.cardElevation(2.dp),
        modifier = Modifier.clickable { onClick() },
        border = androidx.compose.foundation.BorderStroke(1.dp, Color(0xFFF1F5F9))
    ) {
        Row(
            modifier = Modifier.padding(12.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            val estadoColor = when (box.estado) {
                "llena" -> Color(0xFFDC2626)
                "activa" -> Color(0xFFF59E0B)
                else -> Color(0xFF6B7280)
            }
            Box(
                modifier = Modifier
                    .size(36.dp)
                    .clip(RoundedCornerShape(10.dp))
                    .background(estadoColor),
                contentAlignment = Alignment.Center
            ) {
                Icon(Icons.Default.Inbox, contentDescription = null, tint = if (box.estado == "activa") Color(0xFF0F172A) else Color.White, modifier = Modifier.size(18.dp))
            }
            Spacer(Modifier.width(10.dp))
            Column(modifier = Modifier.weight(1f)) {
                Text("Caja ${box.numero_caja}", fontWeight = FontWeight.Black, fontSize = 13.sp, color = Color(0xFF0F172A))
                Text(box.sku ?: "Sin SKU", fontSize = 9.sp, color = Color.Gray, fontFamily = FontFamily.Monospace)
                Row(horizontalArrangement = Arrangement.spacedBy(4.dp), modifier = Modifier.padding(top = 2.dp)) {
                    ConsultaChip(box.estado)
                    ConsultaChip("${box.total_unidades ?: 0} uds")
                }
            }
            Icon(Icons.Default.ChevronRight, contentDescription = null, tint = Color.LightGray, modifier = Modifier.size(18.dp))
        }
    }
}

@Composable
fun ConsultaProductoMiniCard(prod: ConsultaProductoSimple, serverUrl: String, onClick: () -> Unit) {
    Card(
        shape = RoundedCornerShape(14.dp),
        colors = CardDefaults.cardColors(containerColor = Color.White),
        elevation = CardDefaults.cardElevation(2.dp),
        modifier = Modifier.clickable { onClick() },
        border = androidx.compose.foundation.BorderStroke(1.dp, Color(0xFFF1F5F9))
    ) {
        Row(
            modifier = Modifier.padding(10.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            val imageUrl = "${serverUrl.trimEnd('/')}/api/productos/${prod.id_producto}/image"
            if (prod.has_foto) {
                AsyncImage(
                    model = imageUrl,
                    contentDescription = prod.sku,
                    modifier = Modifier
                        .size(44.dp)
                        .clip(RoundedCornerShape(8.dp)),
                    contentScale = ContentScale.Crop
                )
            } else {
                Box(
                    modifier = Modifier
                        .size(44.dp)
                        .clip(RoundedCornerShape(8.dp))
                        .background(Color(0xFFF1F5F9)),
                    contentAlignment = Alignment.Center
                ) {
                    Icon(Icons.Default.Image, contentDescription = null, tint = Color.LightGray, modifier = Modifier.size(18.dp))
                }
            }
            Spacer(Modifier.width(10.dp))
            Column(modifier = Modifier.weight(1f)) {
                Text(prod.sku, fontWeight = FontWeight.Black, fontSize = 13.sp, color = Color(0xFF0F172A), maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(prod.ean_13 ?: "Sin EAN", fontSize = 9.sp, color = Color.Gray, fontFamily = FontFamily.Monospace)
                Row(horizontalArrangement = Arrangement.spacedBy(4.dp), modifier = Modifier.padding(top = 2.dp)) {
                    if (!prod.talla.isNullOrBlank()) ConsultaChip(prod.talla)
                    if (!prod.tipo.isNullOrBlank()) ConsultaChip(prod.tipo)
                    if (!prod.marca_sub.isNullOrBlank()) ConsultaChip(prod.marca_sub)
                }
            }
            Icon(Icons.Default.ChevronRight, contentDescription = null, tint = Color.LightGray, modifier = Modifier.size(18.dp))
        }
    }
}

@Composable
fun ConsultaHistoryItem(entry: HistoryEntry, onClick: () -> Unit) {
    Card(
        shape = RoundedCornerShape(12.dp),
        colors = CardDefaults.cardColors(containerColor = Color.White),
        elevation = CardDefaults.cardElevation(1.dp),
        modifier = Modifier.clickable { onClick() },
        border = androidx.compose.foundation.BorderStroke(1.dp, Color(0xFFF1F5F9))
    ) {
        Row(
            modifier = Modifier.padding(12.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Icon(Icons.Default.History, contentDescription = null, tint = Color.LightGray, modifier = Modifier.size(16.dp))
            Spacer(Modifier.width(8.dp))
            Column(modifier = Modifier.weight(1f)) {
                Text(entry.label, fontWeight = FontWeight.Bold, fontSize = 12.sp, color = Color(0xFF0F172A))
                if (entry.subtitle.isNotBlank()) {
                    Text(entry.subtitle, fontSize = 9.sp, color = Color.Gray)
                }
            }
            Icon(Icons.Default.ChevronRight, contentDescription = null, tint = Color.LightGray, modifier = Modifier.size(14.dp))
        }
    }
}

// ─── Dropdown Helper ──────────────────────────────────────────────────────────

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ConsultaDropdown(
    label: String,
    options: List<String>,
    selected: String,
    onSelect: (String) -> Unit,
    placeholder: String
) {
    var expanded by remember { mutableStateOf(false) }

    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Text(label, fontSize = 9.sp, fontWeight = FontWeight.Black, color = Color.Gray)
        ExposedDropdownMenuBox(expanded = expanded, onExpandedChange = { expanded = it }) {
            OutlinedTextField(
                value = if (selected.isBlank()) placeholder else selected,
                onValueChange = {},
                readOnly = true,
                modifier = Modifier
                    .fillMaxWidth()
                    .menuAnchor(),
                trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = expanded) },
                shape = RoundedCornerShape(10.dp),
                textStyle = androidx.compose.ui.text.TextStyle(
                    fontSize = 12.sp,
                    fontWeight = FontWeight.Bold,
                    color = if (selected.isBlank()) Color.Gray else Color(0xFF0F172A)
                )
            )
            ExposedDropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
                DropdownMenuItem(
                    text = { Text(placeholder, fontSize = 12.sp, color = Color.Gray) },
                    onClick = { onSelect(""); expanded = false }
                )
                options.forEach { option ->
                    DropdownMenuItem(
                        text = { Text(option.uppercase(), fontSize = 12.sp, fontWeight = FontWeight.Bold) },
                        onClick = { onSelect(option); expanded = false }
                    )
                }
            }
        }
    }
}

// ─── URL encoding helper ───────────────────────────────────────────────────────

private fun String.encodeURL(): String = java.net.URLEncoder.encode(this, "UTF-8")
