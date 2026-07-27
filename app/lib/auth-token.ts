export type StandardSession = {
  email: string;
  displayName: string;
  iat: number;
  exp: number;
};

export const sessionCookieName = "wenqu_session";

const encoder = new TextEncoder();

function base64UrlEncode(input: Uint8Array | string) {
  const bytes = typeof input === "string" ? encoder.encode(input) : input;
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function base64UrlDecode(value: string) {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

async function importSigningKey(secret: string) {
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

function decodeJson<T>(value: string): T | null {
  try {
    return JSON.parse(new TextDecoder().decode(base64UrlDecode(value))) as T;
  } catch {
    return null;
  }
}

export async function createSessionToken(session: StandardSession, secret: string) {
  const header = base64UrlEncode(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = base64UrlEncode(JSON.stringify(session));
  const key = await importSigningKey(secret);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(`${header}.${payload}`));
  return `${header}.${payload}.${base64UrlEncode(new Uint8Array(signature))}`;
}

export async function verifySessionToken(token: string, secret: string, nowSeconds = Math.floor(Date.now() / 1000)) {
  const [header, payload, signature, extra] = token.split(".");
  if (!header || !payload || !signature || extra) return null;
  const decodedHeader = decodeJson<{ alg?: string; typ?: string }>(header);
  if (decodedHeader?.alg !== "HS256" || decodedHeader.typ !== "JWT") return null;
  const session = decodeJson<StandardSession>(payload);
  if (!session || !session.email || !session.displayName || !Number.isFinite(session.iat) || !Number.isFinite(session.exp)) return null;
  if (session.exp <= nowSeconds) return null;
  const key = await importSigningKey(secret);
  const valid = await crypto.subtle.verify("HMAC", key, base64UrlDecode(signature), encoder.encode(`${header}.${payload}`));
  return valid ? session : null;
}
