import React, { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { 
  Plus, Edit2, Trash2, Home, MapPin, 
  Loader2, Check, X, AlertTriangle 
} from "lucide-react";
import { toast } from "sonner";
import { motion, AnimatePresence } from "motion/react";

interface WarehouseZone {
  id_zona_almacen: number;
  nombre: string;
}

interface SectionZone {
  id_zona_seccion: number;
  nombre: string;
  id_zona_almacen: number;
  almacen_nombre: string;
}

export default function AlmacenView() {
  const [activeTab, setActiveTab] = useState<"zonas" | "secciones">("zonas");
  
  // Data lists
  const [zones, setZones] = useState<WarehouseZone[]>([]);
  const [sections, setSections] = useState<SectionZone[]>([]);
  
  // Loading states
  const [loadingZones, setLoadingZones] = useState(false);
  const [loadingSections, setLoadingSections] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  
  // Form states - Add Zone
  const [newZoneName, setNewZoneName] = useState("");
  
  // Form states - Add Section
  const [newSectionName, setNewSectionName] = useState("");
  const [selectedZoneId, setSelectedZoneId] = useState("");

  // Editing states
  const [editingZoneId, setEditingZoneId] = useState<number | null>(null);
  const [editingZoneName, setEditingZoneName] = useState("");
  
  const [editingSectionId, setEditingSectionId] = useState<number | null>(null);
  const [editingSectionName, setEditingSectionName] = useState("");
  const [editingSectionZoneId, setEditingSectionZoneId] = useState("");

  useEffect(() => {
    fetchZones();
    fetchSections();
  }, []);

  const fetchZones = async () => {
    setLoadingZones(true);
    try {
      const resp = await fetch("/api/almacen/zonas");
      if (resp.ok) {
        const data = await resp.json();
        setZones(data);
      } else {
        toast.error("Error al cargar zonas de almacén");
      }
    } catch (e) {
      toast.error("Error de conexión");
    } finally {
      setLoadingZones(false);
    }
  };

  const fetchSections = async () => {
    setLoadingSections(true);
    try {
      const resp = await fetch("/api/almacen/secciones");
      if (resp.ok) {
        const data = await resp.json();
        setSections(data);
      } else {
        toast.error("Error al cargar secciones de almacén");
      }
    } catch (e) {
      toast.error("Error de conexión");
    } finally {
      setLoadingSections(false);
    }
  };

  // Add Zone
  const handleAddZone = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newZoneName.trim()) return;
    setSubmitting(true);
    try {
      const resp = await fetch("/api/almacen/zonas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nombre: newZoneName })
      });
      if (resp.ok) {
        toast.success("Zona de almacén agregada");
        setNewZoneName("");
        fetchZones();
      } else {
        const err = await resp.json();
        toast.error(err.error || "No se pudo agregar la zona");
      }
    } catch (e) {
      toast.error("Error de conexión");
    } finally {
      setSubmitting(false);
    }
  };

  // Add Section
  const handleAddSection = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSectionName.trim() || !selectedZoneId) return;
    setSubmitting(true);
    try {
      const resp = await fetch("/api/almacen/secciones", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          nombre: newSectionName, 
          id_zona_almacen: parseInt(selectedZoneId) 
        })
      });
      if (resp.ok) {
        toast.success("Sección agregada y asociada");
        setNewSectionName("");
        setSelectedZoneId("");
        fetchSections();
      } else {
        const err = await resp.json();
        toast.error(err.error || "No se pudo agregar la sección");
      }
    } catch (e) {
      toast.error("Error de conexión");
    } finally {
      setSubmitting(false);
    }
  };

  // Delete Zone
  const handleDeleteZone = async (id: number) => {
    if (!window.confirm("¿Seguro que deseas eliminar esta zona? Se eliminarán todas las secciones asociadas.")) return;
    try {
      const resp = await fetch(`/api/almacen/zonas/${id}`, { method: "DELETE" });
      if (resp.ok) {
        toast.success("Zona eliminada con éxito");
        fetchZones();
        fetchSections(); // Sections will be cascades-deleted
      } else {
        toast.error("Error al eliminar la zona");
      }
    } catch (e) {
      toast.error("Error de conexión");
    }
  };

  // Delete Section
  const handleDeleteSection = async (id: number) => {
    if (!window.confirm("¿Seguro que deseas eliminar esta sección? Las cajas asociadas quedarán sin sección.")) return;
    try {
      const resp = await fetch(`/api/almacen/secciones/${id}`, { method: "DELETE" });
      if (resp.ok) {
        toast.success("Sección eliminada con éxito");
        fetchSections();
      } else {
        toast.error("Error al eliminar la sección");
      }
    } catch (e) {
      toast.error("Error de conexión");
    }
  };

  // Edit Zone Inline
  const startEditZone = (zone: WarehouseZone) => {
    setEditingZoneId(zone.id_zona_almacen);
    setEditingZoneName(zone.nombre);
  };

  const handleUpdateZone = async (id: number) => {
    if (!editingZoneName.trim()) return;
    try {
      const resp = await fetch(`/api/almacen/zonas/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nombre: editingZoneName })
      });
      if (resp.ok) {
        toast.success("Zona actualizada");
        setEditingZoneId(null);
        fetchZones();
        fetchSections(); // Update section tables which display zone names
      } else {
        toast.error("Error al actualizar la zona");
      }
    } catch (e) {
      toast.error("Error de conexión");
    }
  };

  // Edit Section Inline
  const startEditSection = (section: SectionZone) => {
    setEditingSectionId(section.id_zona_seccion);
    setEditingSectionName(section.nombre);
    setEditingSectionZoneId(section.id_zona_almacen.toString());
  };

  const handleUpdateSection = async (id: number) => {
    if (!editingSectionName.trim() || !editingSectionZoneId) return;
    try {
      const resp = await fetch(`/api/almacen/secciones/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          nombre: editingSectionName, 
          id_zona_almacen: parseInt(editingSectionZoneId) 
        })
      });
      if (resp.ok) {
        toast.success("Sección actualizada");
        setEditingSectionId(null);
        fetchSections();
      } else {
        toast.error("Error al actualizar la sección");
      }
    } catch (e) {
      toast.error("Error de conexión");
    }
  };

  return (
    <div className="space-y-6">
      {/* Tab Switcher & Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-5 rounded-3xl shadow-sm border border-neutral-100">
        <div>
          <h2 className="text-2xl md:text-3xl font-black tracking-tight uppercase text-neutral-900 leading-none">ALMACÉN</h2>
          <p className="text-xs md:text-sm text-neutral-500 font-medium mt-1">Administra la distribución física de cajas en el inventario</p>
        </div>
        
        <div className="flex bg-neutral-100 p-1.5 rounded-2xl border">
          <button
            onClick={() => setActiveTab("zonas")}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-black uppercase tracking-wider transition-all ${
              activeTab === "zonas" 
                ? "bg-white text-neutral-950 shadow-md" 
                : "text-neutral-500 hover:text-neutral-800"
            }`}
          >
            <Home size={14} />
            Zonas de Almacén
          </button>
          <button
            onClick={() => setActiveTab("secciones")}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-black uppercase tracking-wider transition-all ${
              activeTab === "secciones" 
                ? "bg-white text-neutral-950 shadow-md" 
                : "text-neutral-500 hover:text-neutral-800"
            }`}
          >
            <MapPin size={14} />
            Secciones
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        
        {/* Left Column: Form */}
        <div className="lg:col-span-4">
          <AnimatePresence mode="wait">
            {activeTab === "zonas" ? (
              <motion.div
                key="form-zonas"
                initial={{ opacity: 0, x: -15 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 15 }}
                transition={{ duration: 0.2 }}
              >
                <Card className="border border-neutral-100 shadow-lg rounded-[2rem] overflow-hidden bg-white">
                  <CardHeader className="pb-3 bg-neutral-50/50">
                    <CardTitle className="text-lg font-bold flex items-center gap-2">
                      <Plus size={18} className="text-neutral-500" />
                      Nueva Zona
                    </CardTitle>
                    <CardDescription>Crea un contenedor de ubicación principal</CardDescription>
                  </CardHeader>
                  <CardContent className="p-5">
                    <form onSubmit={handleAddZone} className="space-y-4">
                      <div className="space-y-1.5">
                        <label className="text-[10px] uppercase font-black tracking-wider text-neutral-400">Nombre de la Zona</label>
                        <Input 
                          placeholder="Ej: bodega superior, piso venta" 
                          value={newZoneName}
                          onChange={e => setNewZoneName(e.target.value)}
                          className="rounded-xl h-11 bg-neutral-50 border-neutral-200"
                        />
                      </div>
                      <Button 
                        type="submit" 
                        disabled={submitting || !newZoneName.trim()}
                        className="w-full rounded-xl h-11 bg-neutral-900 hover:bg-neutral-800 text-white font-bold"
                      >
                        {submitting ? <Loader2 className="animate-spin" size={18} /> : "Crear Zona"}
                      </Button>
                    </form>
                  </CardContent>
                </Card>
              </motion.div>
            ) : (
              <motion.div
                key="form-secciones"
                initial={{ opacity: 0, x: -15 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 15 }}
                transition={{ duration: 0.2 }}
              >
                <Card className="border border-neutral-100 shadow-lg rounded-[2rem] overflow-hidden bg-white">
                  <CardHeader className="pb-3 bg-neutral-50/50">
                    <CardTitle className="text-lg font-bold flex items-center gap-2">
                      <Plus size={18} className="text-neutral-500" />
                      Nueva Sección
                    </CardTitle>
                    <CardDescription>Crea y asocia una sección física a una zona principal</CardDescription>
                  </CardHeader>
                  <CardContent className="p-5">
                    <form onSubmit={handleAddSection} className="space-y-4">
                      <div className="space-y-1.5">
                        <label className="text-[10px] uppercase font-black tracking-wider text-neutral-400">Nombre de Sección</label>
                        <Input 
                          placeholder="Ej: estante a1, pasillo 4" 
                          value={newSectionName}
                          onChange={e => setNewSectionName(e.target.value)}
                          className="rounded-xl h-11 bg-neutral-50 border-neutral-200"
                        />
                      </div>

                      <div className="space-y-1.5">
                        <label className="text-[10px] uppercase font-black tracking-wider text-neutral-400">Zona Almacén Asociada</label>
                        <select
                          value={selectedZoneId}
                          onChange={e => setSelectedZoneId(e.target.value)}
                          className="w-full rounded-xl h-11 px-3 bg-neutral-50 border border-neutral-200 text-sm font-semibold outline-none focus:ring-1 focus:ring-neutral-900"
                        >
                          <option value="">Selecciona una zona...</option>
                          {zones.map(z => (
                            <option key={z.id_zona_almacen} value={z.id_zona_almacen}>
                              {z.nombre.toUpperCase()}
                            </option>
                          ))}
                        </select>
                      </div>

                      <Button 
                        type="submit" 
                        disabled={submitting || !newSectionName.trim() || !selectedZoneId}
                        className="w-full rounded-xl h-11 bg-neutral-900 hover:bg-neutral-800 text-white font-bold"
                      >
                        {submitting ? <Loader2 className="animate-spin" size={18} /> : "Crear Sección"}
                      </Button>
                    </form>
                  </CardContent>
                </Card>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Right Column: Tables */}
        <div className="lg:col-span-8">
          <Card className="border border-neutral-100 shadow-xl rounded-[2rem] overflow-hidden bg-white">
            <CardHeader className="bg-neutral-50/40 pb-3 border-b">
              <CardTitle className="text-lg font-bold">Conceptos Registrados</CardTitle>
              <CardDescription>
                {activeTab === "zonas" ? "Zonas principales de almacenamiento" : "Secciones y pasillos asignados a almacenes"}
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              
              {/* ZONAS TABLE */}
              {activeTab === "zonas" && (
                loadingZones ? (
                  <div className="flex justify-center items-center py-16 text-neutral-400">
                    <Loader2 className="animate-spin" size={24} />
                  </div>
                ) : zones.length === 0 ? (
                  <div className="text-center py-16 text-neutral-400 flex flex-col items-center">
                    <Home size={36} strokeWidth={1} className="opacity-40 mb-2" />
                    <p className="text-sm font-bold">No hay zonas de almacén registradas</p>
                  </div>
                ) : (
                  <Table>
                    <TableHeader className="bg-neutral-50/20">
                      <TableRow>
                        <TableHead>Nombre</TableHead>
                        <TableHead className="text-right w-[150px]">Acciones</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {zones.map((zone) => (
                        <TableRow key={zone.id_zona_almacen}>
                          <TableCell className="font-extrabold text-sm uppercase">
                            {editingZoneId === zone.id_zona_almacen ? (
                              <Input 
                                value={editingZoneName}
                                onChange={e => setEditingZoneName(e.target.value)}
                                className="h-8 max-w-[250px] uppercase text-xs font-bold"
                              />
                            ) : (
                              zone.nombre
                            )}
                          </TableCell>
                          <TableCell className="text-right pr-6">
                            <div className="flex justify-end gap-1.5">
                              {editingZoneId === zone.id_zona_almacen ? (
                                <>
                                  <Button 
                                    size="icon" 
                                    variant="ghost" 
                                    onClick={() => handleUpdateZone(zone.id_zona_almacen)}
                                    className="h-8 w-8 text-green-600 hover:bg-green-50 rounded-lg"
                                  >
                                    <Check size={14} />
                                  </Button>
                                  <Button 
                                    size="icon" 
                                    variant="ghost" 
                                    onClick={() => setEditingZoneId(null)}
                                    className="h-8 w-8 text-red-500 hover:bg-red-50 rounded-lg"
                                  >
                                    <X size={14} />
                                  </Button>
                                </>
                              ) : (
                                <>
                                  <Button 
                                    size="icon" 
                                    variant="ghost" 
                                    onClick={() => startEditZone(zone)}
                                    className="h-8 w-8 text-neutral-400 hover:text-neutral-800 hover:bg-neutral-100 rounded-lg"
                                  >
                                    <Edit2 size={14} />
                                  </Button>
                                  <Button 
                                    size="icon" 
                                    variant="ghost" 
                                    onClick={() => handleDeleteZone(zone.id_zona_almacen)}
                                    className="h-8 w-8 text-neutral-400 hover:text-red-500 hover:bg-red-50 rounded-lg"
                                  >
                                    <Trash2 size={14} />
                                  </Button>
                                </>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )
              )}

              {/* SECCIONES TABLE */}
              {activeTab === "secciones" && (
                loadingSections ? (
                  <div className="flex justify-center items-center py-16 text-neutral-400">
                    <Loader2 className="animate-spin" size={24} />
                  </div>
                ) : sections.length === 0 ? (
                  <div className="text-center py-16 text-neutral-400 flex flex-col items-center">
                    <MapPin size={36} strokeWidth={1} className="opacity-40 mb-2" />
                    <p className="text-sm font-bold">No hay secciones registradas</p>
                  </div>
                ) : (
                  <Table>
                    <TableHeader className="bg-neutral-50/20">
                      <TableRow>
                        <TableHead>Nombre Sección</TableHead>
                        <TableHead>Almacén Principal</TableHead>
                        <TableHead className="text-right w-[150px]">Acciones</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {sections.map((section) => (
                        <TableRow key={section.id_zona_seccion}>
                          <TableCell className="font-extrabold text-sm uppercase">
                            {editingSectionId === section.id_zona_seccion ? (
                              <Input 
                                value={editingSectionName}
                                onChange={e => setEditingSectionName(e.target.value)}
                                className="h-8 max-w-[200px] uppercase text-xs font-bold"
                              />
                            ) : (
                              section.nombre
                            )}
                          </TableCell>
                          
                          <TableCell className="font-semibold text-xs uppercase text-neutral-500">
                            {editingSectionId === section.id_zona_seccion ? (
                              <select
                                value={editingSectionZoneId}
                                onChange={e => setEditingSectionZoneId(e.target.value)}
                                className="h-8 px-2 bg-neutral-50 border rounded-lg text-xs outline-none"
                              >
                                {zones.map(z => (
                                  <option key={z.id_zona_almacen} value={z.id_zona_almacen}>
                                    {z.nombre.toUpperCase()}
                                  </option>
                                ))}
                              </select>
                            ) : (
                              section.almacen_nombre
                            )}
                          </TableCell>

                          <TableCell className="text-right pr-6">
                            <div className="flex justify-end gap-1.5">
                              {editingSectionId === section.id_zona_seccion ? (
                                <>
                                  <Button 
                                    size="icon" 
                                    variant="ghost" 
                                    onClick={() => handleUpdateSection(section.id_zona_seccion)}
                                    className="h-8 w-8 text-green-600 hover:bg-green-50 rounded-lg"
                                  >
                                    <Check size={14} />
                                  </Button>
                                  <Button 
                                    size="icon" 
                                    variant="ghost" 
                                    onClick={() => setEditingSectionId(null)}
                                    className="h-8 w-8 text-red-500 hover:bg-red-50 rounded-lg"
                                  >
                                    <X size={14} />
                                  </Button>
                                </>
                              ) : (
                                <>
                                  <Button 
                                    size="icon" 
                                    variant="ghost" 
                                    onClick={() => startEditSection(section)}
                                    className="h-8 w-8 text-neutral-400 hover:text-neutral-800 hover:bg-neutral-100 rounded-lg"
                                  >
                                    <Edit2 size={14} />
                                  </Button>
                                  <Button 
                                    size="icon" 
                                    variant="ghost" 
                                    onClick={() => handleDeleteSection(section.id_zona_seccion)}
                                    className="h-8 w-8 text-neutral-400 hover:text-red-500 hover:bg-red-50 rounded-lg"
                                  >
                                    <Trash2 size={14} />
                                  </Button>
                                </>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )
              )}

            </CardContent>
          </Card>
        </div>

      </div>
    </div>
  );
}
