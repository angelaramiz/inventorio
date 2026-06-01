import React, { useState, useEffect, FormEvent } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Save, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { Producto, Temporada, TipoProducto } from "../types";
import AsyncImageUploader from "./AsyncImageUploader";
import { fetchCatalogWithCache } from "../utils/pwaDb";

interface Props {
  product: Producto;
  onClose: () => void;
  onSuccess: () => void;
}

const TALLAS_LETRA = ["SinTalla", "XS", "S", "M", "L", "XL", "XXL"];
const TALLAS_NUMERO = ["SinTalla", "38", "40", "42", "44", "46", "48"];

export default function ProductEditModal({ product, onClose, onSuccess }: Props) {
  const [loading, setLoading] = useState(false);

  const [tallaTipo, setTallaTipo] = useState<"letra" | "numero">(() => {
    const isNum = /^\d+$/.test(product.talla || "");
    return isNum ? "numero" : "letra";
  });
  const [tallaValue, setTallaValue] = useState(() => {
    return product.talla || "M";
  });

  const [formData, setFormData] = useState({
    sku: product.sku,
    ean_13: product.ean_13 || "",
    talla: product.talla || "M",
    temporada: product.temporada as Temporada,
    tipo: product.tipo as TipoProducto,
    marca_sub: product.marca_sub || "Guess",
    modelo_grupo: (product as any).modelo_grupo || "sin modelo"
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
        const [tempVals, tiposVals, marcaVals] = await Promise.all([
          fetchCatalogWithCache("/api/conceptos/temporadas", "temporadas"),
          fetchCatalogWithCache("/api/conceptos/tipos", "tipos"),
          fetchCatalogWithCache("/api/conceptos/marcas", "marcas")
        ]);
        
        setTemporadas(tempVals.map((v: any) => typeof v === 'object' ? v.nombre : v));
        setTipos(tiposVals.map((v: any) => typeof v === 'object' ? v.nombre : v));
        
        const marcaNames = marcaVals.map((v: any) => typeof v === 'object' ? v.nombre : v);
        if (marcaNames.length > 0) {
          setMarcas(marcaNames);
        }
      } catch (err) {
        console.error("Error loading concepts", err);
      }
    };

    loadOptions();
  }, []);

  const handleTallaTipoChange = (val: "letra" | "numero") => {
    setTallaTipo(val);
    const defaultVal = val === "letra" ? "M" : "40";
    setTallaValue(defaultVal);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!formData.sku.trim()) return toast.error("El SKU es obligatorio");

    setLoading(true);
    try {
      const resp = await fetch(`/api/productos/${product.id_producto}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sku: formData.sku.trim(),
          ean_13: formData.ean_13.trim(),
          talla: formData.talla.trim(),
          temporada: formData.temporada,
          tipo: formData.tipo,
          marca_sub: formData.marca_sub.trim(),
          modelo_grupo: formData.modelo_grupo.trim()
        })
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
        <DialogHeader className="bg-neutral-950 text-white p-6 shrink-0 relative">
          <button 
            type="button" 
            onClick={onClose} 
            className="absolute top-4 right-4 text-white/70 hover:text-white hover:bg-white/10 p-2 rounded-xl transition-colors z-50"
            title="Cerrar"
          >
            <X size={18} />
          </button>
          <DialogTitle className="text-xl font-black flex items-center gap-3 uppercase tracking-tight">
            <div className="bg-amber-400 p-1.5 rounded-lg text-black">
              <Save size={18} />
            </div>
            Editar Producto
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="p-6 space-y-5 overflow-y-auto custom-scrollbar">
          {/* CARGADOR ASÍNCRONO DE IMÁGENES */}
          <AsyncImageUploader 
            productoId={product.id_producto}
            hasFoto={product.has_foto || false}
            onSuccess={onSuccess}
          />


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
              {tallaTipo === "letra" ? (
                <Select value={tallaValue} onValueChange={setTallaValue}>
                  <SelectTrigger className="rounded-xl bg-neutral-50">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TALLAS_LETRA.map(t => (
                      <SelectItem key={t} value={t}>{t}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input 
                  type="text" 
                  value={tallaValue === "SinTalla" ? "" : tallaValue} 
                  onChange={e => setTallaValue(e.target.value.toUpperCase())}
                  placeholder="Ej: 38, 40.5..."
                  className="rounded-xl bg-neutral-50 border-neutral-200 h-10"
                />
              )}
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
              Guardar Cambios
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
