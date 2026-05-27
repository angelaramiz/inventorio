import React, { useState, useRef, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Camera, Save, X, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Producto, Temporada, TipoProducto } from "../types";

interface Props {
  ean: string;
  defaultQty?: number;
  defaultTemporada?: string;
  defaultTipo?: string;
  onClose: () => void;
  onSuccess: (product: Producto, qty: number) => void;
}

const TALLAS_LETRA = ["SinTalla", "XS", "S", "M", "L", "XL", "XXL"];
const TALLAS_NUMERO = ["SinTalla", "38", "40", "42", "44", "46", "48"];

export default function ProductQuickRegister({ ean, defaultQty = 1, defaultTemporada, defaultTipo, onClose, onSuccess }: Props) {
  const [loading, setLoading] = useState(false);
  const [showCamera, setShowCamera] = useState(false);
  const [photo, setPhoto] = useState<string | null>(null);
  const [cantidad, setCantidad] = useState(defaultQty);
  const videoRef = useRef<HTMLVideoElement>(null);
  
  const [tallaTipo, setTallaTipo] = useState<"letra" | "numero">("letra");
  const [tallaValue, setTallaValue] = useState("SinTalla");

  const [formData, setFormData] = useState({
    sku: ean,
    ean_13: ean,
    talla: "SinTalla",
    temporada: (defaultTemporada || "todouso") as Temporada,
    tipo: (defaultTipo || "otro") as TipoProducto,
    marca_sub: "Guess",
    modelo_grupo: "sin modelo"
  });

  const [temporadas, setTemporadas] = useState<string[]>([]);
  const [tipos, setTipos] = useState<string[]>([]);
  const [marcas, setMarcas] = useState<string[]>(["Guess", "Marciano", "GuessEco"]);

  useEffect(() => {
    setFormData(prev => ({ ...prev, talla: tallaValue }));
  }, [tallaValue]);

  useEffect(() => {
    const loadOptions = async () => {
      try {
        const [respTemp, respTipos, respMarcas] = await Promise.all([
          fetch("/api/conceptos/temporadas"),
          fetch("/api/conceptos/tipos"),
          fetch("/api/conceptos/marcas")
        ]);
        const tempVals = await respTemp.json();
        const tipoVals = await respTipos.json();
        const marcaVals = await respMarcas.json();
        
        const tempNames = tempVals.map((v: any) => typeof v === 'object' ? v.nombre : v);
        const tipoNames = tipoVals.map((v: any) => typeof v === 'object' ? v.nombre : v);
        const marcaNames = marcaVals.map((v: any) => typeof v === 'object' ? v.nombre : v);
        
        setTemporadas(tempNames);
        setTipos(tipoNames);
        if (marcaNames.length > 0) {
          setMarcas(marcaNames);
        }
        
        setFormData(prev => ({
          ...prev,
          temporada: defaultTemporada && tempNames.includes(defaultTemporada) 
            ? defaultTemporada 
            : (tempNames.includes("todouso") ? "todouso" : (tempNames[0] || "")),
          tipo: defaultTipo && tipoNames.includes(defaultTipo.toLowerCase()) 
            ? defaultTipo.toLowerCase() 
            : (tipoNames.includes("otro") ? "otro" : (tipoNames[0] || "")),
          marca_sub: prev.marca_sub || marcaNames[0] || "Guess"
        }));
      } catch (err) {
        console.error("Error loading dynamic concepts", err);
      }
    };
    loadOptions();
  }, []);

  const handleTallaTipoChange = (val: "letra" | "numero") => {
    setTallaTipo(val);
    const defaultVal = val === "letra" ? "M" : "40";
    setTallaValue(defaultVal);
  };

  const startCamera = async () => {
    setShowCamera(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
    } catch (err) {
      toast.error("No se pudo acceder a la cámara");
      setShowCamera(false);
    }
  };

  const capturePhoto = () => {
    const video = videoRef.current;
    if (!video) return;

    const canvas = document.createElement("canvas");
    // Redimensionar a maximo 400px (mantenemos aspecto)
    const targetSize = 400;
    let width = video.videoWidth;
    let height = video.videoHeight;

    if (width > height) {
      if (width > targetSize) {
        height *= targetSize / width;
        width = targetSize;
      }
    } else {
      if (height > targetSize) {
        width *= targetSize / height;
        height = targetSize;
      }
    }

    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      // Dibujar imagen centrada y escalada
      ctx.drawImage(video, 0, 0, width, height);
      
      // Convertir a WebP con calidad optimizada (0.7)
      const dataUrl = canvas.toDataURL("image/webp", 0.7);
      
      // Validar tamaño aproximado (DataURL es ~33% más grande que el binario)
      const estimatedSize = (dataUrl.length * 3) / 4;
      if (estimatedSize > 180000) { // 180KB
        // Reintentar con menor calidad si es muy grande
        const superCompressed = canvas.toDataURL("image/webp", 0.5);
        setPhoto(superCompressed);
      } else {
        setPhoto(dataUrl);
      }
      
      stopCamera();
    }
  };

  const stopCamera = () => {
    if (videoRef.current && videoRef.current.srcObject) {
      const tracks = (videoRef.current.srcObject as MediaStream).getTracks();
      tracks.forEach(track => track.stop());
    }
    setShowCamera(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.sku) return toast.error("El SKU es obligatorio");

    setLoading(true);
    try {
      const fd = new FormData();
      fd.append("sku", formData.sku);
      fd.append("ean_13", formData.ean_13);
      fd.append("talla", formData.talla);
      fd.append("temporada", formData.temporada);
      fd.append("tipo", formData.tipo);
      fd.append("marca_sub", formData.marca_sub);
      fd.append("modelo_grupo", formData.modelo_grupo);
      
      if (photo) {
        const res = await fetch(photo);
        const blob = await res.blob();
        fd.append("foto", blob, "captura.webp");
      }

      const resp = await fetch("/api/productos", {
        method: "POST",
        body: fd
      });

      if (resp.ok) {
        const product = await resp.json();
        toast.success("Articulo registrado y sincronizado");
        onSuccess(product, cantidad);
      } else {
        const error = await resp.json();
        toast.error(error.error || "Fallo en registro");
      }
    } catch (err) {
      toast.error("Error de conexión");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={true} onOpenChange={onClose}>
      <DialogContent className="max-w-md sm:max-w-md gap-0 w-[95vw] rounded-[2.5rem] p-0 overflow-hidden border-none shadow-2xl flex flex-col max-h-[90vh]">
        <DialogHeader className="bg-neutral-950 text-white p-6 shrink-0">
          <DialogTitle className="text-xl font-black flex items-center gap-3 uppercase tracking-tight">
            <div className="bg-amber-400 p-1.5 rounded-lg text-black">
              <Save size={18} />
            </div>
            Registro Express
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="p-6 space-y-5 overflow-y-auto custom-scrollbar">
          <div className="flex justify-center">
            {photo ? (
              <div className="relative group">
                <img src={photo} alt="Preview" className="w-40 h-40 object-cover rounded-2xl shadow-md border-2 border-white" />
                <button 
                  type="button"
                  onClick={() => setPhoto(null)}
                  className="absolute -top-2 -right-2 bg-rose-500 text-white p-1.5 rounded-full shadow-lg opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <X size={14} />
                </button>
              </div>
            ) : showCamera ? (
              <div className="relative w-40 h-40 bg-black rounded-2xl overflow-hidden mx-auto">
                <video ref={videoRef} autoPlay playsInline className="w-full h-full object-cover" />
                <div className="absolute bottom-2 left-0 right-0 flex justify-center">
                  <Button type="button" onClick={capturePhoto} className="rounded-full h-9 w-9 bg-white text-black hover:bg-neutral-200 shadow-xl border-2 border-neutral-900/10 flex items-center justify-center p-0">
                    <div className="h-6 w-6 rounded-full border border-black"></div>
                  </Button>
                </div>
              </div>
            ) : (
              <button 
                type="button"
                onClick={startCamera}
                className="w-40 h-40 bg-neutral-100 border-2 border-dashed border-neutral-300 rounded-2xl flex flex-col items-center justify-center text-neutral-400 hover:bg-neutral-50 hover:border-neutral-400 transition-all group"
              >
                <Camera size={32} className="mb-2 group-hover:scale-110 transition-transform" />
                <span className="text-xs font-semibold">Tomar Foto</span>
              </button>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1 col-span-2">
              <label className="text-[10px] uppercase font-bold text-neutral-400 px-1">SKU / EAN-13</label>
              <Input 
                value={formData.sku} 
                onChange={e => setFormData({...formData, sku: e.target.value, ean_13: e.target.value})}
                placeholder="Código de barras"
                className="rounded-xl bg-neutral-50"
              />
            </div>
            
            <div className="space-y-1 col-span-2">
              <label className="text-[10px] uppercase font-bold text-neutral-400 px-1">Modelo de Grupo (Estilo/Color)</label>
              <Input 
                value={formData.modelo_grupo} 
                onChange={e => setFormData({...formData, modelo_grupo: e.target.value})}
                placeholder="Ej: M12345 (sin modelo por defecto)"
                className="rounded-xl bg-neutral-50"
              />
            </div>
            
            <div className="space-y-1">
              <label className="text-[10px] uppercase font-bold text-neutral-400 px-1">Cantidad Inicial</label>
              <Input 
                type="number"
                min={1}
                value={cantidad} 
                onChange={e => setCantidad(parseInt(e.target.value) || 1)}
                placeholder="1"
                className="rounded-xl bg-neutral-50"
              />
            </div>
            
            <div className="space-y-1">
              <label className="text-[10px] uppercase font-bold text-neutral-400 px-1">Tipo Talla</label>
              <Select value={tallaTipo} onValueChange={(v: any) => handleTallaTipoChange(v)}>
                <SelectTrigger className="rounded-xl bg-neutral-50 capitalize">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="letra">Letra</SelectItem>
                  <SelectItem value="numero">Número</SelectItem>
                </SelectContent>
              </Select>
            </div>
            
            <div className="space-y-1">
              <label className="text-[10px] uppercase font-bold text-neutral-400 px-1">Valor Talla</label>
              <Select value={tallaValue} onValueChange={setTallaValue}>
                <SelectTrigger className="rounded-xl bg-neutral-50">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(tallaTipo === "letra" ? TALLAS_LETRA : TALLAS_NUMERO).map(t => (
                    <SelectItem key={t} value={t}>{t}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <label className="text-[10px] uppercase font-bold text-neutral-400 px-1">Marca</label>
              <Select value={formData.marca_sub} onValueChange={(v) => setFormData({...formData, marca_sub: v})}>
                <SelectTrigger className="rounded-xl bg-neutral-50">
                  <SelectValue placeholder="Seleccionar marca" />
                </SelectTrigger>
                <SelectContent>
                  {marcas.map(m => (
                    <SelectItem key={m} value={m}>{m}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <label className="text-[10px] uppercase font-bold text-neutral-400 px-1">Tipo</label>
              <Select value={formData.tipo} onValueChange={(v: any) => setFormData({...formData, tipo: v})}>
                <SelectTrigger className="rounded-xl bg-neutral-50 capitalize">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {tipos.map(t => (
                    <SelectItem key={t} value={t} className="capitalize">{t}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <label className="text-[10px] uppercase font-bold text-neutral-400 px-1">Temporada</label>
              <Select value={formData.temporada} onValueChange={(v: any) => setFormData({...formData, temporada: v})}>
                <SelectTrigger className="rounded-xl bg-neutral-50 capitalize">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {temporadas.map(temp => (
                    <SelectItem key={temp} value={temp} className="capitalize">{temp}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex gap-3 pt-2">
            <Button type="button" variant="outline" onClick={onClose} className="flex-1 rounded-xl h-12">
              Cancelar
            </Button>
            <Button type="submit" disabled={loading} className="flex-1 rounded-xl h-12 bg-neutral-900 group">
              {loading ? <Loader2 className="animate-spin mr-2" /> : <Save className="mr-2 group-hover:scale-110 transition-transform" />}
              Guardar
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
