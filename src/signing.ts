const SIGNATURE_LABEL = "lilium";
const SIGNATURE_VALIDITY_SKEW_SECONDS = 30;
const REQUIRED_COMPONENTS = [
  "@method",
  "@authority",
  "@path",
  "content-type",
  "accept",
  "idempotency-key",
  "content-digest",
] as const;

type SignatureInput = {
  components: string[];
  created: number;
  expires: number;
  keyid: string;
  alg: string;
};

export type SignatureVerificationResult =
  | { ok: true; keyid: string }
  | { ok: false; status: number; error: string };

export async function contentDigestHeader(body: Uint8Array): Promise<string> {
  return `sha-256=:${await sha256Base64(body)}:`;
}

export async function createLiliumSignatureHeaders(
  sharedSecret: string,
  keyid: string,
  method: string,
  url: string,
  headers: Record<string, string>,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<Record<string, string>> {
  const signatureInput = buildSignatureInput(
    keyid,
    nowSeconds,
    nowSeconds + 30,
    [...REQUIRED_COMPONENTS],
  );
  const signatureBase = buildSignatureBase({
    method,
    url,
    headers,
    signatureInput,
    components: [...REQUIRED_COMPONENTS],
  });
  const signature = await hmacSha256(sharedSecret, signatureBase);
  return {
    "Signature-Input": signatureInput,
    Signature: `${SIGNATURE_LABEL}=:${bytesToBase64(signature)}:`,
  };
}

export async function verifyLiliumRequestSignature(
  request: Request,
  body: Uint8Array,
  sharedSecret: string,
  expectedKeyid: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<SignatureVerificationResult> {
  const digest = request.headers.get("content-digest");
  if (!digest) {
    return { ok: false, status: 400, error: "missing content-digest" };
  }

  const expectedDigest = await contentDigestHeader(body);
  if (!constantTimeEqual(base64DigestValue(digest), base64DigestValue(expectedDigest))) {
    return { ok: false, status: 400, error: "content digest mismatch" };
  }

  const signatureInputHeader = request.headers.get("signature-input");
  const signatureHeader = request.headers.get("signature");
  if (!signatureInputHeader || !signatureHeader) {
    return { ok: false, status: 401, error: "missing signature headers" };
  }

  const parsedInput = parseSignatureInput(signatureInputHeader);
  if (!parsedInput) {
    return { ok: false, status: 401, error: "invalid signature-input" };
  }
  if (!sameComponents(parsedInput.components, [...REQUIRED_COMPONENTS])) {
    return { ok: false, status: 401, error: "unsupported signature components" };
  }
  if (parsedInput.keyid !== expectedKeyid || parsedInput.alg !== "hmac-sha256") {
    return { ok: false, status: 401, error: "unsupported signature parameters" };
  }
  if (
    parsedInput.expires < nowSeconds ||
    parsedInput.created > nowSeconds + SIGNATURE_VALIDITY_SKEW_SECONDS
  ) {
    return { ok: false, status: 401, error: "signature timestamp is outside the allowed window" };
  }

  for (const component of REQUIRED_COMPONENTS) {
    if (!component.startsWith("@") && !request.headers.has(component)) {
      return { ok: false, status: 401, error: `missing signed header ${component}` };
    }
  }

  const signatureBytes = parseSignature(signatureHeader);
  if (!signatureBytes) {
    return { ok: false, status: 401, error: "invalid signature" };
  }

  const signatureBase = buildSignatureBase({
    method: request.method,
    url: request.url,
    headers: Object.fromEntries(request.headers.entries()),
    signatureInput: signatureInputHeader,
    components: parsedInput.components,
  });
  const expectedSignature = await hmacSha256(sharedSecret, signatureBase);
  if (!constantTimeEqual(signatureBytes, expectedSignature)) {
    return { ok: false, status: 401, error: "signature mismatch" };
  }

  return { ok: true, keyid: parsedInput.keyid };
}

function buildSignatureInput(
  keyid: string,
  created: number,
  expires: number,
  components: string[],
): string {
  const componentList = components.map((component) => `"${component}"`).join(" ");
  return `${SIGNATURE_LABEL}=(${componentList});created=${created};expires=${expires};keyid="${keyid}";alg="hmac-sha256"`;
}

function buildSignatureBase({
  method,
  url,
  headers,
  signatureInput,
  components,
}: {
  method: string;
  url: string;
  headers: Record<string, string>;
  signatureInput: string;
  components: string[];
}): Uint8Array {
  const parsedUrl = new URL(url);
  const headerLookup = new Map(
    Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value]),
  );
  const lines = components.map((component) => {
    if (component === "@method") {
      return `"@method": ${method}`;
    }
    if (component === "@authority") {
      return `"@authority": ${parsedUrl.host}`;
    }
    if (component === "@path") {
      return `"@path": ${parsedUrl.pathname}${parsedUrl.search}`;
    }
    return `"${component}": ${headerLookup.get(component) ?? ""}`;
  });
  lines.push(`"@signature-params": ${signatureInput.slice(`${SIGNATURE_LABEL}=`.length)}`);
  return new TextEncoder().encode(lines.join("\n"));
}

function parseSignatureInput(value: string): SignatureInput | null {
  const match = /^lilium=\((?<components>(?:"[^"]+"\s*)+)\);(?<params>.+)$/.exec(value);
  if (!match?.groups) {
    return null;
  }

  const components = [...match.groups.components.matchAll(/"([^"]+)"/g)].map(
    (componentMatch) => componentMatch[1],
  );
  const params = parseParams(match.groups.params);
  const created = Number(params.get("created"));
  const expires = Number(params.get("expires"));
  const keyid = unquote(params.get("keyid"));
  const alg = unquote(params.get("alg"));
  if (
    !Number.isInteger(created) ||
    !Number.isInteger(expires) ||
    keyid === null ||
    alg === null
  ) {
    return null;
  }

  return {
    components,
    created,
    expires,
    keyid,
    alg,
  };
}

function parseParams(value: string): Map<string, string> {
  const params = new Map<string, string>();
  for (const part of value.split(";")) {
    const [key, ...rest] = part.split("=");
    if (key && rest.length > 0) {
      params.set(key.trim(), rest.join("=").trim());
    }
  }
  return params;
}

function parseSignature(value: string): Uint8Array | null {
  const match = /^lilium=:(?<signature>[A-Za-z0-9+/=]+):$/.exec(value);
  if (!match?.groups) {
    return null;
  }
  try {
    return base64ToBytes(match.groups.signature);
  } catch {
    return null;
  }
}

function unquote(value: string | undefined): string | null {
  if (!value) {
    return null;
  }
  const match = /^"([^"]*)"$/.exec(value);
  return match ? match[1] : null;
}

function sameComponents(actual: string[], expected: string[]): boolean {
  return actual.length === expected.length && actual.every((value, index) => value === expected[index]);
}

function base64DigestValue(value: string): Uint8Array {
  const match = /^sha-256=:(?<digest>[A-Za-z0-9+/=]+):$/.exec(value);
  if (!match?.groups) {
    return new Uint8Array();
  }
  return base64ToBytes(match.groups.digest);
}

async function sha256Base64(body: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", toArrayBuffer(body));
  return bytesToBase64(new Uint8Array(digest));
}

async function hmacSha256(secret: string, payload: Uint8Array): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, toArrayBuffer(payload));
  return new Uint8Array(signature);
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array): boolean {
  let diff = left.length ^ right.length;
  const maxLength = Math.max(left.length, right.length);
  for (let index = 0; index < maxLength; index += 1) {
    diff |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return diff === 0;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}
