import React, { useState, useRef, useEffect, FormEvent } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Camera, Save, X, Loader2, Image as ImageIcon, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Producto, Temporada, TipoProducto } from "../types";

interface Props {
  product: Producto;
  onClose: () => void;
  onSuccess: () => void;
}

export default function ProductEditModal({ product, onClose, onSuccess }: Props) {
  const [loading, setLoading] = useState(false);
  const [showCamera, setShowCamera] = useState(false);
  const [photo, setPhoto] = useState<string | null>(null);
  const [deleteFoto, setDeleteFoto] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [formData, setFormData] = useState({
    sku: product.sku,
    ean_13: product.ean_13 || "",
    talla: product.talla || "",
    temporada: product.temporada as Temporada,
    tipo: product.tipo as TipoProducto,
    marca_sub: product.marca_sub || ""
  });

  const [temporadas, setTemporadas] = useState<string[]>([]);
  const [tipos, setTipos] = useState<string[]>([]);

  useEffect(() => {
    const loadOptions = async () => {
      try {
        const [respTemp, respTipos] = await Promise.all([
          fetch("/api/conceptos/temporadas"),
          fetch("/api/conceptos/tipos")
        ]);
        const tempVals = await respTemp.json();
        const tipoVals = await respTipos.json();
        setTemporadas(tempVals.map((v: any) => typeof v === 'object' ? v.nombre : v));
        setTipos(tipoVals.map((v: any) => typeof v === 'object' ? v.nombre : v));
      } catch (err) {
        console.error("Error loading concepts", err);
      }
    };
    loadOptions();
  }, []);

  const startCamera = async () => {
    setShowCamera(true);
    setDeleteFoto(false);
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
      ctx.drawImage(video, 0, 0, width, height);
      const dataUrl = canvas.toDataURL("image/webp", 0.7);
      
      const estimatedSize = (dataUrl.length * 3) / 4;
      if (estimatedSize > 180000) {
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

  useEffect(() => {
    return () => {
      // Clean up camera stream if modal unmounts
      if (videoRef.current && videoRef.current.srcObject) {
        const tracks = (videoRef.current.srcObject as MediaStream).getTracks();
        tracks.forEach(track => track.stop());
      }
    };
  }, []);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      toast.error("El archivo debe ser una imagen");
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      setPhoto(reader.result as string);
      setDeleteFoto(false);
    };
    reader.readAsDataURL(file);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!formData.sku.trim()) return toast.error("El SKU es obligatorio");

    setLoading(true);
    try {
      const fd = new FormData();
      fd.append("sku", formData.sku.trim());
      fd.append("ean_13", formData.ean_13.trim());
      fd.append("talla", formData.talla.trim());
      fd.append("temporada", formData.temporada);
      fd.append("tipo", formData.tipo);
      fd.append("marca_sub", formData.marca_sub.trim());
      
      if (photo) {
        const res = await fetch(photo);
        const blob = await res.blob();
        fd.append("foto", blob, "producto.webp");
      } else if (deleteFoto) {
        fd.append("delete_foto", "true");
      }

      const resp = await fetch(`/api/productos/${product.id_producto}`, {
        method: "PUT",
        body: fd
      });

      if (resp.ok) {
        toast.success("Producto actualizado correctamente");
        onSuccess();
        onClose();
      } else {
        const err = await resp.json();
        toast.error(err.error || "Error al actualizar producto");
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
            Editar Producto
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="p-6 space-y-5 overflow-y-auto custom-scrollbar">
          {/* SECCIÓN FOTO */}
          <div className="flex flex-col items-center gap-3">
            <div className="relative group">
              {photo ? (
                <img src={photo} alt="Preview" className="w-36 h-36 object-cover rounded-2xl shadow-md border-2 border-white" />
              ) : !deleteFoto && product.has_foto ? (
                <img 
                  src={`/api/productos/${product.id_producto}/image?t=${new Date().getTime()}`} 
                  alt="Actual" 
                  className="w-36 h-36 object-cover rounded-2xl shadow-md border-2 border-white" 
                />
              ) : showCamera ? (
                <div className="relative w-36 h-36 bg-black rounded-2xl overflow-hidden">
                  <video ref={videoRef} autoPlay playsInline className="w-full h-full object-cover" />
                  <div className="absolute bottom-2 left-0 right-0 flex justify-center">
                    <Button type="button" onClick={capturePhoto} className="rounded-full h-9 w-9 bg-white text-black hover:bg-neutral-200 shadow-xl border-2 border-neutral-900/10 flex items-center justify-center p-0">
                      <div className="h-6 w-6 rounded-full border border-black"></div>
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="w-36 h-36 bg-neutral-100 border-2 border-dashed border-neutral-300 rounded-2xl flex flex-col items-center justify-center text-neutral-400">
                  <ImageIcon size={32} />
                  <span className="text-[10px] font-semibold mt-1">Sin Foto</span>
                </div>
              )}
              
              {(photo || (!deleteFoto && product.has_foto)) && (
                <button 
                  type="button"
                  onClick={() => {
                    setPhoto(null);
                    setDeleteFoto(true);
                  }}
                  className="absolute -top-2 -right-2 bg-rose-500 text-white p-1.5 rounded-full shadow-lg opacity-0 group-hover:opacity-100 transition-opacity"
                  title="Eliminar foto"
                >
                  <X size={14} />
                </button>
              )}
            </div>

            <div className="flex gap-2">
              <input 
                type="file" 
                ref={fileInputRef} 
                onChange={handleFileUpload} 
                className="hidden" 
                accept="image/*"
              />
              {!showCamera ? (
                <>
                  <Button 
                    type="button" 
                    variant="outline" 
                    size="sm"
                    className="rounded-xl gap-1 text-xs h-9 px-3"
                    onClick={startCamera}
                  >
                    <Camera size={14} /> Cámara
                  </Button>
                  <Button 
                    type="button" 
                    variant="outline" 
                    size="sm"
                    className="rounded-xl gap-1 text-xs h-9 px-3"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <Upload size={14} /> Archivo
                  </Button>
                </>
              ) : (
                <Button 
                  type="button" 
                  variant="outline" 
                  size="sm"
                  className="rounded-xl gap-1 text-xs h-9 px-3 border-rose-200 text-rose-600 hover:bg-rose-50"
                  onClick={stopCamera}
                >
                  Cancelar Cámara
                </Button>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1 col-span-2">
              <label className="text-[10px] uppercase font-bold text-neutral-400 px-1">SKU</label>
              <Input 
                value={formData.sku} 
                onChange={e => setFormData({...formData, sku: e.target.value})}
                placeholder="Código de barras SKU"
                className="rounded-xl bg-neutral-50"
              />
            </div>

            <div className="space-y-1 col-span-2">
              <label className="text-[10px] uppercase font-bold text-neutral-400 px-1">EAN-13</label>
              <Input 
                value={formData.ean_13} 
                onChange={e => setFormData({...formData, ean_13: e.target.value})}
                placeholder="Escribir EAN-13 si es diferente al SKU"
                className="rounded-xl bg-neutral-50"
              />
            </div>
            
            <div className="space-y-1">
              <label className="text-[10px] uppercase font-bold text-neutral-400 px-1">Talla</label>
              <Input 
                value={formData.talla} 
                onChange={e => setFormData({...formData, talla: e.target.value})}
                placeholder="L, 42, etc"
                className="rounded-xl bg-neutral-50"
              />
            </div>

            <div className="space-y-1">
              <label className="text-[10px] uppercase font-bold text-neutral-400 px-1">Marca</label>
              <Input 
                value={formData.marca_sub} 
                onChange={e => setFormData({...formData, marca_sub: e.target.value})}
                placeholder="Sub-marca / Proveedor"
                className="rounded-xl bg-neutral-50"
              />
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
              Guardar Cambios
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
