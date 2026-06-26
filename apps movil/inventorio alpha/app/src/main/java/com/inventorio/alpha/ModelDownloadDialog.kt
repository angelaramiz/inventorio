package com.inventorio.alpha

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

/**
 * Diálogo para descargar el modelo Qwen2.5-VL-2B on-demand.
 * Se muestra automáticamente cuando el usuario toca "Leer Etiqueta"
 * y el modelo no está descargado.
 *
 * @param ocrEngine Motor OCR que gestiona la descarga
 * @param onDismiss Llamado cuando el usuario cancela (modelo no descargado)
 * @param onModelReady Llamado cuando el modelo se descargó exitosamente
 */
@Composable
fun ModelDownloadDialog(
    ocrEngine: LabelOcrEngine,
    onDismiss: () -> Unit,
    onModelReady: () -> Unit
) {
    val scope = rememberCoroutineScope()
    var downloadProgress by remember { mutableStateOf(0) }
    var isDownloading by remember { mutableStateOf(false) }
    var downloadFailed by remember { mutableStateOf(false) }
    var downloadComplete by remember { mutableStateOf(false) }

    val animatedProgress by animateFloatAsState(
        targetValue = downloadProgress / 100f,
        animationSpec = tween(durationMillis = 300),
        label = "progress"
    )

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

                // ── Header ────────────────────────────────────────────────────
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
                        Icon(
                            Icons.Default.CheckCircle,
                            contentDescription = null,
                            tint = Color.White,
                            modifier = Modifier.size(32.dp)
                        )
                    } else {
                        Icon(
                            Icons.Default.AutoAwesome,
                            contentDescription = null,
                            tint = Color.White,
                            modifier = Modifier.size(32.dp)
                        )
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
                        downloadComplete ->
                            "Qwen2.5-VL-2B está listo. Ahora puedes leer etiquetas sin conexión a internet."
                        downloadFailed ->
                            "No se pudo descargar el modelo. Verifica tu conexión WiFi e intenta de nuevo."
                        isDownloading ->
                            "Descargando modelo de visión IA... No cierres la app."
                        else ->
                            "Para leer etiquetas sin internet, necesitas descargar el modelo Qwen2.5-VL (~1.2 GB).\n\nSolo se descarga una vez. Requiere WiFi."
                    },
                    color = Color(0xFF94A3B8),
                    fontSize = 13.sp,
                    textAlign = TextAlign.Center,
                    lineHeight = 19.sp
                )

                Spacer(modifier = Modifier.height(20.dp))

                // ── Progreso ──────────────────────────────────────────────────
                if (isDownloading || downloadComplete) {
                    Column(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalAlignment = Alignment.CenterHorizontally
                    ) {
                        // Barra de progreso
                        LinearProgressIndicator(
                            progress = { animatedProgress },
                            modifier = Modifier
                                .fillMaxWidth()
                                .height(8.dp)
                                .clip(RoundedCornerShape(4.dp)),
                            color = Color(0xFF7C3AED),
                            trackColor = Color(0xFF1E293B)
                        )

                        Spacer(modifier = Modifier.height(8.dp))

                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween
                        ) {
                            Text(
                                text = if (downloadComplete) "Completado" else "$downloadProgress%",
                                color = Color(0xFF7C3AED),
                                fontWeight = FontWeight.Bold,
                                fontSize = 12.sp
                            )
                            Text(
                                text = "~1.2 GB total",
                                color = Color(0xFF475569),
                                fontSize = 12.sp
                            )
                        }
                    }

                    Spacer(modifier = Modifier.height(16.dp))
                }

                // ── Aviso de WiFi (solo antes de descargar) ───────────────────
                if (!isDownloading && !downloadComplete && !downloadFailed) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .background(Color(0xFF1E293B), RoundedCornerShape(10.dp))
                            .padding(10.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Icon(
                            Icons.Default.Wifi,
                            contentDescription = null,
                            tint = Color(0xFF38BDF8),
                            modifier = Modifier.size(18.dp)
                        )
                        Spacer(modifier = Modifier.width(8.dp))
                        Text(
                            "Recomendado: conectar a WiFi antes de descargar",
                            color = Color(0xFF94A3B8),
                            fontSize = 11.sp
                        )
                    }
                    Spacer(modifier = Modifier.height(16.dp))
                }

                // ── Información del modelo ────────────────────────────────────
                if (!isDownloading && !downloadComplete) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .background(Color(0xFF1E293B), RoundedCornerShape(10.dp))
                            .padding(horizontal = 12.dp, vertical = 8.dp),
                        horizontalArrangement = Arrangement.SpaceBetween
                    ) {
                        ModelInfoChip("Modelo", "Qwen2.5-VL-2B")
                        ModelInfoChip("Formato", "Q4 MNN")
                        ModelInfoChip("Tamaño", "~1.2 GB")
                    }
                    Spacer(modifier = Modifier.height(16.dp))
                }

                // ── Botones ───────────────────────────────────────────────────
                when {
                    downloadComplete -> {
                        Button(
                            onClick = onModelReady,
                            modifier = Modifier.fillMaxWidth(),
                            colors = ButtonDefaults.buttonColors(
                                containerColor = Color(0xFF7C3AED)
                            ),
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
                                    downloadFailed = false
                                    isDownloading = true
                                    downloadProgress = 0
                                    scope.launch(Dispatchers.IO) {
                                        ocrEngine.downloadModel(
                                            onProgress = { downloadProgress = it },
                                            onDone = { success ->
                                                isDownloading = false
                                                if (success) downloadComplete = true
                                                else downloadFailed = true
                                            }
                                        )
                                    }
                                },
                                modifier = Modifier.weight(1f),
                                colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF7C3AED)),
                                shape = RoundedCornerShape(12.dp)
                            ) { Text("Reintentar", fontWeight = FontWeight.Bold) }
                        }
                    }
                    isDownloading -> {
                        OutlinedButton(
                            onClick = { /* No permitir cancelar durante descarga activa */ },
                            modifier = Modifier.fillMaxWidth(),
                            enabled = false,
                            shape = RoundedCornerShape(12.dp)
                        ) {
                            CircularProgressIndicator(
                                modifier = Modifier.size(16.dp),
                                strokeWidth = 2.dp,
                                color = Color(0xFF7C3AED)
                            )
                            Spacer(Modifier.width(8.dp))
                            Text("Descargando...", color = Color(0xFF475569))
                        }
                    }
                    else -> {
                        // Estado inicial: ofrecer descarga
                        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            OutlinedButton(
                                onClick = onDismiss,
                                modifier = Modifier.weight(1f),
                                shape = RoundedCornerShape(12.dp)
                            ) { Text("Ahora no", color = Color(0xFF94A3B8)) }

                            Button(
                                onClick = {
                                    isDownloading = true
                                    scope.launch(Dispatchers.IO) {
                                        ocrEngine.downloadModel(
                                            onProgress = { downloadProgress = it },
                                            onDone = { success ->
                                                isDownloading = false
                                                if (success) {
                                                    downloadComplete = true
                                                    ocrEngine.initNativeModel()
                                                } else {
                                                    downloadFailed = true
                                                }
                                            }
                                        )
                                    }
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

@Composable
private fun ModelInfoChip(label: String, value: String) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Text(label, color = Color(0xFF475569), fontSize = 9.sp, fontWeight = FontWeight.Bold)
        Text(value, color = Color(0xFFCBD5E1), fontSize = 11.sp, fontWeight = FontWeight.Bold)
    }
}
