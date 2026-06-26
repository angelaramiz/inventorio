import React, { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Trash2, Plus, Settings, Loader2 } from "lucide-react";
import { toast } from "sonner";

export default function SettingsView() {
  const [sources, setSources] = useState<string[]>([]);
  const [newSource, setNewSource] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchSettings();
  }, []);

  const fetchSettings = async () => {
    setLoading(true);
    try {
      const resp = await fetch("/api/settings/image-sources");
      if (resp.ok) {
        const data = await resp.json();
        setSources(data);
      }
    } catch (err) {
      toast.error("Error al cargar configuración de fuentes");
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async (updatedSources: string[]) => {
    setSaving(true);
    try {
      const resp = await fetch("/api/settings/image-sources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sources: updatedSources })
      });
      if (resp.ok) {
        toast.success("Ajustes guardados correctamente");
        setSources(updatedSources);
      } else {
        toast.error("Error al guardar ajustes");
      }
    } catch (err) {
      toast.error("Error de conexión");
    } finally {
      setSaving(false);
    }
  };

  const handleAddSource = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSource.trim()) return;
    if (!newSource.includes("{q}")) {
      toast.warning("La URL debe contener '{q}' para reemplazar por la consulta de búsqueda");
      return;
    }
    const updated = [...sources, newSource.trim()];
    setNewSource("");
    handleSave(updated);
  };

  const handleDeleteSource = (index: number) => {
    const updated = sources.filter((_, i) => i !== index);
    handleSave(updated);
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-extrabold tracking-tight">Ajustes</h1>
        <p className="text-neutral-500">Configuración global del sistema de inventario y optimización de captura.</p>
      </div>

      <Card className="rounded-2xl border border-neutral-200/80 shadow-sm bg-white overflow-hidden">
        <CardHeader className="border-b border-neutral-100 bg-neutral-50/50 p-6">
          <div className="flex items-center gap-3">
            <div className="bg-neutral-900 p-2 rounded-xl text-white">
              <Settings size={20} />
            </div>
            <div>
              <CardTitle className="text-lg font-bold">Búsqueda de Imágenes de Productos</CardTitle>
              <CardDescription>
                Define fuentes personalizadas para la extracción automática de imágenes en segundo plano.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-6 space-y-6">
          <form onSubmit={handleAddSource} className="flex gap-2">
            <Input
              value={newSource}
              onChange={(e) => setNewSource(e.target.value)}
              placeholder="Ej: https://www.zara.com/search?q={q}"
              className="rounded-xl flex-1 border-neutral-200 focus-visible:ring-neutral-950"
              disabled={loading || saving}
            />
            <Button type="submit" disabled={loading || saving} className="rounded-xl bg-neutral-950 hover:bg-neutral-900 text-white px-5 font-medium">
              <Plus size={18} className="mr-1.5" /> Agregar
            </Button>
          </form>

          {loading ? (
            <div className="flex items-center justify-center py-10 text-neutral-400">
              <Loader2 className="animate-spin mr-2" /> Cargando fuentes...
            </div>
          ) : (
            <div className="border border-neutral-100 rounded-xl overflow-hidden divide-y divide-neutral-100">
              {sources.length === 0 ? (
                <div className="p-8 text-center text-sm text-neutral-400 bg-neutral-50/30">
                  No hay fuentes personalizadas configuradas. Se usará el buscador DuckDuckGo por defecto.
                </div>
              ) : (
                sources.map((source, index) => (
                  <div key={index} className="flex items-center justify-between p-4 bg-white hover:bg-neutral-50/30 transition-colors">
                    <span className="font-mono text-sm text-neutral-600 truncate mr-4">{source}</span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => handleDeleteSource(index)}
                      className="text-neutral-400 hover:text-red-600 hover:bg-red-50 rounded-lg h-9 w-9"
                    >
                      <Trash2 size={16} />
                    </Button>
                  </div>
                ))
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
