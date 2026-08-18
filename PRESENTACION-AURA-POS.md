# 👗 AURA Club + POS Venta

## Ecosistema de lealtad y punto de venta para tiendas de ropa

**Marca de ejemplo:** AURA Boutique · **Ref de membresía:** `FIEL-XXXXXX` · **Moneda:** MXN

> Un sistema completo de **club de lealtad con dinero electrónico**, **QR de membresía escaneable**,
> **punto de venta con cobro en efectivo / monedero / tarjeta (aprobación remota)** y **facturación con
> datos fiscales** — todo conectado en tiempo real entre web, apps móviles y la base de datos.

---

## 📌 El problema

- Las tiendas de ropa pierden **recompra** y **datos de clientes**: no saben quién compra ni cómo retenerlo.
- El **cambio en efectivo** se pierde (no vuelve como saldo a favor del cliente).
- Cobrar con **tarjeta en el punto de venta** requiere terminal físico o procesos lentos.
- Emitir **factura** es un trámite aparte y manual.
- Operadores y caja trabajan con **datos desincronizados**.

## ✅ La solución

Un ecosistema de 3 piezas que trabajan juntas:

| Pieza | Qué es | Usuario |
|---|---|---|
| **AURA Club (app móvil)** | Monedero electrónico, QR de membresía, cupones, ticket digital, factura, biometría | El **cliente** |
| **POS Venta (web)** | Escáner de producto y de QR de cliente, cobro en efectivo/monedero/tarjeta | La **caja / vendedor** |
| **Backend + Supabase** | API, búsqueda de productos, validación de clientes, facturas, tiempo real (SSE) | El **sistema** |

---

## 📱 AURA Club — App del cliente

**Una tarjeta de membresía digital en el bolsillo del cliente.**

- **Monedero electrónico** con saldo en tiempo real y badge ACTIVO.
- **QR de membresía real** (escaneable por el POS) en un botón central de la barra inferior.
- **Cambio a monedero**: al pagar en efectivo, el cambio vuelve como saldo a favor automáticamente.
- **Pago con tarjeta remoto**: el POS envía una solicitud → la app la aprueba con su tarjeta vinculada (tipo Stripe).
- **Cupones** de bienvenida y promociones (`$200 en tu primera compra`, `% OFF`, etc.).
- **Ticket digital** por movimiento: productos ×cantidad ×precio, subtotal, descuento, total, método, fecha.
- **Factura con datos fiscales**: RFC, razón social, uso CFDI, CP y correo — la factura se solicita desde el ticket y queda con los datos del cliente.
- **Tarjetas**: vincular, editar y eliminar con número siempre enmascarado (solo últimos 4).
- **Acceso biométrico** (huella/rostro) y **sesión persistente**: no vuelve a pedir login tras actualizaciones.
- **Historial** de compras y facturas con folio.

### Pantallas

| Pantalla | Contenido |
|---|---|
| **Principal** | Saludo + saldo + acciones rápidas (Mi QR, Recargar, Simular, Invitar) + historial + cupones |
| **Tarjetas** | Tarjetas wallet (CRUD, máscara, selección para pagar) |
| **Historial** | Compras y facturas (ticket al tocar, solicitar factura) |
| **Ajustes** | Perfil, **datos fiscales**, biometría, logs, cerrar sesión |
| **QR** | Modal con el código de membresía (abierto desde el botón central) |

---

## 🛒 POS Venta — Punto de venta

**El cajero cobra sin terminal físico y con el inventario real.**

- **Escáner de producto** por código de barras (SKU/EAN reales) → carga el producto → **precio editable**.
- **Escáner del QR del cliente** → lo valida contra la base de clientes → carga su saldo y cupones.
- **Total** en tiempo real con descuentos por cupón.
- **Métodos de cobro:**
  - 💵 **Efectivo** — si el cajero no puede dar cambio, el sobrante se **recarga como dinero electrónico** del cliente.
  - 💳 **Monedero** — descuenta del saldo AURA (con validación de saldo insuficiente).
  - 💳 **Tarjeta** — envía **solicitud de pago a la app del cliente**, él aprueba con su tarjeta y el POS recibe la confirmación → orden de compra + comprobante.
- **Comprobante** con folio, total, método, cambio a monedero y nota de factura disponible en la app.

### Flujo en caja (end-to-end)

```
1. Cliente llega con su app AURA → muestra su QR (botón central)
2. Cajero lo escanea en el POS → valida cliente + saldo + cupones
3. Cajero escanea los productos (precio real, editable)
4. Total
5. Pago: efectivo (cambio → monedero) / monedero / tarjeta (aprobación en la app del cliente)
6. Comprobante generado + ticket en la app del cliente
7. El cliente puede solicitar su factura desde el ticket (con sus datos fiscales)
```

---

## 🔄 Conectado en tiempo real

- **SSE (Server-Sent Events)**: el backend empuja cambios a las apps (solicitudes de pago, compras, facturas) al instante.
- **Bridge Supabase Realtime → SSE**: cualquier cambio en la base (web, SQL, otras apps) se refleja sin cerrar/reabrir apps.
- **OTA**: las apps se actualizan solas con barra de progreso e instalador del sistema.

---

## 🧪 Cómo probarlo (demo)

| Recurso | Dónde |
|---|---|
| **App del cliente (PWA)** | `https://inventorio.onrender.com/cliente` |
| **POS Venta (web)** | `https://inventorio.onrender.com/pos_venta` |
| **App móvil AURA** | `public/inventorio-loyalty.apk` (catálogo: AURA Club 1.0.13) |
| **Cliente demo** | `FIEL-DEMO001` (María García, saldo $500) — o regístrate desde la app |

**Pasos rápidos de la demo:**
1. Abre `/cliente` (modo demo) y genera el **QR** con el botón central.
2. En `/pos_venta`, "Escanear QR del cliente" → apunta el QR → se carga el cliente.
3. Escanea un SKU real (ej. `7623846036991`) → captura el precio → cobra.
4. Prueba **Monedero** (descuenta saldo) o **Efectivo** con cambio (lo agrega al monedero).
5. En la app, revisa el **ticket** y solicita la **factura** con tus datos fiscales.

---

## 🧰 Stack tecnológico

| Capa | Tecnología |
|---|---|
| App móvil cliente | Kotlin + Jetpack Compose · ZXing (QR) · androidx.biometric · OkHttp |
| PWA web | React + TypeScript + Vite · Tailwind · html5-qrcode · qrcode |
| Backend | Node.js + Express + TypeScript · bcrypt · SSE · Supabase Realtime bridge |
| Base de datos | Supabase (PostgreSQL) · RLS · `warehouse_settings` para OTA |
| Deploy | Render.com · APK publicados en `public/` |

---

## 🚀 Siguiente nivel (ruta de producción)

1. **Pagos reales con tarjeta**: pasarela (Mercado Pago / Stripe / Clip) con tokenización — el flujo de "aprobar en la app" ya está cableado, solo cambia la capa de confirmación.
2. **CFDI timbrado** con PAC (Facturapi/SUMA) — la factura ya lleva datos fiscales; falta el XML/PDF timbrado.
3. **Crédito de tienda auditado** (movimientos con saldo inicial/final) en lugar de "monedero" para evitar regulación financiera.
4. **Multi-tienda**, cortes de caja y notificaciones push (FCM).
5. **JWT** para sesiones de vendedor y cierre de RLS en producción.

---

*Inventorio · Sistema de gestión de inventario físico para tiendas de ropa · Fase: crecimiento*
