package com.inventorio.operations

import android.content.ContentValues
import android.content.Context
import android.database.Cursor
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper

class OperationsDbHelper(context: Context) : SQLiteOpenHelper(context, DB_NAME, null, DB_VERSION) {

    companion object {
        private const val DB_NAME = "inventorio_operations.db"
        private const val DB_VERSION = 1
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
    }

    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
        db.execSQL("DROP TABLE IF EXISTS csv_products")
        db.execSQL("DROP TABLE IF EXISTS cloud_locations")
        db.execSQL("DROP TABLE IF EXISTS second_chance")
        db.execSQL("DROP TABLE IF EXISTS pending_upload")
        db.execSQL("DROP TABLE IF EXISTS not_found")
        onCreate(db)
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
