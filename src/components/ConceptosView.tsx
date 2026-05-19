import React, { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Trash2, Plus, Tag, Calendar, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { motion, AnimatePresence } from "motion/react";

export default function ConceptosView() {
  const [temporadas, setTemporadas] = useState<string[]>([]);
  const [tipos, setTipos] = useState<string[]>([]);
  const [loadingTemp, setLoadingTemp] = useState(true);
  const [loadingTipos, setLoadingTipos] = useState(true);
  
  const [newTemporada, setNewTemporada] = useState("");
  const [newTipo, setNewTipo] = useState("");
  const [isAddingTemp, setIsAddingTemp] = useState(false);
  const [isAddingTipo, setIsAddingTipo] = useState(false);

  useEffect(() => {
    fetchTemporadas();
    fetchTipos();
  }, []);

  const fetchTemporadas = async () => {
    setLoadingTemp(true);
    try {
      const resp = await fetch("/api/conceptos/temporadas");
      const data = await resp.json();
      setTemporadas(data);
    } catch (err) {
      toast.error("Error al cargar temporadas");
    } finally {
      setLoadingTemp(false);
    }
  };

  const fetchTipos = async () => {
    setLoadingTipos(true);
    try {
      const resp = await fetch("/api/conceptos/tipos");
      const data = await resp.json();
      setTipos(data);
    } catch (err) {
      toast.error("Error al cargar tipos de producto");
    } finally {
      setLoadingTipos(false);
    }
  };

  const handleAddTemporada = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTemporada.trim()) return;

    setIsAddingTemp(true);
    try {
      const resp = await fetch("/api/conceptos/temporadas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nombre: newTemporada })
      });
      if (resp.ok) {
        toast.success(`Temporada "${newTemporada}" agregada`);
        setNewTemporada("");
        fetchTemporadas();
      } else {
        const err = await resp.json();
        toast.error(err.error || "Error al agregar");
      }
    } catch (err) {
      toast.error("Error de conexión");
    } finally {
      setIsAddingTemp(false);
    }
  };

  const handleAddTipo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTipo.trim()) return;

    setIsAddingTipo(true);
    try {
      const resp = await fetch("/api/conceptos/tipos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nombre: newTipo })
      });
      if (resp.ok) {
        toast.success(`Tipo "${newTipo}" agregado`);
        setNewTipo("");
        fetchTipos();
      } else {
        const err = await resp.json();
        toast.error(err.error || "Error al agregar");
      }
    } catch (err) {
      toast.error("Error de conexión");
    } finally {
      setIsAddingTipo(false);
    }
  };

  const handleDeleteTemporada = async (nombre: string) => {
    if (!window.confirm(`¿Estás seguro de eliminar la temporada "${nombre}"? Los productos que la utilicen conservarán el texto, pero ya no aparecerá como opción para nuevos registros.`)) {
      return;
    }

    try {
      const resp = await fetch(`/api/conceptos/temporadas/${encodeURIComponent(nombre)}`, {
        method: "DELETE"
      });
      if (resp.ok) {
        toast.success(`Temporada "${nombre}" eliminada`);
        fetchTemporadas();
      } else {
        const err = await resp.json();
        toast.error(err.error || "Error al eliminar");
      }
    } catch (err) {
      toast.error("Error al eliminar");
    }
  };

  const handleDeleteTipo = async (nombre: string) => {
    if (!window.confirm(`¿Estás seguro de eliminar el tipo "${nombre}"? Los productos que lo utilicen conservarán el texto, pero ya no aparecerá como opción para nuevos registros.`)) {
      return;
    }

    try {
      const resp = await fetch(`/api/conceptos/tipos/${encodeURIComponent(nombre)}`, {
        method: "DELETE"
      });
      if (resp.ok) {
        toast.success(`Tipo "${nombre}" eliminado`);
        fetchTipos();
      } else {
        const err = await resp.json();
        toast.error(err.error || "Error al eliminar");
      }
    } catch (err) {
      toast.error("Error al eliminar");
    }
  };

  return (
    <div className="space-y-6 pb-20 md:pb-0">
      <div>
        <h2 className="text-3xl font-black tracking-tight flex items-center gap-3 uppercase text-neutral-900">
          <Tag size={32} className="text-neutral-400" /> Conceptos del Sistema
        </h2>
        <p className="text-neutral-500 font-medium">Administra las opciones dinámicas del catálogo de productos</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        {/* PANEL DE TEMPORADAS */}
        <Card className="border border-neutral-100 shadow-lg rounded-[2rem] overflow-hidden bg-white flex flex-col">
          <CardHeader className="bg-neutral-50 border-b pb-4">
            <CardTitle className="text-xl flex items-center gap-2 font-bold text-neutral-900">
              <Calendar size={20} className="text-neutral-500" />
              Temporadas
            </CardTitle>
            <CardDescription className="text-neutral-500">
              Define ciclos de colección (ej: verano, invierno, halloween)
            </CardDescription>
          </CardHeader>
          <CardContent className="p-6 flex-1 flex flex-col space-y-4">
            <form onSubmit={handleAddTemporada} className="flex gap-2">
              <Input 
                placeholder="Nueva temporada (ej: primavera)" 
                value={newTemporada}
                onChange={e => setNewTemporada(e.target.value)}
                className="rounded-xl bg-neutral-50 border-neutral-200 focus-visible:ring-neutral-400 h-11"
                disabled={isAddingTemp}
              />
              <Button type="submit" disabled={isAddingTemp || !newTemporada.trim()} className="rounded-xl h-11 bg-neutral-900 hover:bg-neutral-800 text-white shrink-0 font-semibold px-4">
                {isAddingTemp ? <Loader2 className="animate-spin" size={18} /> : <Plus size={18} />}
              </Button>
            </form>

            <div className="flex-1 min-h-[250px] border border-neutral-100 rounded-2xl overflow-y-auto max-h-[400px] p-2 bg-neutral-50/50">
              {loadingTemp ? (
                <div className="flex flex-col items-center justify-center py-16 text-neutral-400">
                  <Loader2 className="animate-spin mb-2" size={24} />
                  <span className="text-xs font-semibold">Cargando...</span>
                </div>
              ) : temporadas.length === 0 ? (
                <div className="text-center py-16 text-neutral-400 text-sm">
                  No hay temporadas registradas.
                </div>
              ) : (
                <div className="space-y-1.5">
                  <AnimatePresence>
                    {temporadas.map(temp => (
                      <motion.div
                        layout
                        initial={{ opacity: 0, y: 5 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95 }}
                        key={temp}
                        className="flex items-center justify-between bg-white px-4 py-3 rounded-xl border border-neutral-100 shadow-sm group hover:border-neutral-300 transition-colors"
                      >
                        <span className="capitalize font-bold text-neutral-800 text-sm">{temp}</span>
                        <Button 
                          variant="ghost" 
                          size="icon" 
                          onClick={() => handleDeleteTemporada(temp)}
                          className="h-8 w-8 text-neutral-400 hover:text-red-500 hover:bg-red-50 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <Trash2 size={15} />
                        </Button>
                      </motion.div>
                    ))}
                  </AnimatePresence>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* PANEL DE TIPOS DE PRODUCTO */}
        <Card className="border border-neutral-100 shadow-lg rounded-[2rem] overflow-hidden bg-white flex flex-col">
          <CardHeader className="bg-neutral-50 border-b pb-4">
            <CardTitle className="text-xl flex items-center gap-2 font-bold text-neutral-900">
              <Tag size={20} className="text-neutral-500" />
              Tipos de Producto
            </CardTitle>
            <CardDescription className="text-neutral-500">
              Clasificaciones principales (ej: pantalon, calzado, bolso)
            </CardDescription>
          </CardHeader>
          <CardContent className="p-6 flex-1 flex flex-col space-y-4">
            <form onSubmit={handleAddTipo} className="flex gap-2">
              <Input 
                placeholder="Nuevo tipo (ej: vestido)" 
                value={newTipo}
                onChange={e => setNewTipo(e.target.value)}
                className="rounded-xl bg-neutral-50 border-neutral-200 focus-visible:ring-neutral-400 h-11"
                disabled={isAddingTipo}
              />
              <Button type="submit" disabled={isAddingTipo || !newTipo.trim()} className="rounded-xl h-11 bg-neutral-900 hover:bg-neutral-800 text-white shrink-0 font-semibold px-4">
                {isAddingTipo ? <Loader2 className="animate-spin" size={18} /> : <Plus size={18} />}
              </Button>
            </form>

            <div className="flex-1 min-h-[250px] border border-neutral-100 rounded-2xl overflow-y-auto max-h-[400px] p-2 bg-neutral-50/50">
              {loadingTipos ? (
                <div className="flex flex-col items-center justify-center py-16 text-neutral-400">
                  <Loader2 className="animate-spin mb-2" size={24} />
                  <span className="text-xs font-semibold">Cargando...</span>
                </div>
              ) : tipos.length === 0 ? (
                <div className="text-center py-16 text-neutral-400 text-sm">
                  No hay tipos registrados.
                </div>
              ) : (
                <div className="space-y-1.5">
                  <AnimatePresence>
                    {tipos.map(t => (
                      <motion.div
                        layout
                        initial={{ opacity: 0, y: 5 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95 }}
                        key={t}
                        className="flex items-center justify-between bg-white px-4 py-3 rounded-xl border border-neutral-100 shadow-sm group hover:border-neutral-300 transition-colors"
                      >
                        <span className="capitalize font-bold text-neutral-800 text-sm">{t}</span>
                        <Button 
                          variant="ghost" 
                          size="icon" 
                          onClick={() => handleDeleteTipo(t)}
                          className="h-8 w-8 text-neutral-400 hover:text-red-500 hover:bg-red-50 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <Trash2 size={15} />
                        </Button>
                      </motion.div>
                    ))}
                  </AnimatePresence>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
