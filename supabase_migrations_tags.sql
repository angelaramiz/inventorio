-- Migración para soportar Etiquetas (Tags) en Secciones y Cajas
-- Ejecutar en el SQL Editor de Supabase:

-- 1. Agregar columnas de tags
ALTER TABLE zonas_seccion ADD COLUMN IF NOT EXISTS tags JSONB DEFAULT '{"tipo_producto": "todos", "genero": "todos", "marca": "todos"}'::jsonb;
ALTER TABLE cajas ADD COLUMN IF NOT EXISTS tags JSONB DEFAULT '{"tipo_producto": "todos", "genero": "todos", "marca": "todos"}'::jsonb;
ALTER TABLE containers ADD COLUMN IF NOT EXISTS tags JSONB DEFAULT '{"tipo_producto": "todos", "genero": "todos", "marca": "todos"}'::jsonb;

-- 2. Recrear vista_total_cajas para incluir la columna tags
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
    COALESCE(c.id_zona_almacen, zs.id_zona_almacen) as id_zona_almacen,
    COALESCE(za_direct.nombre, za_sec.nombre) as almacen_nombre,
    COUNT(DISTINCT cp.id_producto) as total_productos_unicos,
    COALESCE(SUM(cp.cantidad), 0) as total_unidades
FROM cajas c
LEFT JOIN caja_productos cp ON c.id_caja = cp.id_caja
LEFT JOIN zonas_seccion zs ON c.id_zona_seccion = zs.id_zona_seccion
LEFT JOIN zonas_almacen za_sec ON zs.id_zona_almacen = za_sec.id_zona_almacen
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
    c.id_zona_almacen, 
    zs.id_zona_almacen, 
    za_direct.nombre, 
    za_sec.nombre;
