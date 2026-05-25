-- Migración para incorporar el nivel "Zona / Pasillo" (Nivel 2) en la jerarquía y soporte completo de etiquetas
-- Ejecutar en el SQL Editor de Supabase:

-- 1. Crear tabla de Zonas / Pasillos (Nivel 2)
CREATE TABLE IF NOT EXISTS zonas_pasillo (
    id_zona_pasillo SERIAL PRIMARY KEY,
    nombre VARCHAR(100) NOT NULL,
    id_zona_almacen INT REFERENCES zonas_almacen(id_zona_almacen) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
ALTER TABLE zonas_pasillo DISABLE ROW LEVEL SECURITY;

-- 2. Modificar zonas_seccion para asociarse a un Pasillo en lugar de directo a Almacén
ALTER TABLE zonas_seccion ADD COLUMN IF NOT EXISTS id_zona_pasillo INT REFERENCES zonas_pasillo(id_zona_pasillo) ON DELETE CASCADE;

-- 3. Asegurar columnas de tags (por si acaso)
ALTER TABLE zonas_seccion ADD COLUMN IF NOT EXISTS tags JSONB DEFAULT '{"tipo_producto": "todos", "genero": "todos", "marca": "todos"}'::jsonb;
ALTER TABLE cajas ADD COLUMN IF NOT EXISTS tags JSONB DEFAULT '{"tipo_producto": "todos", "genero": "todos", "marca": "todos"}'::jsonb;
ALTER TABLE containers ADD COLUMN IF NOT EXISTS tags JSONB DEFAULT '{"tipo_producto": "todos", "genero": "todos", "marca": "todos"}'::jsonb;

-- 4. Recrear vista_total_cajas para incluir pasillo_nombre y tags
DROP VIEW IF EXISTS vista_total_cajas;
CREATE VIEW vista_total_cajas AS
SELECT 
    c.id_caja,
    c.numero_caja,
    c.sku,
    c.estado,
    c.fecha_creacion,
    c.id_zona_seccion,
    c.temporada_default,
    c.tags, -- Columna de tags de la caja
    zs.nombre as seccion_nombre,
    zs.id_zona_pasillo,
    zp.nombre as pasillo_nombre,
    COALESCE(c.id_zona_almacen, zs.id_zona_almacen, zp.id_zona_almacen) as id_zona_almacen,
    COALESCE(za_direct.nombre, za_sec.nombre, za_pas.nombre) as almacen_nombre,
    COUNT(DISTINCT cp.id_producto) as total_productos_unicos,
    COALESCE(SUM(cp.cantidad), 0) as total_unidades
FROM cajas c
LEFT JOIN caja_productos cp ON c.id_caja = cp.id_caja
LEFT JOIN zonas_seccion zs ON c.id_zona_seccion = zs.id_zona_seccion
LEFT JOIN zonas_pasillo zp ON zs.id_zona_pasillo = zp.id_zona_pasillo
LEFT JOIN zonas_almacen za_sec ON zs.id_zona_almacen = za_sec.id_zona_almacen
LEFT JOIN zonas_almacen za_pas ON zp.id_zona_almacen = za_pas.id_zona_almacen
LEFT JOIN zonas_almacen za_direct ON c.id_zona_almacen = za_direct.id_zona_almacen
GROUP BY 
    c.id_caja, 
    c.numero_caja, 
    c.sku, 
    c.estado, 
    c.fecha_creacion, 
    c.id_zona_seccion, 
    c.temporada_default, 
    c.tags, 
    zs.nombre, 
    zs.id_zona_pasillo,
    zp.nombre,
    c.id_zona_almacen, 
    zs.id_zona_almacen, 
    zp.id_zona_almacen,
    za_direct.nombre, 
    za_sec.nombre,
    za_pas.nombre;
