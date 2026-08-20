const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
const PIN_CIPHER_PREFIX = "aesgcm$v1";

function bytesToBase64(bytes) {
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary);
}

function base64ToBytes(value) {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function pinEncryptionSecret(env) {
  return String(env?.FINANCE_PIN_ENCRYPTION_KEY || env?.FINANCE_EDITOR_KEY || env?.ADMIN_KEY || "").trim();
}

async function pinEncryptionKey(env) {
  const secret = pinEncryptionSecret(env);
  if (!secret) {
    const error = new Error("A finance PIN encryption secret is required before Board-member PINs can be saved.");
    error.status = 500;
    throw error;
  }
  const keyBytes = await crypto.subtle.digest("SHA-256", textEncoder.encode(`bgsl-finance-pin:v1:${secret}`));
  return crypto.subtle.importKey("raw", keyBytes, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

function additionalData(memberId) {
  return textEncoder.encode(`bgsl-finance-board-member:${memberId}`);
}

export async function encryptFinancePin(env, memberId, pin) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: additionalData(memberId) },
    await pinEncryptionKey(env),
    textEncoder.encode(pin),
  );
  return `${PIN_CIPHER_PREFIX}$${bytesToBase64(iv)}$${bytesToBase64(new Uint8Array(ciphertext))}`;
}

export async function decryptFinancePin(env, memberId, encryptedPin) {
  const [scheme, version, ivBase64, ciphertextBase64] = String(encryptedPin || "").split("$");
  if (`${scheme}$${version}` !== PIN_CIPHER_PREFIX || !ivBase64 || !ciphertextBase64) return "";
  try {
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: base64ToBytes(ivBase64), additionalData: additionalData(memberId) },
      await pinEncryptionKey(env),
      base64ToBytes(ciphertextBase64),
    );
    const pin = textDecoder.decode(plaintext);
    return /^\d{6}$/.test(pin) ? pin : "";
  } catch {
    return "";
  }
}
