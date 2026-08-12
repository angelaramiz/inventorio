-- ============================================================
-- FIELCLUB / AURA CLUB — Configuración OTA y datos de prueba
-- ============================================================

-- 1. Configuración OTA para la app Loyalty
INSERT INTO warehouse_settings (clave, valor)
VALUES (
  'android_version_loyalty',
  '{"versionCode": 1, "versionName": "1.0.0", "apkUrl": "/public/inventorio-loyalty.apk"}'
)
ON CONFLICT (clave) DO UPDATE
SET valor = EXCLUDED.valor;

-- 2. Verificar las 4 versiones de apps
SELECT clave, valor FROM warehouse_settings
WHERE clave IN ('android_version', 'android_version_conteo', 'android_version_operations', 'android_version_loyalty');
