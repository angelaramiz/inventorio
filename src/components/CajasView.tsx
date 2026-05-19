import React, { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Plus, Box, ExternalLink, Archive, CheckCircle2, History, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Caja } from "../types";
import CajaDetailsModal from "./CajaDetailsModal";

export default function CajasView() {
  const [cajas, setCajas] = useState<Caja[]>([]);
  const [loading, setLoading] = useState(true);
  const [newCajaNumber, setNewCajaNumber] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [selectedCaja, setSelectedCaja] = useState<Caja | null>(null);
  const [activeCajaId, setActiveCajaId] = useState<number | null>(null);

  useEffect(() => {
    fetchCajas();
    const saved = localStorage.getItem("activeCaja");
    if (saved) {
      setActiveCajaId(JSON.parse(saved).id_caja);
    }
  }, []);

  const fetchCajas = async () => {
    setLoading(true);
    try {
      const resp = await fetch("/api/cajas");
      const data = await resp.json();
      setCajas(data);
    } catch (err) {
      toast.error("Error al cargar cajas");
    } finally {
      setLoading(false);
    }
  };

  const handleCreateCaja = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCajaNumber) return;

    setIsCreating(true);
    try {
      const resp = await fetch("/api/cajas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ numero_caja: newCajaNumber })
      });
      if (resp.ok) {
        toast.success("Caja creada correctamente");
        setNewCajaNumber("");
        fetchCajas();
      } else {
        const err = await resp.json();
        toast.error(err.error || "Error al crear");
      }
    } catch (err) {
      toast.error("Error de conexión");
    } finally {
      setIsCreating(false);
    }
  };

  const selectCaja = (caja: Caja) => {
    localStorage.setItem("activeCaja", JSON.stringify(caja));
    setActiveCajaId(caja.id_caja);
    toast.success(`Caja ${caja.numero_caja} seleccionada para escaneo`);
  };

  const updateEstado = async (id: number, nuevoEstado: string) => {
    try {
      const resp = await fetch(`/api/cajas/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ estado: nuevoEstado })
      });
      if (resp.ok) {
        toast.success("Estado actualizado");
        fetchCajas();
      }
    } catch (err) {
      toast.error("Error al actualizar");
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "vacia": return "bg-neutral-100 text-neutral-500 border-neutral-200";
      case "activa": return "bg-blue-50 text-blue-600 border-blue-100";
      case "llena": return "bg-emerald-50 text-emerald-600 border-emerald-100";
      default: return "";
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-3xl font-black tracking-tight flex items-center gap-3">
            <Archive size={32} className="text-neutral-400" /> GESTIÓN DE CAJAS
          </h2>
          <p className="text-neutral-500">Administra contenedores y estados de envío</p>
        </div>

        <form onSubmit={handleCreateCaja} className="flex gap-2 bg-white p-2 rounded-2xl shadow-sm border">
          <Input 
            placeholder="Nº de Caja (ej: 001)" 
            value={newCajaNumber}
            onChange={e => setNewCajaNumber(e.target.value)}
            className="border-none bg-transparent focus-visible:ring-0 w-44"
          />
          <Button disabled={isCreating} type="submit" className="rounded-xl h-10 bg-neutral-900">
            {isCreating ? <Loader2 className="animate-spin" /> : <Plus className="mr-2" size={18} />}
            Crear
          </Button>
        </form>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
        {loading ? (
          Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-48 bg-neutral-100 animate-pulse rounded-2xl border" />
          ))
        ) : cajas.length === 0 ? (
          <div className="col-span-full py-20 text-center text-neutral-400">
            <Box size={48} className="mx-auto mb-4 opacity-20" />
            <p>No hay cajas registradas aún.</p>
          </div>
        ) : cajas.map((caja) => (
          <Card 
            key={caja.id_caja} 
            className={`group relative overflow-hidden transition-all duration-300 hover:shadow-xl hover:-translate-y-1 rounded-2xl border-2 ${
              activeCajaId === caja.id_caja ? "border-blue-500 shadow-blue-100 shadow-lg" : "border-neutral-100"
            }`}
          >
            <div className={`absolute top-0 right-0 p-3 flex gap-1 items-center transition-opacity ${activeCajaId === caja.id_caja ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}>
               <Button 
                variant="ghost" 
                size="icon" 
                className="rounded-full bg-white/80 backdrop-blur-sm h-8 w-8 hover:bg-neutral-900 hover:text-white"
                onClick={() => setSelectedCaja(caja)}
              >
                <ExternalLink size={14} />
              </Button>
            </div>

            <CardHeader className="pb-2">
              <div className="flex justify-between items-start">
                <div className={`${activeCajaId === caja.id_caja ? "bg-blue-600" : "bg-neutral-900"} p-2.5 rounded-xl text-white shadow-lg`}>
                  <Box size={24} />
                </div>
                <Badge variant="outline" className={`capitalize border font-bold ${getStatusColor(caja.estado)}`}>
                  {caja.estado}
                </Badge>
              </div>
              <CardTitle className="text-2xl pt-4 font-black tracking-tight">{caja.numero_caja}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-4 py-3 border-y border-neutral-50 mb-4">
                <div>
                  <p className="text-[10px] uppercase font-bold text-neutral-400">Modelos</p>
                  <p className="text-xl font-bold">{caja.total_productos_unicos || 0}</p>
                </div>
                <div>
                  <p className="text-[10px] uppercase font-bold text-neutral-400">Total Unidades</p>
                  <p className="text-xl font-bold">{caja.total_unidades || 0}</p>
                </div>
              </div>

              <div className="flex gap-2">
                {caja.estado !== "llena" ? (
                  <>
                    <Button 
                      className={`flex-1 rounded-xl font-bold ${activeCajaId === caja.id_caja ? "bg-blue-600 hover:bg-blue-700" : "bg-neutral-900"}`}
                      onClick={() => selectCaja(caja)}
                    >
                      {activeCajaId === caja.id_caja ? <CheckCircle2 className="mr-2" size={16} /> : "Seleccionar"}
                    </Button>
                    <Button 
                      variant="outline" 
                      className="rounded-xl"
                      onClick={() => updateEstado(caja.id_caja, "llena")}
                    >
                      Cerrar
                    </Button>
                  </>
                ) : (
                  <Button 
                    variant="outline" 
                    className="w-full rounded-xl gap-2 text-neutral-500 hover:bg-neutral-50"
                    onClick={() => updateEstado(caja.id_caja, "activa")}
                  >
                    <History size={16} /> Reabrir Caja
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {selectedCaja && (
        <CajaDetailsModal 
          caja={selectedCaja} 
          onClose={() => {
            setSelectedCaja(null);
            fetchCajas();
          }} 
        />
      )}
    </div>
  );
}
