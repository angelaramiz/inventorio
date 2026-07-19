import { describe, it, expect } from "vitest";
import { cn } from "../../lib/utils";

describe("cn()", () => {
  it("combina class names simples", () => {
    expect(cn("foo", "bar")).toBe("foo bar");
  });

  it("filtra valores falsy", () => {
    expect(cn("foo", false, null, undefined, 0, "bar")).toBe("foo bar");
  });

  it("mergea clases de tailwind correctamente", () => {
    expect(cn("px-4", "px-2")).toBe("px-2");
    expect(cn("text-red-500", "text-blue-500")).toBe("text-blue-500");
  });

  it("acepta objetos condicionales", () => {
    expect(cn("base", { active: true, disabled: false })).toBe("base active");
  });

  it("maneja strings vacíos", () => {
    expect(cn("", "foo", " ", "bar")).toBe("foo bar");
  });
});
