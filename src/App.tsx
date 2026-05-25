import React, { useState, useEffect } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Toaster } from "@/components/ui/sonner";
import { toast } from "sonner";
import { 
  Boxes, Package, Scan, LayoutDashboard, Tag, Warehouse, 
  Network, ShoppingCart, ShieldCheck, UserCheck 
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
  const [activeTab, setActiveTab] = useState("scanner");
  const [isDashboard, setIsDashboard] = useState(false);
  
  // Simulated profile state for testing Phase 2 and Phase 3 flows
  const [simulatedRole, setSimulatedRole] = useState<"operator" | "vendedor" | "manager">("manager");

  useEffect(() => {
    const path = window.location.pathname;
    if (path === "/dashboard" || path === "/consulta") {
      setIsDashboard(true);
    }
  }, []);

  if (isDashboard) {
    return (
      <>
        <ConsultaDashboard />
        <ImageLightbox />
        <Toaster position="top-center" expand={true} richColors />
      </>
    );
  }

  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-900 font-sans pb-24 md:pb-6">
      <header className="sticky top-0 z-50 w-full border-b bg-white/80 backdrop-blur-md">
        <div className="container mx-auto flex h-16 items-center justify-between px-4">
          <div className="flex items-center gap-2 font-bold text-xl tracking-tight">
            <div className="bg-neutral-900 p-1.5 rounded-lg text-white">
              <Boxes size={24} />
            </div>
            <span>INVENTARIO <span className="text-neutral-400 font-normal">| ALPHA</span></span>
          </div>

          {/* SIMULATED ROLE DROPDOWN */}
          <div className="flex items-center gap-2 bg-neutral-100 px-3 py-1.5 rounded-2xl border border-neutral-200">
            <UserCheck size={16} className="text-neutral-500" />
            <span className="text-[10px] font-black uppercase text-neutral-400 hidden sm:inline">Rol:</span>
            <select
              value={simulatedRole}
              onChange={(e) => {
                const role = e.target.value as any;
                setSimulatedRole(role);
                // Redirect tab if not authorized for active role
                if (role === "vendedor") setActiveTab("pos");
                else if (role === "operator") setActiveTab("inventory_control");
                else setActiveTab("scanner");
                toastRoleChange(role);
              }}
              className="bg-transparent border-none text-xs font-black text-neutral-800 outline-none cursor-pointer"
            >
              <option value="manager">Gerente / Administrador</option>
              <option value="operator">Operador / Conteo</option>
              <option value="vendedor">Vendedor / POS</option>
            </select>
          </div>
          
          <nav className="hidden xl:flex items-center gap-1 bg-neutral-100 p-1 rounded-xl">
            <TabButton 
              active={activeTab === "scanner"} 
              onClick={() => setActiveTab("scanner")}
              icon={<Scan size={16} />}
              label="Escanear"
            />
            <TabButton 
              active={activeTab === "inventory"} 
              onClick={() => setActiveTab("inventory")}
              icon={<Package size={16} />}
              label="Productos"
            />
            <TabButton 
              active={activeTab === "boxes"} 
              onClick={() => setActiveTab("boxes")}
              icon={<LayoutDashboard size={16} />}
              label="Cajas"
            />
            
            {/* CONDITIONAL TABS BASED ON ROLE */}
            {simulatedRole === "vendedor" && (
              <TabButton 
                active={activeTab === "pos"} 
                onClick={() => setActiveTab("pos")}
                icon={<ShoppingCart size={16} />}
                label="POS (Ventas)"
              />
            )}
            
            {(simulatedRole === "operator" || simulatedRole === "manager") && (
              <TabButton 
                active={activeTab === "inventory_control"} 
                onClick={() => setActiveTab("inventory_control")}
                icon={<ShieldCheck size={16} />}
                label="Control Inventario"
              />
            )}

            {simulatedRole === "manager" && (
              <TabButton 
                active={activeTab === "hierarchy"} 
                onClick={() => setActiveTab("hierarchy")}
                icon={<Network size={16} />}
                label="Jerarquía"
              />
            )}
            
            <TabButton 
              active={activeTab === "concepts"} 
              onClick={() => setActiveTab("concepts")}
              icon={<Tag size={16} />}
              label="Conceptos"
            />
            <TabButton 
              active={activeTab === "almacen"} 
              onClick={() => setActiveTab("almacen")}
              icon={<Warehouse size={16} />}
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
            icon={<Scan size={16} />}
            label="Escanear"
          />
          <TabButton 
            active={activeTab === "inventory"} 
            onClick={() => setActiveTab("inventory")}
            icon={<Package size={16} />}
            label="Productos"
          />
          <TabButton 
            active={activeTab === "boxes"} 
            onClick={() => setActiveTab("boxes")}
            icon={<LayoutDashboard size={16} />}
            label="Cajas"
          />
          
          {simulatedRole === "vendedor" && (
            <TabButton 
              active={activeTab === "pos"} 
              onClick={() => setActiveTab("pos")}
              icon={<ShoppingCart size={16} />}
              label="POS"
            />
          )}
          
          {(simulatedRole === "operator" || simulatedRole === "manager") && (
            <TabButton 
              active={activeTab === "inventory_control"} 
              onClick={() => setActiveTab("inventory_control")}
              icon={<ShieldCheck size={16} />}
              label="Control"
            />
          )}

          {simulatedRole === "manager" && (
            <TabButton 
              active={activeTab === "hierarchy"} 
              onClick={() => setActiveTab("hierarchy")}
              icon={<Network size={16} />}
              label="Jerarquía"
            />
          )}

          <TabButton 
            active={activeTab === "concepts"} 
            onClick={() => setActiveTab("concepts")}
            icon={<Tag size={16} />}
            label="Conceptos"
          />
          <TabButton 
            active={activeTab === "almacen"} 
            onClick={() => setActiveTab("almacen")}
            icon={<Warehouse size={16} />}
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
            {activeTab === "pos" && <POSView />}
            {activeTab === "inventory_control" && (
              <InventoryControlView userRole={simulatedRole === "manager" ? "manager" : "operator"} />
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

        {simulatedRole === "vendedor" && (
          <MobileNavButton 
            active={activeTab === "pos"} 
            onClick={() => setActiveTab("pos")}
            icon={<ShoppingCart size={20} />}
            label="POS"
          />
        )}
        
        {(simulatedRole === "operator" || simulatedRole === "manager") && (
          <MobileNavButton 
            active={activeTab === "inventory_control"} 
            onClick={() => setActiveTab("inventory_control")}
            icon={<ShieldCheck size={20} />}
            label="Conteo"
          />
        )}

        {simulatedRole === "manager" && (
          <MobileNavButton 
            active={activeTab === "hierarchy"} 
            onClick={() => setActiveTab("hierarchy")}
            icon={<Network size={20} />}
            label="Árbol"
          />
        )}

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

function toastRoleChange(role: string) {
  const label = role === "vendedor" ? "Vendedor POS" : role === "operator" ? "Operador de Conteo" : "Gerente / Administrador";
  toast.success(`Rol cambiado a: ${label}. Se habilitaron nuevas pestañas correspondientes.`);
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


