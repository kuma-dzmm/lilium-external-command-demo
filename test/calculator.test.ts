import { describe, expect, it } from "vitest";
import { evaluateExpression, formatNumber } from "../src/calculator";

describe("evaluateExpression", () => {
  it("evaluates arithmetic with precedence and parentheses", () => {
    expect(evaluateExpression("1 + 2 * (3 + 4)")).toBe(15);
  });

  it("supports exponent, modulo, decimals, and unary operators", () => {
    expect(evaluateExpression("-2^2 + 10 % 4 + .5")).toBe(-1.5);
  });

  it("rejects non-arithmetic input", () => {
    expect(() => evaluateExpression("process.exit()")).toThrow();
  });

  it("rejects non-finite results", () => {
    expect(() => evaluateExpression("1 / 0")).toThrow("division by zero");
  });
});

describe("formatNumber", () => {
  it("trims floating point noise", () => {
    expect(formatNumber(evaluateExpression("0.1 + 0.2"))).toBe("0.3");
  });
});

