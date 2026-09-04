package com.inventorio.operations

import android.content.ContentValues
import android.content.Context
import android.database.Cursor
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper

class OperationsDbHelper(context: Context) : SQLiteOpenHelper(context, DB_NAME, null, DB_VERSION) {

    companion object {
        private const val DB_NAME = "inventorio_operations.db"
        private const val DB_VERSION = 2
    }

    override fun onCreate(db: SQLiteDatabase) {
        // CSV imported products
        db.execSQL("""
            CREATE TABLE csv_products (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                modelo_grupo TEXT NOT NULL,
                codigo_color TEXT,
                talla TEXT,
                sku TEXT,
                linea TEXT,
                categoria TEXT,
                cantidad_solicitada INTEGER NOT NULL DEFAULT 0,
                cantidad_encontrada INTEGER NOT NULL DEFAULT 0,
                estado TEXT NOT NULL DEFAULT 'rojo',
                session_id TEXT NOT NULL
            )
        """)

        // Cloud search results (locations found in Supabase)
        db.execSQL("""
            CREATE TABLE cloud_locations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                csv_product_id INTEGER NOT NULL,
                sku TEXT,
                ubicacion TEXT,
                cantidad_en_ubicacion INTEGER,
                nivel_nombre TEXT,
                caja_nombre TEXT,
                almacen_nombre TEXT,
                session_id TEXT NOT NULL
            )
        """)

        // Second chance products
        db.execSQL("""
            CREATE TABLE second_chance (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                csv_product_id INTEGER NOT NULL UNIQUE,
                modelo_grupo TEXT,
                sku TEXT,
                talla TEXT,
                cantidad_faltante INTEGER NOT NULL DEFAULT 0,
                motivo TEXT NOT NULL DEFAULT 'sin_registro',
                session_id TEXT NOT NULL
            )
        """)

        // Products pending upload to Supabase
        db.execSQL("""
            CREATE TABLE pending_upload (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                csv_product_id INTEGER NOT NULL,
                modelo_grupo TEXT NOT NULL,
                codigo_color TEXT,
                talla TEXT,
                sku TEXT,
                linea TEXT,
                categoria TEXT,
                cantidad INTEGER,
                scanned_barcode TEXT,
                session_id TEXT NOT NULL
            )
        """)

        // Not found products
        db.execSQL("""
            CREATE TABLE not_found (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                csv_product_id INTEGER NOT NULL UNIQUE,
                modelo_grupo TEXT,
                sku TEXT,
                talla TEXT,
                cantidad_faltante INTEGER,
                session_id TEXT NOT NULL
            )
        """)

        createManifiestoTables(db)
    }

    // Tablas de Manifiesto (mini-DB offline, aisladas del flujo CSV).
    // Se crean en onCreate y en la migración v1→v2 sin tocar las 5 tablas del CSV.
    private fun createManifiestoTables(db: SQLiteDatabase) {
        // Manifiestos (cabeceras)
        db.execSQL("""
            CREATE TABLE IF NOT EXISTS manifiestos (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                nombre TEXT NOT NULL,
                categoria TEXT,
                fecha TEXT,
                estado TEXT NOT NULL DEFAULT 'abierto'
            )
        """)

        // Ítems del manifiesto (origen 'ocr' o 'manual', verificado por el usuario)
        db.execSQL("""
            CREATE TABLE IF NOT EXISTS manifiesto_items (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                manifiesto_id INTEGER NOT NULL,
                barcode TEXT,
                modelo TEXT,
                nombre TEXT,
                categoria TEXT,
                cantidad INTEGER NOT NULL DEFAULT 1,
                foto_path TEXT,
                mlkit_raw TEXT,
                origen TEXT,
                verificado INTEGER NOT NULL DEFAULT 1,
                updated_at TEXT
            )
        """)

        db.execSQL("CREATE INDEX IF NOT EXISTS idx_items_manifiesto ON manifiesto_items(manifiesto_id)")
    }

    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
        // Migración no destructiva: v1 → v2 solo agrega tablas de manifiesto.
        // Las 5 tablas del flujo CSV (csv_products, cloud_locations, second_chance,
        // pending_upload, not_found) NO se tocan ni se borran.
        if (oldVersion < 2) {
            createManifiestoTables(db)
        }
    }

    fun getLastSessionId(): String? {
        val c = readableDatabase.rawQuery("SELECT session_id FROM csv_products ORDER BY id DESC LIMIT 1", null)
        val id = if (c.moveToFirst()) c.getString(0) else null
        c.close()
        return id
    }

    fun hasSearchResults(sessionId: String): Boolean {
        val c = readableDatabase.rawQuery("SELECT 1 FROM second_chance WHERE session_id = ? LIMIT 1", arrayOf(sessionId))
        val found = c.moveToFirst()
        c.close()
        return found
    }

    fun clearSession(sessionId: String) {
        writableDatabase.apply {
            delete("csv_products", "session_id = ?", arrayOf(sessionId))
            delete("cloud_locations", "session_id = ?", arrayOf(sessionId))
            delete("second_chance", "session_id = ?", arrayOf(sessionId))
            delete("pending_upload", "session_id = ?", arrayOf(sessionId))
            delete("not_found", "session_id = ?", arrayOf(sessionId))
        }
    }

    // CSV Products
    fun insertCsvProduct(sessionId: String, row: TransformedRow): Long {
        val cv = ContentValues().apply {
            put("modelo_grupo", row.modeloGrupo)
            put("codigo_color", row.codigoColor)
            put("talla", row.talla)
            put("sku", row.sku)
            put("linea", row.linea)
            put("categoria", row.categoria)
            put("cantidad_solicitada", row.cantidad)
            put("cantidad_encontrada", 0)
            put("estado", "rojo")
            put("session_id", sessionId)
        }
        return writableDatabase.insert("csv_products", null, cv)
    }

    fun getCsvProducts(sessionId: String): List<CsvProductRow> {
        val list = mutableListOf<CsvProductRow>()
        val c = readableDatabase.rawQuery("SELECT * FROM csv_products WHERE session_id = ?", arrayOf(sessionId))
        while (c.moveToNext()) list.add(cursorToCsvProduct(c))
        c.close()
        return list
    }

    fun updateProductStatus(id: Long, cantidadEncontrada: Int, estado: String) {
        val cv = ContentValues().apply { put("cantidad_encontrada", cantidadEncontrada); put("estado", estado) }
        writableDatabase.update("csv_products", cv, "id = ?", arrayOf(id.toString()))
    }

    fun getProductById(id: Long): CsvProductRow? {
        val c = readableDatabase.rawQuery("SELECT * FROM csv_products WHERE id = ?", arrayOf(id.toString()))
        val row = if (c.moveToFirst()) cursorToCsvProduct(c) else null
        c.close()
        return row
    }

    // Cloud locations
    fun insertCloudLocation(sessionId: String, csvProductId: Long, loc: FoundLocation) {
        val cv = ContentValues().apply {
            put("csv_product_id", csvProductId)
            put("sku", loc.sku)
            put("ubicacion", loc.ubicacion)
            put("cantidad_en_ubicacion", loc.cantidadEnUbicacion)
            put("nivel_nombre", loc.nivelNombre)
            put("caja_nombre", loc.cajaNombre)
            put("almacen_nombre", loc.almacenNombre)
            put("session_id", sessionId)
        }
        writableDatabase.insert("cloud_locations", null, cv)
    }

    fun getCloudLocations(sessionId: String): List<CloudLocationRow> {
        val list = mutableListOf<CloudLocationRow>()
        val c = readableDatabase.rawQuery("""
            SELECT cl.*, cp.modelo_grupo, cp.talla, cp.categoria, cp.estado
            FROM cloud_locations cl
            LEFT JOIN csv_products cp ON cl.csv_product_id = cp.id
            WHERE cl.session_id = ?
            ORDER BY cp.modelo_grupo, cl.sku
        """, arrayOf(sessionId))
        while (c.moveToNext()) {
            list.add(CloudLocationRow(
                id = c.getLong(c.getColumnIndexOrThrow("id")),
                csvProductId = c.getLong(c.getColumnIndexOrThrow("csv_product_id")),
                modeloGrupo = c.getString(c.getColumnIndexOrThrow("modelo_grupo")) ?: "",
                sku = c.getString(c.getColumnIndexOrThrow("sku")) ?: "",
                talla = c.getString(c.getColumnIndexOrThrow("talla")) ?: "",
                ubicacion = c.getString(c.getColumnIndexOrThrow("ubicacion")) ?: "",
                cantidadEnUbicacion = c.getInt(c.getColumnIndexOrThrow("cantidad_en_ubicacion")),
                nivelNombre = c.getString(c.getColumnIndexOrThrow("nivel_nombre")),
                cajaNombre = c.getString(c.getColumnIndexOrThrow("caja_nombre")),
                almacenNombre = c.getString(c.getColumnIndexOrThrow("almacen_nombre")),
                estado = c.getString(c.getColumnIndexOrThrow("estado")) ?: "rojo"
            ))
        }
        c.close()
        return list
    }

    // Second chance
    fun insertSecondChance(sessionId: String, csvProductId: Long, cantidadFaltante: Int, motivo: String) {
        val cv = ContentValues().apply {
            put("csv_product_id", csvProductId)
            put("cantidad_faltante", cantidadFaltante)
            put("motivo", motivo)
            put("session_id", sessionId)
        }
        writableDatabase.insertWithOnConflict("second_chance", null, cv, SQLiteDatabase.CONFLICT_REPLACE)
    }

    fun getSecondChance(sessionId: String): List<SecondChanceRow> {
        val list = mutableListOf<SecondChanceRow>()
        val c = readableDatabase.rawQuery("""
            SELECT sc.*, cp.modelo_grupo, cp.sku, cp.talla, cp.cantidad_solicitada, cp.cantidad_encontrada, cp.estado
            FROM second_chance sc LEFT JOIN csv_products cp ON sc.csv_product_id = cp.id
            WHERE sc.session_id = ?
        """, arrayOf(sessionId))
        while (c.moveToNext()) {
            list.add(SecondChanceRow(
                id = c.getLong(c.getColumnIndexOrThrow("id")),
                csvProductId = c.getLong(c.getColumnIndexOrThrow("csv_product_id")),
                modeloGrupo = c.getString(c.getColumnIndexOrThrow("modelo_grupo")) ?: "",
                sku = c.getString(c.getColumnIndexOrThrow("sku")) ?: "",
                talla = c.getString(c.getColumnIndexOrThrow("talla")) ?: "",
                cantidadFaltante = c.getInt(c.getColumnIndexOrThrow("cantidad_faltante")),
                cantidadSolicitada = c.getInt(c.getColumnIndexOrThrow("cantidad_solicitada")),
                cantidadEncontrada = c.getInt(c.getColumnIndexOrThrow("cantidad_encontrada")),
                estado = c.getString(c.getColumnIndexOrThrow("estado")) ?: "rojo",
                motivo = c.getString(c.getColumnIndexOrThrow("motivo")) ?: "sin_registro"
            ))
        }
        c.close()
        return list
    }

    fun removeSecondChance(csvProductId: Long) {
        writableDatabase.delete("second_chance", "csv_product_id = ?", arrayOf(csvProductId.toString()))
    }

    // Pending upload
    fun insertPendingUpload(sessionId: String, csvProductId: Long, row: TransformedRow, scannedBarcode: String) {
        val cv = ContentValues().apply {
            put("csv_product_id", csvProductId)
            put("modelo_grupo", row.modeloGrupo)
            put("codigo_color", row.codigoColor)
            put("talla", row.talla)
            put("sku", row.sku)
            put("linea", row.linea)
            put("categoria", row.categoria)
            put("cantidad", row.cantidad)
            put("scanned_barcode", scannedBarcode)
            put("session_id", sessionId)
        }
        writableDatabase.insert("pending_upload", null, cv)
    }

    fun getPendingUploads(sessionId: String): List<PendingUploadRow> {
        val list = mutableListOf<PendingUploadRow>()
        val c = readableDatabase.rawQuery("SELECT * FROM pending_upload WHERE session_id = ?", arrayOf(sessionId))
        while (c.moveToNext()) {
            list.add(PendingUploadRow(
                id = c.getLong(c.getColumnIndexOrThrow("id")),
                csvProductId = c.getLong(c.getColumnIndexOrThrow("csv_product_id")),
                modeloGrupo = c.getString(c.getColumnIndexOrThrow("modelo_grupo")) ?: "",
                codigoColor = c.getString(c.getColumnIndexOrThrow("codigo_color")) ?: "",
                talla = c.getString(c.getColumnIndexOrThrow("talla")) ?: "",
                sku = c.getString(c.getColumnIndexOrThrow("sku")) ?: "",
                linea = c.getString(c.getColumnIndexOrThrow("linea")) ?: "",
                categoria = c.getString(c.getColumnIndexOrThrow("categoria")) ?: "",
                cantidad = c.getInt(c.getColumnIndexOrThrow("cantidad")),
                scannedBarcode = c.getString(c.getColumnIndexOrThrow("scanned_barcode")) ?: ""
            ))
        }
        c.close()
        return list
    }

    fun clearPendingUploads(sessionId: String) {
        writableDatabase.delete("pending_upload", "session_id = ?", arrayOf(sessionId))
    }

    fun removePendingUpload(csvProductId: Long) {
        writableDatabase.delete("pending_upload", "csv_product_id = ?", arrayOf(csvProductId.toString()))
    }

    fun hasPendingUpload(csvProductId: Long): Boolean {
        val c = readableDatabase.rawQuery("SELECT 1 FROM pending_upload WHERE csv_product_id = ? LIMIT 1", arrayOf(csvProductId.toString()))
        val found = c.moveToFirst()
        c.close()
        return found
    }

    // Not found
    fun insertNotFound(sessionId: String, csvProductId: Long, cantidadFaltante: Int) {
        val cv = ContentValues().apply {
            put("csv_product_id", csvProductId)
            put("cantidad_faltante", cantidadFaltante)
            put("session_id", sessionId)
        }
        writableDatabase.insertWithOnConflict("not_found", null, cv, SQLiteDatabase.CONFLICT_REPLACE)
    }

    fun hasNotFoundBarcode(sessionId: String, barcode: String): Boolean {
        val c = readableDatabase.rawQuery("SELECT 1 FROM not_found WHERE session_id = ? AND sku = ? LIMIT 1", arrayOf(sessionId, barcode))
        val found = c.moveToFirst()
        c.close()
        return found
    }

    // UPC desconocido: no está en CSV ni en nube → csv_product_id = -1, barcode en sku
    fun insertNotFoundBarcode(sessionId: String, barcode: String) {
        val cv = ContentValues().apply {
            put("csv_product_id", -1)
            put("sku", barcode)
            put("cantidad_faltante", 0)
            put("session_id", sessionId)
        }
        writableDatabase.insert("not_found", null, cv)
    }

    fun getNotFound(sessionId: String): List<NotFoundRow> {
        val list = mutableListOf<NotFoundRow>()
        // COALESCE: los descartados traen datos del CSV (join); los UPC desconocidos
        // (csv_product_id = -1) traen el barcode guardado en nf.sku
        val c = readableDatabase.rawQuery("""
            SELECT nf.csv_product_id, nf.cantidad_faltante,
                COALESCE(nf.modelo_grupo, cp.modelo_grupo, '') AS modelo_grupo,
                COALESCE(nf.sku, cp.sku, '') AS sku,
                COALESCE(nf.talla, cp.talla, '') AS talla
            FROM not_found nf LEFT JOIN csv_products cp ON nf.csv_product_id = cp.id
            WHERE nf.session_id = ?
        """, arrayOf(sessionId))
        while (c.moveToNext()) {
            list.add(NotFoundRow(
                csvProductId = c.getLong(c.getColumnIndexOrThrow("csv_product_id")),
                modeloGrupo = c.getString(c.getColumnIndexOrThrow("modelo_grupo")) ?: "",
                sku = c.getString(c.getColumnIndexOrThrow("sku")) ?: "",
                talla = c.getString(c.getColumnIndexOrThrow("talla")) ?: "",
                cantidadFaltante = c.getInt(c.getColumnIndexOrThrow("cantidad_faltante"))
            ))
        }
        c.close()
        return list
    }

    private fun cursorToCsvProduct(c: Cursor): CsvProductRow = CsvProductRow(
        id = c.getLong(c.getColumnIndexOrThrow("id")),
        modeloGrupo = c.getString(c.getColumnIndexOrThrow("modelo_grupo")),
        codigoColor = c.getString(c.getColumnIndexOrThrow("codigo_color")) ?: "",
        talla = c.getString(c.getColumnIndexOrThrow("talla")) ?: "",
        sku = c.getString(c.getColumnIndexOrThrow("sku")) ?: "",
        linea = c.getString(c.getColumnIndexOrThrow("linea")) ?: "",
        categoria = c.getString(c.getColumnIndexOrThrow("categoria")) ?: "",
        cantidadSolicitada = c.getInt(c.getColumnIndexOrThrow("cantidad_solicitada")),
        cantidadEncontrada = c.getInt(c.getColumnIndexOrThrow("cantidad_encontrada")),
        estado = c.getString(c.getColumnIndexOrThrow("estado")) ?: "rojo"
    )

    // ── Manifiestos (mini-DB offline, aislada del flujo CSV) ──

    private fun nowIso(): String =
        java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", java.util.Locale.getDefault()).format(java.util.Date())

    fun createManifiesto(nombre: String, categoria: String): Long {
        val cv = ContentValues().apply {
            put("nombre", nombre.trim())
            put("categoria", categoria.trim())
            put("fecha", nowIso().substring(0, 10))
            put("estado", "abierto")
        }
        return writableDatabase.insert("manifiestos", null, cv)
    }

    fun getManifiestos(): List<ManifiestoRow> {
        val list = mutableListOf<ManifiestoRow>()
        val c = readableDatabase.rawQuery("SELECT * FROM manifiestos ORDER BY id DESC", null)
        while (c.moveToNext()) {
            list.add(ManifiestoRow(
                id = c.getLong(c.getColumnIndexOrThrow("id")),
                nombre = c.getString(c.getColumnIndexOrThrow("nombre")) ?: "",
                categoria = c.getString(c.getColumnIndexOrThrow("categoria")) ?: "",
                fecha = c.getString(c.getColumnIndexOrThrow("fecha")) ?: "",
                estado = c.getString(c.getColumnIndexOrThrow("estado")) ?: "abierto"
            ))
        }
        c.close()
        return list
    }

    fun setManifiestoEstado(id: Long, estado: String) {
        val cv = ContentValues().apply { put("estado", estado) }
        writableDatabase.update("manifiestos", cv, "id = ?", arrayOf(id.toString()))
    }

    fun deleteManifiesto(id: Long) {
        writableDatabase.delete("manifiesto_items", "manifiesto_id = ?", arrayOf(id.toString()))
        writableDatabase.delete("manifiestos", "id = ?", arrayOf(id.toString()))
    }

    fun insertManifiestoItem(
        manifiestoId: Long, barcode: String, modelo: String, nombre: String,
        categoria: String, cantidad: Int, fotoPath: String, mlkitRaw: String, origen: String,
        verificado: Int = 1
    ): Long {
        val cv = ContentValues().apply {
            put("manifiesto_id", manifiestoId)
            put("barcode", barcode.trim())
            put("modelo", modelo.trim().uppercase())
            put("nombre", nombre.trim())
            put("categoria", categoria.trim())
            put("cantidad", if (cantidad < 1) 1 else cantidad)
            put("foto_path", fotoPath)
            put("mlkit_raw", mlkitRaw)
            put("origen", origen)
            // verificado=0 si no hay barcode (sin llave única, requiere revisión posterior)
            put("verificado", verificado)
            put("updated_at", nowIso())
        }
        return writableDatabase.insert("manifiesto_items", null, cv)
    }

    fun getManifiestoItems(manifiestoId: Long): List<ManifiestoItemRow> {
        val list = mutableListOf<ManifiestoItemRow>()
        val c = readableDatabase.rawQuery(
            "SELECT * FROM manifiesto_items WHERE manifiesto_id = ? ORDER BY id DESC",
            arrayOf(manifiestoId.toString())
        )
        while (c.moveToNext()) {
            list.add(ManifiestoItemRow(
                id = c.getLong(c.getColumnIndexOrThrow("id")),
                manifiestoId = c.getLong(c.getColumnIndexOrThrow("manifiesto_id")),
                barcode = c.getString(c.getColumnIndexOrThrow("barcode")) ?: "",
                modelo = c.getString(c.getColumnIndexOrThrow("modelo")) ?: "",
                nombre = c.getString(c.getColumnIndexOrThrow("nombre")) ?: "",
                categoria = c.getString(c.getColumnIndexOrThrow("categoria")) ?: "",
                cantidad = c.getInt(c.getColumnIndexOrThrow("cantidad")),
                fotoPath = c.getString(c.getColumnIndexOrThrow("foto_path")) ?: "",
                mlkitRaw = c.getString(c.getColumnIndexOrThrow("mlkit_raw")) ?: "",
                origen = c.getString(c.getColumnIndexOrThrow("origen")) ?: "",
                verificado = c.getInt(c.getColumnIndexOrThrow("verificado")),
                updatedAt = c.getString(c.getColumnIndexOrThrow("updated_at")) ?: ""
            ))
        }
        c.close()
        return list
    }

    fun updateManifiestoItem(id: Long, nombre: String, categoria: String, cantidad: Int, modelo: String) {
        val cv = ContentValues().apply {
            put("nombre", nombre.trim())
            put("categoria", categoria.trim())
            put("cantidad", if (cantidad < 1) 1 else cantidad)
            put("modelo", modelo.trim().uppercase())
            put("updated_at", nowIso())
        }
        writableDatabase.update("manifiesto_items", cv, "id = ?", arrayOf(id.toString()))
    }

    fun deleteManifiestoItem(id: Long) {
        writableDatabase.delete("manifiesto_items", "id = ?", arrayOf(id.toString()))
    }

    fun countManifiestoItems(manifiestoId: Long): Int {
        val c = readableDatabase.rawQuery(
            "SELECT COUNT(*) FROM manifiesto_items WHERE manifiesto_id = ?",
            arrayOf(manifiestoId.toString())
        )
        val n = if (c.moveToFirst()) c.getInt(0) else 0
        c.close()
        return n
    }
}

// Row data classes
data class CsvProductRow(
    val id: Long, val modeloGrupo: String, val codigoColor: String, val talla: String,
    val sku: String, val linea: String, val categoria: String,
    val cantidadSolicitada: Int, var cantidadEncontrada: Int, val estado: String
)

data class SecondChanceRow(
    val id: Long, val csvProductId: Long, val modeloGrupo: String, val sku: String, val talla: String,
    val cantidadFaltante: Int, val cantidadSolicitada: Int, val cantidadEncontrada: Int,
    val estado: String, val motivo: String
)

data class PendingUploadRow(
    val id: Long, val csvProductId: Long, val modeloGrupo: String, val codigoColor: String,
    val talla: String, val sku: String, val linea: String, val categoria: String,
    val cantidad: Int, val scannedBarcode: String
)

data class NotFoundRow(
    val csvProductId: Long, val modeloGrupo: String, val sku: String, val talla: String, val cantidadFaltante: Int
)

data class CloudLocationRow(
    val id: Long, val csvProductId: Long, val modeloGrupo: String, val sku: String, val talla: String,
    val ubicacion: String, val cantidadEnUbicacion: Int,
    val nivelNombre: String?, val cajaNombre: String?, val almacenNombre: String?,
    val estado: String
)

// CSV data model
data class TransformedRow(
    val modeloGrupo: String, val codigoColor: String, val talla: String,
    val sku: String, val linea: String, val categoria: String,
    val cantidad: Int, val raw: Map<String, String>
)

// Cloud search result
data class FoundLocation(
    val idProducto: Int, val sku: String, val ubicacion: String,
    val cantidadEnUbicacion: Int, val nivelNombre: String?,
    val cajaNombre: String?, val almacenNombre: String?
)

// Manifiesto rows (mini-DB offline, aislada del flujo CSV)
data class ManifiestoRow(
    val id: Long, val nombre: String, val categoria: String,
    val fecha: String, val estado: String
)

data class ManifiestoItemRow(
    val id: Long, val manifiestoId: Long, val barcode: String,
    val modelo: String, val nombre: String, val categoria: String,
    val cantidad: Int, val fotoPath: String, val mlkitRaw: String,
    val origen: String, val verificado: Int, val updatedAt: String
)
