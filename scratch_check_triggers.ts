async function checkTriggers() {
  const PORT = 3000;
  const baseUrl = `http://localhost:${PORT}`;
  
  try {
    // 1. Wait a moment for server to start
    console.log("Waiting for server to start...");
    await new Promise(r => setTimeout(r, 2000));
    
    // 2. Fetch sections to get a valid one
    const secResp = await fetch(`${baseUrl}/api/almacen/secciones`);
    if (!secResp.ok) {
      console.error("Could not fetch sections from server");
      return;
    }
    const sections = await secResp.json() as any[];
    if (sections.length === 0) {
      console.error("No sections in database");
      return;
    }
    const validSecId = sections[0].id_zona_seccion;
    console.log("Using section ID:", validSecId);
    
    // 3. Create a level
    const testName = `trigger_test_${Date.now()}`;
    console.log("Creating level:", testName);
    
    const createResp = await fetch(`${baseUrl}/api/almacen/niveles`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nombre: testName,
        id_zona_seccion: validSecId,
        tags: { tipo_producto: "todos", genero: "todos", marca: "todos" }
      })
    });
    
    if (!createResp.ok) {
      console.error("Failed to create level:", await createResp.text());
      return;
    }
    
    const level = await createResp.json() as any;
    console.log("Level created:", level);
    
    // 4. Check if a box was created
    const cajasResp = await fetch(`${baseUrl}/api/cajas`);
    const cajas = await cajasResp.json() as any[];
    
    const matchingCaja = cajas.find(c => c.id_zona_nivel === level.id_zona_nivel);
    console.log("Matching caja in boxes list:", matchingCaja);
    
    // 5. Clean up
    console.log("Cleaning up level...");
    await fetch(`${baseUrl}/api/almacen/niveles/${level.id_zona_nivel}`, { method: "DELETE" });
    
    if (matchingCaja) {
      console.log("Cleaning up auto-created caja...");
      await fetch(`${baseUrl}/api/cajas/${matchingCaja.id_caja}`, { method: "DELETE" });
    }
    
    console.log("Test finished!");
  } catch (err: any) {
    console.error("Error during trigger check:", err.message);
  }
}

checkTriggers();
