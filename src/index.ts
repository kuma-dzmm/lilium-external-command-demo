import { CalculatorError, evaluateExpression, formatNumber } from "./calculator";
import {
  contentDigestHeader,
  createLiliumSignatureHeaders,
  verifyLiliumRequestSignature,
} from "./signing";

const API_VERSION = "lilium.external-command.v1";
const DEFAULT_CONFIG_ID = "calc";
const CALC_COMMAND_INVOKE_PATH =
  "/api/lilium/external-commands/v1/calc/invoke";
const MAX_BODY_BYTES = 64 * 1024;

type RuntimeEnv = Env & {
  LILIUM_COMMAND_CONFIG_ID?: string;
  LILIUM_SHARED_SECRET?: string;
};

type InvokeEnvelope = {
  api_version?: unknown;
  type?: unknown;
  invocation_id?: unknown;
  command?: {
    config_id?: unknown;
    name?: unknown;
    matched_name?: unknown;
    args?: unknown;
  };
};

type Effect = {
  type: "reply";
  text: string;
  markdown: boolean;
};

export default {
  async fetch(request: Request, env: RuntimeEnv): Promise<Response> {
    return handleRequest(request, env);
  },
} satisfies ExportedHandler<RuntimeEnv>;

export async function handleRequest(request: Request, env: RuntimeEnv): Promise<Response> {
  const url = new URL(request.url);
  if (request.method === "GET" && url.pathname === "/healthz") {
    return json({ ok: true });
  }
  if (url.pathname !== CALC_COMMAND_INVOKE_PATH) {
    return json({ error: "not found" }, 404);
  }
  if (request.method !== "POST") {
    return json({ error: "method not allowed" }, 405);
  }

  const sharedSecret = env.LILIUM_SHARED_SECRET;
  if (!sharedSecret) {
    return json({ error: "LILIUM_SHARED_SECRET is not configured" }, 500);
  }

  const bodyResult = await readLimitedBody(request);
  if (!bodyResult.ok) {
    return json({ error: bodyResult.error }, bodyResult.status);
  }

  const configId = env.LILIUM_COMMAND_CONFIG_ID ?? DEFAULT_CONFIG_ID;
  const signatureResult = await verifyLiliumRequestSignature(
    request,
    bodyResult.body,
    sharedSecret,
    configId,
  );
  if (!signatureResult.ok) {
    return json({ error: signatureResult.error }, signatureResult.status);
  }

  const envelopeResult = parseInvokeEnvelope(bodyResult.bodyText, configId);
  if (!envelopeResult.ok) {
    return json({ error: envelopeResult.error }, envelopeResult.status);
  }

  const expression = envelopeResult.envelope.command.args.trim();
  if (!expression) {
    return commandResult(envelopeResult.envelope.invocation_id, "rejected", [
      {
        type: "reply",
        text: "请提供表达式，例如：/calc 1 + 2 * (3 + 4)",
        markdown: false,
      },
    ]);
  }

  try {
    const value = evaluateExpression(expression);
    return commandResult(envelopeResult.envelope.invocation_id, "ok", [
      {
        type: "reply",
        text: `${expression} = ${formatNumber(value)}`,
        markdown: false,
      },
    ]);
  } catch (error) {
    const message = error instanceof CalculatorError ? error.message : "invalid expression";
    return commandResult(envelopeResult.envelope.invocation_id, "rejected", [
      {
        type: "reply",
        text: `表达式无法计算：${message}`,
        markdown: false,
      },
    ]);
  }
}

async function readLimitedBody(
  request: Request,
): Promise<{ ok: true; body: Uint8Array; bodyText: string } | { ok: false; status: number; error: string }> {
  const contentLength = request.headers.get("content-length");
  if (contentLength !== null && Number(contentLength) > MAX_BODY_BYTES) {
    return { ok: false, status: 413, error: "request body is too large" };
  }

  const body = new Uint8Array(await request.arrayBuffer());
  if (body.byteLength > MAX_BODY_BYTES) {
    return { ok: false, status: 413, error: "request body is too large" };
  }

  try {
    return {
      ok: true,
      body,
      bodyText: new TextDecoder("utf-8", { fatal: true }).decode(body),
    };
  } catch {
    return { ok: false, status: 400, error: "request body is not valid utf-8" };
  }
}

function parseInvokeEnvelope(
  bodyText: string,
  expectedConfigId: string,
):
  | {
      ok: true;
      envelope: {
        invocation_id: string;
        command: {
          args: string;
        };
      };
    }
  | { ok: false; status: number; error: string } {
  let raw: InvokeEnvelope;
  try {
    raw = JSON.parse(bodyText) as InvokeEnvelope;
  } catch {
    return { ok: false, status: 400, error: "request body is not valid json" };
  }

  if (raw.api_version !== API_VERSION || raw.type !== "command.invoke") {
    return { ok: false, status: 400, error: "unsupported invoke envelope" };
  }
  if (typeof raw.invocation_id !== "string" || !raw.invocation_id) {
    return { ok: false, status: 400, error: "missing invocation_id" };
  }
  if (!raw.command || typeof raw.command !== "object") {
    return { ok: false, status: 400, error: "missing command" };
  }
  if (raw.command.config_id !== expectedConfigId) {
    return { ok: false, status: 400, error: "command config_id mismatch" };
  }
  if (typeof raw.command.args !== "string") {
    return { ok: false, status: 400, error: "command args must be a string" };
  }

  return {
    ok: true,
    envelope: {
      invocation_id: raw.invocation_id,
      command: {
        args: raw.command.args,
      },
    },
  };
}

function commandResult(invocationId: string, status: "ok" | "rejected", effects: Effect[]): Response {
  return json({
    api_version: API_VERSION,
    type: "command.result",
    invocation_id: invocationId,
    status,
    effects,
  });
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

export async function createSignedCalcRequest(
  url: string,
  sharedSecret: string,
  envelope: unknown,
  configId = DEFAULT_CONFIG_ID,
): Promise<Request> {
  const body = new TextEncoder().encode(JSON.stringify(envelope));
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    "Idempotency-Key":
      typeof envelope === "object" && envelope !== null && "invocation_id" in envelope
        ? String(envelope.invocation_id)
        : crypto.randomUUID(),
    "Content-Digest": await contentDigestHeader(body),
  };
  const signatureHeaders = await createLiliumSignatureHeaders(
    sharedSecret,
    configId,
    "POST",
    url,
    headers,
  );
  return new Request(url, {
    method: "POST",
    headers: {
      ...headers,
      ...signatureHeaders,
    },
    body,
  });
}
