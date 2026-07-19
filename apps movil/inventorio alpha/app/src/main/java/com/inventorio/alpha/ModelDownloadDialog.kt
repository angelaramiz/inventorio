package com.inventorio.alpha

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Download
import androidx.compose.material.icons.filled.Wifi
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
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.core.content.ContextCompat
import kotlinx.coroutines.delay
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

@Composable
fun ModelDownloadDialog(
    ocrEngine: LabelOcrEngine,
    onDismiss: () -> Unit,
    onModelReady: () -> Unit
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()

    val availableModels = LabelOcrEngine.AVAILABLE_MODELS
    var selectedModelId by remember { mutableStateOf(availableModels.first().id) }
    val selectedConfig = availableModels.find { it.id == selectedModelId } ?: availableModels.first()

    var downloadProgress by remember { mutableStateOf(0) }
    var isDownloading by remember { mutableStateOf(false) }
    var downloadFailed by remember { mutableStateOf(false) }
    var downloadErrorMessage by remember { mutableStateOf("") }
    var downloadComplete by remember { mutableStateOf(false) }
    var downloadInfo by remember { mutableStateOf("") }

    val animatedProgress by animateFloatAsState(
        targetValue = downloadProgress / 100f,
        animationSpec = tween(durationMillis = 300),
        label = "progress"
    )

    // Poll ModelDownloadService shared state instead of broadcasts (more reliable)
    LaunchedEffect(isDownloading) {
        while (isDownloading) {
            downloadProgress = ModelDownloadService.currentProgress
            downloadInfo = ModelDownloadService.currentInfo
            if (!ModelDownloadService.isDownloading) {
                if (ModelDownloadService.downloadSuccess) {
                    downloadProgress = 100
                    downloadComplete = true
                    Thread { ocrEngine.initLocalModel() }.start()
                } else {
                    downloadFailed = true
                    downloadErrorMessage = ModelDownloadService.downloadError
                }
                isDownloading = false
                break
            }
            delay(500)
        }
    }

    // Permission launcher for POST_NOTIFICATIONS (Android 13+)
    val notifPermLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { _ -> }

    fun requestNotificationPermAndStart(modelId: String) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS)
                != PackageManager.PERMISSION_GRANTED
        ) {
            notifPermLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
        ModelDownloadService.start(context, modelId)
    }

    Dialog(
        onDismissRequest = { if (!isDownloading) onDismiss() },
        properties = DialogProperties(dismissOnBackPress = !isDownloading, dismissOnClickOutside = false)
    ) {
        Card(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 4.dp),
            shape = RoundedCornerShape(24.dp),
            colors = CardDefaults.cardColors(containerColor = Color(0xFF0F172A))
        ) {
            Column(
                modifier = Modifier.padding(24.dp),
                horizontalAlignment = Alignment.CenterHorizontally
            ) {

                // ── Header ──────────────────────────────────
                Box(
                    modifier = Modifier
                        .size(64.dp)
                        .clip(RoundedCornerShape(16.dp))
                        .background(
                            Brush.linearGradient(
                                colors = listOf(Color(0xFF7C3AED), Color(0xFF4F46E5))
                            )
                        ),
                    contentAlignment = Alignment.Center
                ) {
                    if (downloadComplete) {
                        Icon(Icons.Default.CheckCircle, null, tint = Color.White, modifier = Modifier.size(32.dp))
                    } else {
                        Icon(Icons.Default.AutoAwesome, null, tint = Color.White, modifier = Modifier.size(32.dp))
                    }
                }

                Spacer(modifier = Modifier.height(16.dp))

                Text(
                    text = when {
                        downloadComplete -> "¡Modelo Listo!"
                        downloadFailed -> "Error de Descarga"
                        else -> "Modelo IA para Etiquetas"
                    },
                    color = Color.White,
                    fontWeight = FontWeight.Black,
                    fontSize = 18.sp,
                    textAlign = TextAlign.Center
                )

                Spacer(modifier = Modifier.height(8.dp))

                Text(
                    text = when {
                        downloadComplete -> "${selectedConfig.displayName} está listo."
                        downloadFailed -> downloadErrorMessage.ifEmpty { "Verifica tu WiFi." }
                        isDownloading -> "Descargando en segundo plano...\n${downloadInfo.ifEmpty { "Preparando..." }}"
                        else -> "Elige un modelo y descárgalo una vez (~${formatSize(selectedConfig.totalBytes)}). Puede continuar con la pantalla apagada."
                    },
                    color = Color(0xFF94A3B8),
                    fontSize = 13.sp,
                    textAlign = TextAlign.Center,
                    lineHeight = 19.sp
                )

                Spacer(modifier = Modifier.height(16.dp))

                // ── Model selector ──────────────────────────
                if (!isDownloading && !downloadComplete) {
                    Text("Selecciona el modelo:", color = Color(0xFF64748B), fontSize = 11.sp)
                    Spacer(modifier = Modifier.height(6.dp))
                    availableModels.forEach { model ->
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .clip(RoundedCornerShape(10.dp))
                                .background(
                                    if (model.id == selectedModelId) Color(0xFF1E293B) else Color.Transparent
                                )
                                .then(
                                    if (model.id == selectedModelId)
                                        Modifier.border(1.dp, Color(0xFF7C3AED), RoundedCornerShape(10.dp))
                                    else Modifier
                                )
                                .clickable { selectedModelId = model.id }
                                .padding(12.dp),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Column {
                                Text(model.displayName, color = Color.White, fontSize = 13.sp, fontWeight = FontWeight.Bold)
                                Text("~${formatSize(model.totalBytes)}", color = Color(0xFF64748B), fontSize = 11.sp)
                            }
                            if (model.id == selectedModelId) {
                                Icon(Icons.Default.CheckCircle, null, tint = Color(0xFF7C3AED), modifier = Modifier.size(18.dp))
                            }
                        }
                    }
                    Spacer(modifier = Modifier.height(12.dp))
                }

                // ── Progreso ────────────────────────────────
                if (isDownloading || downloadComplete) {
                    Column(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalAlignment = Alignment.CenterHorizontally
                    ) {
                        LinearProgressIndicator(
                            progress = { animatedProgress },
                            modifier = Modifier.fillMaxWidth().height(8.dp).clip(RoundedCornerShape(4.dp)),
                            color = Color(0xFF7C3AED),
                            trackColor = Color(0xFF1E293B)
                        )
                        Spacer(modifier = Modifier.height(8.dp))
                        Text(
                            text = if (downloadComplete) "Completado" else "$downloadProgress%",
                            color = Color(0xFF7C3AED),
                            fontWeight = FontWeight.Bold,
                            fontSize = 12.sp
                        )
                    }
                    Spacer(modifier = Modifier.height(16.dp))
                }

                // ── WiFi warning ────────────────────────────
                if (!isDownloading && !downloadComplete && !downloadFailed) {
                    Row(
                        modifier = Modifier.fillMaxWidth()
                            .background(Color(0xFF1E293B), RoundedCornerShape(10.dp))
                            .padding(10.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Icon(Icons.Default.Wifi, null, tint = Color(0xFF38BDF8), modifier = Modifier.size(18.dp))
                        Spacer(modifier = Modifier.width(8.dp))
                        Text("Recomendado: WiFi. La descarga continúa con pantalla apagada.",
                            color = Color(0xFF94A3B8), fontSize = 11.sp)
                    }
                    Spacer(modifier = Modifier.height(16.dp))
                }

                // ── Botones ─────────────────────────────────
                when {
                    downloadComplete -> {
                        Button(
                            onClick = {
                                LabelOcrEngine.setCurrentConfig(selectedConfig)
                                onModelReady()
                            },
                            modifier = Modifier.fillMaxWidth(),
                            colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF7C3AED)),
                            shape = RoundedCornerShape(12.dp)
                        ) {
                            Icon(Icons.Default.AutoAwesome, null, Modifier.size(18.dp))
                            Spacer(Modifier.width(8.dp))
                            Text("Usar OCR Local", fontWeight = FontWeight.Bold)
                        }
                    }
                    downloadFailed -> {
                        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            OutlinedButton(
                                onClick = onDismiss,
                                modifier = Modifier.weight(1f),
                                shape = RoundedCornerShape(12.dp)
                            ) { Text("Cancelar", color = Color(0xFF94A3B8)) }
                                Button(
                                    onClick = {
                                        downloadFailed = false; downloadErrorMessage = ""
                                        isDownloading = true; downloadProgress = 0
                                        LabelOcrEngine.setCurrentConfig(selectedConfig)
                                        requestNotificationPermAndStart(selectedModelId)
                                    },
                                modifier = Modifier.weight(1f),
                                colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF7C3AED)),
                                shape = RoundedCornerShape(12.dp)
                            ) { Text("Reintentar", fontWeight = FontWeight.Bold) }
                        }
                    }
                    isDownloading -> {
                        // Background download info
                        Column(modifier = Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally) {
                            Text("La descarga continúa en segundo plano",
                                color = Color(0xFF64748B), fontSize = 11.sp)
                            Spacer(Modifier.height(4.dp))
                            OutlinedButton(
                                onClick = onDismiss,
                                modifier = Modifier.fillMaxWidth(),
                                shape = RoundedCornerShape(12.dp)
                            ) { Text("Cerrar diálogo", color = Color(0xFF94A3B8)) }
                        }
                    }
                    else -> {
                        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            OutlinedButton(
                                onClick = onDismiss,
                                modifier = Modifier.weight(1f),
                                shape = RoundedCornerShape(12.dp)
                            ) { Text("Ahora no", color = Color(0xFF94A3B8)) }
                            Button(
                                onClick = {
                                    isDownloading = true
                                    downloadErrorMessage = ""
                                    downloadProgress = 0
                                    LabelOcrEngine.setCurrentConfig(selectedConfig)
                                    requestNotificationPermAndStart(selectedModelId)
                                },
                                modifier = Modifier.weight(1f),
                                colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF7C3AED)),
                                shape = RoundedCornerShape(12.dp)
                            ) {
                                Icon(Icons.Default.Download, null, Modifier.size(18.dp))
                                Spacer(Modifier.width(4.dp))
                                Text("Descargar", fontWeight = FontWeight.Bold)
                            }
                        }
                    }
                }
            }
        }
    }
}

private fun formatSize(bytes: Long): String = when {
    bytes >= 1_000_000_000L -> "%.1f GB".format(bytes / 1_000_000_000.0)
    bytes >= 1_000_000L -> "%.0f MB".format(bytes / 1_000_000.0)
    else -> "${bytes / 1_000} KB"
}
