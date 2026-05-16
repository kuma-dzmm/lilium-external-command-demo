const MAX_EXPRESSION_LENGTH = 160;

export class CalculatorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CalculatorError";
  }
}

export function evaluateExpression(input: string): number {
  const expression = input.trim();
  if (!expression) {
    throw new CalculatorError("missing expression");
  }
  if (expression.length > MAX_EXPRESSION_LENGTH) {
    throw new CalculatorError("expression is too long");
  }

  const parser = new Parser(expression);
  const value = parser.parseExpression();
  parser.skipWhitespace();
  if (!parser.isAtEnd()) {
    throw new CalculatorError(`unexpected token "${parser.peek()}"`);
  }
  assertFinite(value);
  return Object.is(value, -0) ? 0 : value;
}

export function formatNumber(value: number): string {
  assertFinite(value);
  const normalized = Object.is(value, -0) ? 0 : value;
  if (Number.isInteger(normalized)) {
    return normalized.toString();
  }
  return Number.parseFloat(normalized.toPrecision(12)).toString();
}

class Parser {
  private index = 0;

  constructor(private readonly input: string) {}

  parseExpression(): number {
    return this.parseAdditive();
  }

  isAtEnd(): boolean {
    return this.index >= this.input.length;
  }

  peek(): string {
    return this.input[this.index] ?? "";
  }

  skipWhitespace(): void {
    while (/\s/.test(this.peek())) {
      this.index += 1;
    }
  }

  private parseAdditive(): number {
    let value = this.parseMultiplicative();
    while (true) {
      this.skipWhitespace();
      if (this.consume("+")) {
        value += this.parseMultiplicative();
      } else if (this.consume("-")) {
        value -= this.parseMultiplicative();
      } else {
        return value;
      }
      assertFinite(value);
    }
  }

  private parseMultiplicative(): number {
    let value = this.parseUnary();
    while (true) {
      this.skipWhitespace();
      if (this.consume("*")) {
        value *= this.parseUnary();
      } else if (this.consume("/")) {
        const divisor = this.parseUnary();
        if (divisor === 0) {
          throw new CalculatorError("division by zero");
        }
        value /= divisor;
      } else if (this.consume("%")) {
        const divisor = this.parseUnary();
        if (divisor === 0) {
          throw new CalculatorError("modulo by zero");
        }
        value %= divisor;
      } else {
        return value;
      }
      assertFinite(value);
    }
  }

  private parseUnary(): number {
    this.skipWhitespace();
    if (this.consume("+")) {
      return this.parseUnary();
    }
    if (this.consume("-")) {
      return -this.parseUnary();
    }
    return this.parsePower();
  }

  private parsePower(): number {
    const base = this.parsePrimary();
    this.skipWhitespace();
    if (!this.consume("^")) {
      return base;
    }
    const exponent = this.parseUnary();
    const value = base ** exponent;
    assertFinite(value);
    return value;
  }

  private parsePrimary(): number {
    this.skipWhitespace();
    if (this.consume("(")) {
      const value = this.parseExpression();
      this.skipWhitespace();
      if (!this.consume(")")) {
        throw new CalculatorError("missing closing parenthesis");
      }
      return value;
    }
    return this.parseNumber();
  }

  private parseNumber(): number {
    this.skipWhitespace();
    const start = this.index;
    let sawDigit = false;

    while (isDigit(this.peek())) {
      sawDigit = true;
      this.index += 1;
    }

    if (this.consume(".")) {
      while (isDigit(this.peek())) {
        sawDigit = true;
        this.index += 1;
      }
    }

    if (!sawDigit) {
      throw new CalculatorError(`expected number at position ${this.index + 1}`);
    }

    if (this.peek() === "e" || this.peek() === "E") {
      const exponentStart = this.index;
      this.index += 1;
      if (this.peek() === "+" || this.peek() === "-") {
        this.index += 1;
      }
      const digitStart = this.index;
      while (isDigit(this.peek())) {
        this.index += 1;
      }
      if (digitStart === this.index) {
        this.index = exponentStart;
      }
    }

    const token = this.input.slice(start, this.index);
    const value = Number(token);
    assertFinite(value);
    return value;
  }

  private consume(expected: string): boolean {
    if (this.input[this.index] !== expected) {
      return false;
    }
    this.index += expected.length;
    return true;
  }
}

function isDigit(value: string): boolean {
  return value >= "0" && value <= "9";
}

function assertFinite(value: number): void {
  if (!Number.isFinite(value)) {
    throw new CalculatorError("result is not finite");
  }
}

