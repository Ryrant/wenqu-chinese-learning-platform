const encoder = new TextEncoder();
const decoder = new TextDecoder();
const iterations = 150_000;
const keyLengthBits = 256;

function base64UrlEncode(bytes: Uint8Array) {
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

async function derive(password: string, salt: Uint8Array) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, keyLengthBits);
  return new Uint8Array(bits);
}

function timingSafeEqual(left: Uint8Array, right: Uint8Array) {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) diff |= left[index] ^ right[index];
  return diff === 0;
}

export async function hashPassword(password: string, saltBytes?: Uint8Array) {
  const salt = saltBytes ?? crypto.getRandomValues(new Uint8Array(16));
  const digest = await derive(password, salt);
  return `pbkdf2-sha256$${iterations}$${base64UrlEncode(salt)}$${base64UrlEncode(digest)}`;
}

export async function verifyPassword(password: string, encodedHash: string) {
  try {
    const [algorithm, iterationText, saltText, digestText, extra] = encodedHash.split("$");
    if (algorithm !== "pbkdf2-sha256" || iterationText !== String(iterations) || !saltText || !digestText || extra) return false;
    const expected = base64UrlDecode(digestText);
    const actual = await derive(password, base64UrlDecode(saltText));
    return timingSafeEqual(actual, expected);
  } catch {
    decoder.decode(new Uint8Array());
    return false;
  }
}
