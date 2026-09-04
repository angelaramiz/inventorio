import { describe, it, expect } from "vitest";
import request from "supertest";

// NOTE: The server doesn't export the Express app yet.
// To enable API testing, add `export { app }` to server.ts before `app.listen()`.
//
// Then uncomment the test below:
//
// import { app } from "./server";
//
// describe("API Health", () => {
//   it("GET /api/health returns 200", async () => {
//     const res = await request(app).get("/api/health");
//     expect(res.status).toBe(200);
//   });
// });
//
// TODO:
// - Extraer `app` de server.ts (agregar `export { app }`)
// - Agregar tests para rutas críticas:
//   - GET /api/productos
//   - POST /api/ocr/save-correction (ground truth usuario)
//   - GET /api/ocr/training-stats
//   - GET /api/cajas
//   - CRUD jerarquía (/api/hierarchy)

describe("Backend API", () => {
  it("placeholder: refactor server.ts para exportar app", () => {
    expect(true).toBe(true);
  });
});
