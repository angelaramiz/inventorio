import React, { useState, useEffect } from "react";
import { Toaster } from "@/components/ui/sonner";
import { 
  Boxes, Package, Scan, LayoutDashboard, Tag, Warehouse, 
  Network, ShoppingCart, ShieldCheck, ArrowLeftRight
} from "lucide-react";
import InventoryView from "./components/InventoryView";
import CajasView from "./components/CajasView";
import ScannerView from "./components/ScannerView";
import ConceptosView from "./components/ConceptosView";
import AlmacenView from "./components/AlmacenView";
import ConsultaDashboard from "./components/ConsultaDashboard";
import ImageLightbox from "./components/ImageLightbox";
import HierarchyView from "./components/HierarchyView";
import POSView from "./components/POSView";
import InventoryControlView from "./components/InventoryControlView";
import { motion, AnimatePresence } from "motion/react";

export default function App() {
  const [currentPath, setCurrentPath] = useState(() => window.location.pathname.toLowerCase());
  const [activeTab, setActiveTab] = useState("scanner");

  useEffect(() => {
    const handleLocationChange = () => {
      setCurrentPath(window.location.pathname.toLowerCase());
    };
    window.addEventListener("popstate", handleLocationChange);
    return () => window.removeEventListener("popstate", handleLocationChange);
  }, []);

  const navigateTo = (path: string) => {
    window.history.pushState({}, "", path);
    setCurrentPath(path.toLowerCase());
  };

  // 1. Dashboard / Consulta View (matches /dashboard or /consulta)
  if (currentPath === "/dashboard" || currentPath === "/dashboard/" || currentPath === "/consulta" || currentPath === "/consulta/") {
    return (
      <>
        <ConsultaDashboard />
        <ImageLightbox />
        <Toaster position="top-center" expand={true} richColors />
      </>
    );
  }

  // 2. Dedicated POS View (matches /pos)
  if (currentPath === "/pos" || currentPath === "/pos/") {
    return (
      <div className="min-h-screen bg-neutral-50 text-neutral-900 font-sans pb-6">
        <header className="sticky top-0 z-50 w-full border-b bg-white/80 backdrop-blur-md">
          <div className="container mx-auto flex h-16 items-center justify-between px-4">
            <div className="flex items-center gap-2 font-bold text-xl tracking-tight">
              <div className="bg-emerald-600 p-1.5 rounded-lg text-white shadow-sm shadow-emerald-200">
                <ShoppingCart size={22} />
              </div>
              <span className="font-extrabold tracking-tight">POS VENTAS <span className="text-emerald-500 font-medium text-sm ml-1">| VENDEDOR</span></span>
            </div>
            <button 
              onClick={() => navigateTo("/admin")} 
              className="text-xs font-bold text-neutral-600 hover:text-neutral-950 flex items-center gap-1.5 bg-neutral-100 hover:bg-neutral-200 px-3.5 py-2 rounded-xl border border-neutral-200 transition-all duration-200 shadow-sm"
            >
              <ArrowLeftRight size={14} />
              Panel Admin
            </button>
          </div>
        </header>
        <main className="container mx-auto p-4 md:p-6 lg:p-8">
          <POSView />
        </main>
        <ImageLightbox />
        <Toaster position="top-center" expand={true} richColors />
      </div>
    );
  }

  // 3. Dedicated Physical Count View (matches /conteo_inv)
  if (currentPath === "/conteo_inv" || currentPath === "/conteo_inv/") {
    return (
      <div className="min-h-screen bg-neutral-50 text-neutral-900 font-sans pb-6">
        <header className="sticky top-0 z-50 w-full border-b bg-white/80 backdrop-blur-md">
          <div className="container mx-auto flex h-16 items-center justify-between px-4">
            <div className="flex items-center gap-2 font-bold text-xl tracking-tight">
              <div className="bg-blue-600 p-1.5 rounded-lg text-white shadow-sm shadow-blue-200">
                <Scan size={22} />
              </div>
              <span className="font-extrabold tracking-tight">CONTEO FÍSICO <span className="text-blue-500 font-medium text-sm ml-1">| OPERADOR</span></span>
            </div>
            <button 
              onClick={() => navigateTo("/admin")} 
              className="text-xs font-bold text-neutral-600 hover:text-neutral-950 flex items-center gap-1.5 bg-neutral-100 hover:bg-neutral-200 px-3.5 py-2 rounded-xl border border-neutral-200 transition-all duration-200 shadow-sm"
            >
              <ArrowLeftRight size={14} />
              Panel Admin
            </button>
          </div>
        </header>
        <main className="container mx-auto p-4 md:p-6 lg:p-8">
          <InventoryControlView userRole="operator" />
        </main>
        <ImageLightbox />
        <Toaster position="top-center" expand={true} richColors />
      </div>
    );
  }

  // 4. Default Admin Panel Layout (/admin or root /)
  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-900 font-sans pb-24 md:pb-6">
      <header className="sticky top-0 z-50 w-full border-b bg-white/80 backdrop-blur-md">
        <div className="container mx-auto flex h-16 items-center justify-between px-4">
          <div className="flex items-center gap-2 font-bold text-xl tracking-tight">
            <div className="bg-neutral-950 p-1.5 rounded-lg text-white">
              <Boxes size={22} />
            </div>
            <span className="font-extrabold tracking-tight">INVENTARIO <span className="text-neutral-400 font-medium text-sm ml-1">| ADMIN</span></span>
          </div>

          {/* Dedicated Consoles Quick Access Navigation */}
          <div className="flex items-center gap-1 bg-neutral-100 px-2 py-1.5 rounded-2xl border border-neutral-200 shadow-inner">
            <button 
              onClick={() => navigateTo("/pos")}
              className="text-[10px] font-black uppercase text-neutral-500 hover:text-emerald-700 hover:bg-emerald-50 px-2.5 py-1.5 rounded-xl transition-all duration-200 flex items-center gap-1"
            >
              <ShoppingCart size={12} />
              Piso Venta (POS)
            </button>
            <button 
              onClick={() => navigateTo("/conteo_inv")}
              className="text-[10px] font-black uppercase text-neutral-500 hover:text-blue-700 hover:bg-blue-50 px-2.5 py-1.5 rounded-xl transition-all duration-200 flex items-center gap-1"
            >
              <Scan size={12} />
              Conteo Operario
            </button>
          </div>
          
          <nav className="hidden xl:flex items-center gap-1 bg-neutral-100 p-1 rounded-xl">
            <TabButton 
              active={activeTab === "scanner"} 
              onClick={() => setActiveTab("scanner")}
              icon={<Scan size={15} />}
              label="Escanear"
            />
            <TabButton 
              active={activeTab === "inventory"} 
              onClick={() => setActiveTab("inventory")}
              icon={<Package size={15} />}
              label="Productos"
            />
            <TabButton 
              active={activeTab === "boxes"} 
              onClick={() => setActiveTab("boxes")}
              icon={<LayoutDashboard size={15} />}
              label="Cajas"
            />
            
            <TabButton 
              active={activeTab === "inventory_control"} 
              onClick={() => setActiveTab("inventory_control")}
              icon={<ShieldCheck size={15} />}
              label="Control Inventario"
            />

            <TabButton 
              active={activeTab === "hierarchy"} 
              onClick={() => setActiveTab("hierarchy")}
              icon={<Network size={15} />}
              label="Jerarquía"
            />
            
            <TabButton 
              active={activeTab === "concepts"} 
              onClick={() => setActiveTab("concepts")}
              icon={<Tag size={15} />}
              label="Conceptos"
            />
            <TabButton 
              active={activeTab === "almacen"} 
              onClick={() => setActiveTab("almacen")}
              icon={<Warehouse size={15} />}
              label="Almacén"
            />
          </nav>
        </div>
      </header>

      {/* Main navigation menu for standard desktop sizes (flexible grid) */}
      <div className="hidden md:flex xl:hidden container mx-auto px-4 pt-4 justify-center">
        <nav className="flex items-center flex-wrap gap-1 bg-neutral-100 p-1 rounded-xl">
          <TabButton 
            active={activeTab === "scanner"} 
            onClick={() => setActiveTab("scanner")}
            icon={<Scan size={15} />}
            label="Escanear"
          />
          <TabButton 
            active={activeTab === "inventory"} 
            onClick={() => setActiveTab("inventory")}
            icon={<Package size={15} />}
            label="Productos"
          />
          <TabButton 
            active={activeTab === "boxes"} 
            onClick={() => setActiveTab("boxes")}
            icon={<LayoutDashboard size={15} />}
            label="Cajas"
          />
          
          <TabButton 
            active={activeTab === "inventory_control"} 
            onClick={() => setActiveTab("inventory_control")}
            icon={<ShieldCheck size={15} />}
            label="Control"
          />

          <TabButton 
            active={activeTab === "hierarchy"} 
            onClick={() => setActiveTab("hierarchy")}
            icon={<Network size={15} />}
            label="Jerarquía"
          />

          <TabButton 
            active={activeTab === "concepts"} 
            onClick={() => setActiveTab("concepts")}
            icon={<Tag size={15} />}
            label="Conceptos"
          />
          <TabButton 
            active={activeTab === "almacen"} 
            onClick={() => setActiveTab("almacen")}
            icon={<Warehouse size={15} />}
            label="Almacén"
          />
        </nav>
      </div>

      <main className="container mx-auto p-4 md:p-6 lg:p-8">
        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.2 }}
          >
            {activeTab === "scanner" && <ScannerView />}
            {activeTab === "inventory" && <InventoryView />}
            {activeTab === "boxes" && <CajasView />}
            {activeTab === "concepts" && <ConceptosView />}
            {activeTab === "almacen" && <AlmacenView />}
            
            {/* NEW VIEWS */}
            {activeTab === "hierarchy" && <HierarchyView />}
            {activeTab === "inventory_control" && (
              <InventoryControlView userRole="manager" />
            )}
          </motion.div>
        </AnimatePresence>
      </main>

      {/* Mobile Navigation */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t flex justify-around p-3 z-50 overflow-x-auto">
        <MobileNavButton 
          active={activeTab === "scanner"} 
          onClick={() => setActiveTab("scanner")}
          icon={<Scan size={20} />}
          label="Scan"
        />
        <MobileNavButton 
          active={activeTab === "inventory"} 
          onClick={() => setActiveTab("inventory")}
          icon={<Package size={20} />}
          label="Stock"
        />
        <MobileNavButton 
          active={activeTab === "boxes"} 
          onClick={() => setActiveTab("boxes")}
          icon={<LayoutDashboard size={20} />}
          label="Cajas"
        />
        
        <MobileNavButton 
          active={activeTab === "inventory_control"} 
          onClick={() => setActiveTab("inventory_control")}
          icon={<ShieldCheck size={20} />}
          label="Conteo"
        />

        <MobileNavButton 
          active={activeTab === "hierarchy"} 
          onClick={() => setActiveTab("hierarchy")}
          icon={<Network size={20} />}
          label="Árbol"
        />

        <MobileNavButton 
          active={activeTab === "concepts"} 
          onClick={() => setActiveTab("concepts")}
          icon={<Tag size={20} />}
          label="Conceptos"
        />
      </nav>

      <ImageLightbox />
      <Toaster position="top-center" expand={true} richColors />
    </div>
  );
}

function TabButton({ active, onClick, icon, label }: { active: boolean, onClick: () => void, icon: React.ReactNode, label: string }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-all duration-200 font-bold text-xs ${
        active 
          ? "bg-white text-neutral-900 shadow-sm" 
          : "text-neutral-500 hover:text-neutral-900 hover:bg-white/50"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

function MobileNavButton({ active, onClick, icon, label }: { active: boolean, onClick: () => void, icon: React.ReactNode, label: string }) {
  return (
    <button
      onClick={onClick}
      className={`flex flex-col items-center gap-1 transition-colors px-2 shrink-0 ${
        active ? "text-neutral-900" : "text-neutral-400"
      }`}
    >
      {icon}
      <span className="text-[8px] font-black uppercase tracking-wider">{label}</span>
    </button>
  );
}
