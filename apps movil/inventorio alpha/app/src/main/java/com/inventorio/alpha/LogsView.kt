package com.inventorio.alpha

import androidx.compose.foundation.background
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun LogsView(ocrEngine: LabelOcrEngine) {
    val logs by AppLogger.logs.collectAsState()
    val clipboardManager = LocalClipboardManager.current

    var filterLevel by remember { mutableStateOf<LogLevel?>(null) }

    val filteredLogs = remember(logs, filterLevel) {
        if (filterLevel == null) logs
        else logs.filter { it.level == filterLevel }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(Color(0xFFF8FAFC))
    ) {

        // ── Card de estado de la IA ────────────────────────────────────────
        Card(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 12.dp, vertical = 8.dp),
            colors = CardDefaults.cardColors(containerColor = Color(0xFF0F172A)),
            shape = RoundedCornerShape(14.dp),
            elevation = CardDefaults.cardElevation(4.dp)
        ) {
            Column(
                modifier = Modifier.padding(14.dp),
                verticalArrangement = Arrangement.spacedBy(6.dp)
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(
                        Icons.Default.Memory,
                        contentDescription = "IA",
                        tint = Color(0xFF7C3AED),
                        modifier = Modifier.size(16.dp)
                    )
                    Spacer(modifier = Modifier.width(6.dp))
                    Text(
                        "Estado del Motor OCR",
                        fontWeight = FontWeight.Black,
                        fontSize = 13.sp,
                        color = Color.White
                    )
                }

                HorizontalDivider(color = Color(0xFF1E293B))

                AiStatusRow(
                    label = "Motor OCR",
                    value = "✅ ML Kit Text Recognition (on-device)",
                    ok = true
                )
                AiStatusRow(
                    label = "Preprocesamiento",
                    value = "✅ ImagePreprocessor (grayscale + CLAHE + Otsu)",
                    ok = true
                )
                AiStatusRow(
                    label = "Parser heurístico",
                    value = "✅ LabelTextParser (40+ marcas, regex)",
                    ok = true
                )
                AiStatusRow(
                    label = "Ground truth",
                    value = "✅ Usuario confirma/corrige (sin IA externa)",
                    ok = true
                )

                val lastError = LlamacppBridge.lastInitError
                if (lastError != null) {
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .background(Color(0xFF7F1D1D), RoundedCornerShape(8.dp))
                            .padding(8.dp)
                    ) {
                        Text(
                            "Último error de inicialización:",
                            fontWeight = FontWeight.Bold,
                            fontSize = 10.sp,
                            color = Color(0xFFFCA5A5)
                        )
                        Text(
                            lastError,
                            fontFamily = FontFamily.Monospace,
                            fontSize = 9.sp,
                            color = Color(0xFFFECACA)
                        )
                    }
                }
            }
        }

        // ── Toolbar de filtros ─────────────────────────────────────────────
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 12.dp),
            horizontalArrangement = Arrangement.spacedBy(6.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text(
                "Filtrar:",
                fontSize = 11.sp,
                fontWeight = FontWeight.Bold,
                color = Color(0xFF374151)
            )

            FilterChip(
                selected = filterLevel == null,
                onClick = { filterLevel = null },
                label = { Text("Todo (${logs.size})", fontSize = 10.sp) }
            )
            FilterChip(
                selected = filterLevel == LogLevel.ERROR,
                onClick = { filterLevel = if (filterLevel == LogLevel.ERROR) null else LogLevel.ERROR },
                label = { Text("🔴 Error", fontSize = 10.sp) }
            )
            FilterChip(
                selected = filterLevel == LogLevel.WARN,
                onClick = { filterLevel = if (filterLevel == LogLevel.WARN) null else LogLevel.WARN },
                label = { Text("🟡 Warn", fontSize = 10.sp) }
            )
            FilterChip(
                selected = filterLevel == LogLevel.INFO,
                onClick = { filterLevel = if (filterLevel == LogLevel.INFO) null else LogLevel.INFO },
                label = { Text("🟢 Info", fontSize = 10.sp) }
            )
        }

        // ── Acciones ──────────────────────────────────────────────────────
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 12.dp, vertical = 4.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            OutlinedButton(
                onClick = {
                    val text = AppLogger.exportText()
                    clipboardManager.setText(AnnotatedString(text))
                },
                modifier = Modifier.weight(1f),
                contentPadding = PaddingValues(horizontal = 8.dp, vertical = 4.dp)
            ) {
                Icon(Icons.Default.ContentCopy, null, Modifier.size(14.dp))
                Spacer(Modifier.width(4.dp))
                Text("Copiar", fontSize = 11.sp)
            }
            OutlinedButton(
                onClick = { AppLogger.clear() },
                modifier = Modifier.weight(1f),
                contentPadding = PaddingValues(horizontal = 8.dp, vertical = 4.dp),
                colors = ButtonDefaults.outlinedButtonColors(contentColor = Color(0xFFDC2626))
            ) {
                Icon(Icons.Default.DeleteSweep, null, Modifier.size(14.dp))
                Spacer(Modifier.width(4.dp))
                Text("Limpiar", fontSize = 11.sp)
            }
        }

        HorizontalDivider(color = Color(0xFFE2E8F0))

        // ── Lista de logs ─────────────────────────────────────────────────
        if (filteredLogs.isEmpty()) {
            Box(
                modifier = Modifier.fillMaxSize(),
                contentAlignment = Alignment.Center
            ) {
                Column(
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    Icon(
                        Icons.Default.BugReport,
                        contentDescription = null,
                        tint = Color.LightGray,
                        modifier = Modifier.size(48.dp)
                    )
                    Text(
                        "Sin logs aún. Escanea una etiqueta\npara ver qué motor de IA se usa.",
                        color = Color.Gray,
                        fontSize = 13.sp,
                        textAlign = androidx.compose.ui.text.style.TextAlign.Center
                    )
                }
            }
        } else {
            LazyColumn(
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(horizontal = 12.dp, vertical = 8.dp),
                verticalArrangement = Arrangement.spacedBy(4.dp)
            ) {
                items(filteredLogs) { entry ->
                    LogEntryCard(entry)
                }
            }
        }
    }
}

@Composable
private fun AiStatusRow(label: String, value: String, ok: Boolean) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.Top
    ) {
        Text(
            label,
            fontSize = 10.sp,
            color = Color(0xFF94A3B8),
            modifier = Modifier.weight(1f)
        )
        Text(
            value,
            fontSize = 10.sp,
            fontWeight = FontWeight.Bold,
            color = if (ok) Color(0xFF4ADE80) else Color(0xFFF87171),
            modifier = Modifier.weight(1.2f)
        )
    }
}

@Composable
private fun LogEntryCard(entry: LogEntry) {
    val (bgColor, levelColor, levelIcon) = when (entry.level) {
        LogLevel.ERROR -> Triple(Color(0xFFFEF2F2), Color(0xFFDC2626), "🔴")
        LogLevel.WARN  -> Triple(Color(0xFFFFFBEB), Color(0xFFD97706), "🟡")
        LogLevel.INFO  -> Triple(Color(0xFFF0FDF4), Color(0xFF16A34A), "🟢")
    }

    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = bgColor),
        shape = RoundedCornerShape(8.dp),
        elevation = CardDefaults.cardElevation(0.dp)
    ) {
        Column(modifier = Modifier.padding(8.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(4.dp)
                ) {
                    Text(levelIcon, fontSize = 10.sp)
                    Text(
                        entry.tag,
                        fontWeight = FontWeight.Black,
                        fontSize = 10.sp,
                        color = levelColor
                    )
                }
                Text(
                    entry.formattedTime,
                    fontSize = 9.sp,
                    color = Color(0xFF9CA3AF),
                    fontFamily = FontFamily.Monospace
                )
            }
            Spacer(Modifier.height(2.dp))
            Text(
                entry.message,
                fontSize = 10.sp,
                color = Color(0xFF1E293B),
                fontFamily = FontFamily.Monospace,
                lineHeight = 14.sp
            )
        }
    }
}
