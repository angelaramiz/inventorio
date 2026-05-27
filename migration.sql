-- Script de migración de base de datos
-- Ejecuta este código en el Editor SQL de tu panel de Supabase

-- 1. Agregar columna modelo_grupo en la tabla productos
ALTER TABLE productos ADD COLUMN IF NOT EXISTS modelo_grupo VARCHAR(100) DEFAULT 'sin modelo';

-- 2. Actualizar registros existentes para tener 'sin modelo' en lugar de NULL
UPDATE productos SET modelo_grupo = 'sin modelo' WHERE modelo_grupo IS NULL;
