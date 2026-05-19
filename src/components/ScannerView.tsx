import { useState, useEffect, useRef } from "react";
import { Html5Qrcode, Html5QrcodeSupportedFormats } from "html5-qrcode";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { AlertCircle, CheckCircle2, Box, Package, Camera, Power, RefreshCw, Scan } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import ProductQuickRegister from "./ProductQuickRegister";
import { Caja, Producto } from "../types";

export default function ScannerView() {
  const [isScannerActive, setIsScannerActive] = useState(false);
  const [scannedResult, setScannedResult] = useState<string | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [verificationResult, setVerificationResult] = useState<any>(null);
  const [activeCaja, setActiveCaja] = useState<Caja | null>(null);
  const [showQuickRegister, setShowQuickRegister] = useState(false);
  const [showConflictDialog, setShowConflictDialog] = useState(false);
  const scannerRef = useRef<Html5Qrcode | null>(null);

  useEffect(() => {
    // Cargar la caja seleccionada del localStorage si existe
    const savedCaja = localStorage.getItem("activeCaja");
    if (savedCaja) {
      setActiveCaja(JSON.parse(savedCaja));
    }

    return () => {
      if (scannerRef.current) {
        const cleanupScanner = async () => {
          try {
            if (scannerRef.current?.isScanning) {
              await scannerRef.current.stop();
            }
            scannerRef.current?.clear();
          } catch (e) {
            console.error("Error en cleanup del scanner:", e);
          }
        };
        cleanupScanner();
      }
    };
  }, []);

  const startScanner = async () => {
    try {
      let html5QrCode = scannerRef.current;
      if (!html5QrCode) {
        html5QrCode = new Html5Qrcode("reader");
        scannerRef.current = html5QrCode;
      }

      if (html5QrCode.isScanning) {
        await html5QrCode.stop();
      }

      setIsScannerActive(true);

      await html5QrCode.start(
        { facingMode: "environment" },
        {
          fps: 10,
          qrbox: { width: 250, height: 150 },
          formatsToSupport: [
            Html5QrcodeSupportedFormats.EAN_13,
            Html5QrcodeSupportedFormats.UPC_A,
            Html5QrcodeSupportedFormats.UPC_E,
            Html5QrcodeSupportedFormats.CODE_128
          ]
        },
        onScanSuccess,
        (errorMessage) => {
          // Omitimos loggear warnings constantes de no detección por frame
        }
      );
      toast.success("Cámara iniciada correctamente");
    } catch (err: any) {
      console.error("Error al iniciar el escáner:", err);
      toast.error(`No se pudo acceder a la cámara: ${err.name || "Error"} - ${err.message || err}`);
      setIsScannerActive(false);
      if (scannerRef.current) {
        try {
          scannerRef.current.clear();
        } catch (e) {}
        scannerRef.current = null;
      }
    }
  };

  const stopScanner = async () => {
    if (scannerRef.current) {
      try {
        if (scannerRef.current.isScanning) {
          await scannerRef.current.stop();
        }
        scannerRef.current.clear();
        setIsScannerActive(false);
        scannerRef.current = null;
      } catch (err) {
        console.error("Failed to stop scanner", err);
        toast.error("Error al apagar la cámara");
        setIsScannerActive(false);
        scannerRef.current = null;
      }
    } else {
      setIsScannerActive(false);
    }
  };

  const onScanSuccess = (decodedText: string) => {
    // Pausar escaneo para procesar
    if (scannerRef.current) {
      // Html5QrcodeScanner no tiene pausa nativa simple, pero podemos usar un flag
      // o limpiar y reiniciar. Aquí simplemente verificamos si ya estamos procesando.
    }
    
    if (isChecking) return;
    
    setScannedResult(decodedText);
    verifyProduct(decodedText);
    
    // Feedback visual/sonoro rápido
    toast.info(`EAN detectado: ${decodedText}`);
  };

  const onScanError = (errorMessage: string) => {
    // console.warn(errorMessage);
  };

  const verifyProduct = async (ean: string) => {
    if (!activeCaja) {
      toast.error("Selecciona una caja activa primero en la pestaña de Cajas");
      return;
    }

    setIsChecking(true);
    try {
      const resp = await fetch(`/api/verificar/${ean}`);
      const data = await resp.json();
      
      setVerificationResult(data);
      
      if (!data.exists) {
        toast.warning("Producto no encontrado. ¿Registrar ahora?");
        setShowQuickRegister(true);
      } else if (data.ubicacion && data.ubicacion.numero_caja !== activeCaja.numero_caja) {
        // Conflicto de ubicación
        setShowConflictDialog(true);
      } else {
        // Producto existe y no tiene conflicto o ya está en esta caja
        asignarProducto(data.product.id_producto);
      }
    } catch (error) {
      toast.error("Error al verificar producto");
    } finally {
      setIsChecking(false);
    }
  };

  const asignarProducto = async (id_producto: number, force = false) => {
    if (!activeCaja) return;

    try {
      const resp = await fetch(`/api/cajas/${activeCaja.id_caja}/asignar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id_producto, force })
      });
      
      if (resp.ok) {
        toast.success("Producto asignado a la caja");
        setVerificationResult(null);
        setScannedResult(null);
        setShowConflictDialog(false);
      } else {
        const errorData = await resp.json();
        toast.error(errorData.error || "Error al asignar");
      }
    } catch (error) {
      toast.error("Error de conexión");
    }
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6 pb-28 md:pb-0">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-5 md:p-6 rounded-3xl shadow-sm border border-neutral-100">
        <div>
          <h2 className="text-2xl md:text-3xl font-black tracking-tight uppercase text-neutral-900 leading-none">ESCÁNER</h2>
          <p className="text-xs md:text-sm text-neutral-500 font-medium mt-1">Sincroniza inventario físico con cajas</p>
        </div>
        
        <div className="flex items-center gap-3 bg-neutral-50 px-4 py-3 rounded-2xl border border-neutral-200">
          <div className="bg-neutral-900 p-2.5 rounded-xl text-white shadow-lg">
            <Box size={22} />
          </div>
          <div>
            <p className="text-[9px] uppercase font-black text-neutral-400 tracking-[0.2em]">Caja Receptora</p>
            <p className="font-black text-neutral-900 leading-none text-xl tracking-tight">
              {activeCaja ? activeCaja.numero_caja : "---"}
            </p>
          </div>
        </div>
      </div>

      {!activeCaja ? (
        <Card className="border-dashed border-2 bg-neutral-50/50">
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <div className="bg-white p-4 rounded-full shadow-sm mb-4">
              <AlertCircle size={32} className="text-amber-500" />
            </div>
            <h3 className="text-lg font-semibold">Caja no seleccionada</h3>
            <p className="text-neutral-500 max-w-xs mt-1 mb-6">
              Debes seleccionar o crear una caja en la pestaña 'Cajas' antes de empezar a escanear.
            </p>
            <Button variant="outline" className="rounded-full">Ir a Cajas</Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-5 gap-6">
          <Card className="md:col-span-3 overflow-hidden border-none shadow-lg">
            <CardHeader className="bg-neutral-900 text-white pb-8">
              <div className="flex justify-between items-center">
                <div>
                  <CardTitle>Visor de Cámara</CardTitle>
                  <CardDescription className="text-neutral-400">Escaneando EAN-13 / UPC / CODE 128</CardDescription>
                </div>
                <Button 
                  size="icon" 
                  variant={isScannerActive ? "destructive" : "secondary"}
                  onClick={isScannerActive ? stopScanner : startScanner}
                  className="rounded-full"
                >
                  {isScannerActive ? <Power size={18} /> : <Camera size={18} />}
                </Button>
              </div>
            </CardHeader>
            <CardContent className={`p-0 bg-neutral-100 relative min-h-[300px] flex items-center justify-center ${!isScannerActive ? "bg-neutral-200" : ""}`}>
              <div id="reader" className="w-full h-full"></div>
              
              {!isScannerActive && (
                <div className="absolute inset-0 flex flex-col items-center justify-center text-neutral-400 space-y-4">
                  <Camera size={48} strokeWidth={1} />
                  <p className="text-sm font-medium">Cámara desactivada</p>
                  <Button onClick={startScanner} variant="outline" size="sm" className="rounded-full bg-white">
                    Activar ahora
                  </Button>
                </div>
              )}

              {isChecking && (
                <div className="absolute inset-0 bg-white/60 backdrop-blur-sm flex flex-col items-center justify-center z-20">
                  <RefreshCw className="animate-spin text-neutral-900 mb-2" size={32} />
                  <p className="font-semibold">Verificando en base de datos...</p>
                </div>
              )}
            </CardContent>
          </Card>

          <div className="md:col-span-2 space-y-4">
            <Card className="h-full">
              <CardHeader>
                <CardTitle className="text-lg">Última Detección</CardTitle>
              </CardHeader>
              <CardContent>
                {scannedResult ? (
                  <div className="space-y-4">
                    {verificationResult?.exists && (
                      <div className="flex justify-center mb-4">
                        <img 
                          src={`/api/productos/${verificationResult.product.id_producto}/image`}
                          alt="Encontrado"
                          className="w-32 h-32 object-cover rounded-2xl shadow-lg border-2 border-white"
                          loading="lazy"
                        />
                      </div>
                    )}
                    <div className="bg-neutral-900 text-white p-4 rounded-xl font-mono text-xl tracking-widest text-center shadow-inner">
                      {scannedResult}
                    </div>
                    
                    {verificationResult?.exists ? (
                      <div className="space-y-4">
                        <div className="flex items-center gap-3 p-3 bg-emerald-50 text-emerald-700 rounded-lg border border-emerald-100">
                          <CheckCircle2 size={20} />
                          <span className="font-medium">Producto Existente</span>
                        </div>
                        <div className="space-y-2 border-t pt-3">
                          <div className="flex justify-between">
                            <span className="text-neutral-500 text-sm">SKU:</span>
                            <span className="font-semibold">{verificationResult.product.sku}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-neutral-500 text-sm">Tipo:</span>
                            <Badge variant="outline" className="capitalize">{verificationResult.product.tipo}</Badge>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-neutral-500 text-sm">Talla:</span>
                            <span className="font-semibold">{verificationResult.product.talla}</span>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="p-4 bg-amber-50 text-amber-700 rounded-lg border border-amber-100 text-center space-y-3">
                        <Package size={32} className="mx-auto opacity-50" />
                        <p className="text-sm font-medium">Este código no está registrado en el inventario</p>
                        <Button 
                          onClick={() => setShowQuickRegister(true)}
                          className="w-full rounded-full bg-amber-600 hover:bg-amber-700"
                        >
                          Registro Rápido
                        </Button>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center py-12 text-center text-neutral-400 space-y-2">
                    <Scan size={40} strokeWidth={1} />
                    <p className="text-sm">Esperando lectura de código...</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {/* Modal Registro Rápido */}
      {showQuickRegister && (
        <ProductQuickRegister 
          ean={scannedResult || ""} 
          onClose={() => setShowQuickRegister(false)}
          onSuccess={(product) => {
            asignarProducto(product.id_producto);
            setShowQuickRegister(false);
          }}
        />
      )}

      {/* Dialogo de Conflicto de Ubicación */}
      <Dialog open={showConflictDialog} onOpenChange={setShowConflictDialog}>
        <DialogContent className="rounded-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-rose-600">
              <AlertCircle /> Conflicto de Ubicación
            </DialogTitle>
          </DialogHeader>
          <div className="py-6 space-y-4 text-center">
            <p className="text-neutral-600">
              Este producto ya se encuentra registrado en otra caja activa:
            </p>
            <div className="bg-neutral-100 p-6 rounded-2xl border border-neutral-200">
              <p className="text-xs uppercase font-bold text-neutral-400 mb-1">Caja Origen</p>
              <p className="text-2xl font-black text-neutral-900">{verificationResult?.ubicacion?.numero_caja}</p>
              <Badge className="mt-2 bg-amber-500">{verificationResult?.ubicacion?.estado}</Badge>
            </div>
            <p className="text-sm text-neutral-500">
              ¿Deseas mover el producto a la caja actual <strong>{activeCaja?.numero_caja}</strong>?
            </p>
          </div>
          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button variant="outline" onClick={() => setShowConflictDialog(false)} className="rounded-full flex-1">
              Cancelar
            </Button>
            <Button 
              className="rounded-full flex-1 bg-neutral-900"
              onClick={() => asignarProducto(verificationResult.product.id_producto, true)}
            >
              Mover a esta caja
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
