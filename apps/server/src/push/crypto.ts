/**
 * Web Push cryptography on WebCrypto SubtleCrypto (no Node deps — runs in Workers):
 *  - RFC 8291 message encryption ("aes128gcm" content coding)
 *  - RFC 8292 VAPID authentication (ES256 JWT)
 *
 * Verified against the RFC 8291 §5/Appendix A test vector (see test/push-crypto.test.ts).
 */

/** base64url → bytes */
export function b64uDecode(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const pad = (4 - (b64.length % 4)) % 4;
  const bin = atob(b64 + '='.repeat(pad));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** bytes → base64url (chunked: btoa on huge strings can blow the stack) */
export function b64uEncode(bytes: Uint8Array): string {
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const te = new TextEncoder();

async function hmacSha256(keyBytes: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', keyBytes as BufferSource, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, data as BufferSource));
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

/** Split a 65-byte uncompressed P-256 point (0x04 || x || y) into x, y. */
export function splitUncompressedPoint(pub: Uint8Array): { x: Uint8Array; y: Uint8Array } {
  if (pub.length !== 65 || pub[0] !== 0x04) throw new Error('expected 65-byte uncompressed P-256 point');
  return { x: pub.slice(1, 33), y: pub.slice(33, 65) };
}

export interface EphemeralKey {
  /** 65-byte uncompressed public key (the "keyid") */
  publicBytes: Uint8Array;
  privateKey: CryptoKey;
}

/** Generate a fresh P-256 ECDH key pair for one push message. */
export async function generateEphemeralKey(): Promise<EphemeralKey> {
  const kp = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair;
  const publicBytes = new Uint8Array((await crypto.subtle.exportKey('raw', kp.publicKey)) as ArrayBuffer);
  return { publicBytes, privateKey: kp.privateKey };
}

/** Import a fixed ECDH private key from JWK parts (tests / deterministic vectors). */
export async function importEphemeralKey(x: string, y: string, d: string): Promise<EphemeralKey> {
  const privateKey = await crypto.subtle.importKey(
    'jwk', { kty: 'EC', crv: 'P-256', x, y, d }, { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'],
  );
  return { publicBytes: concat(new Uint8Array([0x04]), b64uDecode(x), b64uDecode(y)), privateKey };
}

/**
 * RFC 8291 §3: encrypt `plaintext` for the subscription's p256dh key.
 * Returns the full HTTP body: 86-byte header + AES-128-GCM ciphertext.
 * Pass `fixed` (salt + ephemeral key) only for test vectors — production MUST randomize.
 */
export async function encryptPushPayload(
  uaPublicB64u: string,
  authSecretB64u: string,
  plaintext: Uint8Array,
  fixed?: { salt: Uint8Array; ephemeral: EphemeralKey },
): Promise<Uint8Array> {
  const uaPublic = b64uDecode(uaPublicB64u);
  const authSecret = b64uDecode(authSecretB64u);
  if (uaPublic.length !== 65) throw new Error('p256dh must be a 65-byte uncompressed point');
  if (authSecret.length !== 16) throw new Error('auth secret must be 16 bytes');

  const salt = fixed?.salt ?? crypto.getRandomValues(new Uint8Array(16));
  const ephemeral = fixed?.ephemeral ?? (await generateEphemeralKey());

  const uaPubKey = await crypto.subtle.importKey('raw', uaPublic as BufferSource, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  // workers-types lacks the ECDH params typing; the runtime follows the WebCrypto standard.
  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits(
    { name: 'ECDH', public: uaPubKey } as unknown as SubtleCryptoDeriveKeyAlgorithm, ephemeral.privateKey, 256));

  // §3.3: combine ECDH secret with the auth secret → IKM
  const prkKey = await hmacSha256(authSecret, ecdhSecret);
  const keyInfo = concat(te.encode('WebPush: info'), new Uint8Array([0]), uaPublic, ephemeral.publicBytes);
  const ikm = await hmacSha256(prkKey, concat(keyInfo, new Uint8Array([1])));

  // RFC 8188 §2.1 KDF (single HKDF-extract/expand round each, L ≤ 32)
  const prk = await hmacSha256(salt, ikm);
  const cekInfo = concat(te.encode('Content-Encoding: aes128gcm'), new Uint8Array([0, 1]));
  const nonceInfo = concat(te.encode('Content-Encoding: nonce'), new Uint8Array([0, 1]));
  const cek = (await hmacSha256(prk, cekInfo)).slice(0, 16);
  const nonce = (await hmacSha256(prk, nonceInfo)).slice(0, 12);

  // §4: single record, rs=4096, padding delimiter 0x02, no extra padding
  const padded = concat(plaintext, new Uint8Array([0x02]));
  const rs = new Uint8Array(4);
  new DataView(rs.buffer).setUint32(0, 4096, false);
  const header = concat(salt, rs, new Uint8Array([ephemeral.publicBytes.length]), ephemeral.publicBytes);

  const cekKey = await crypto.subtle.importKey('raw', cek as BufferSource, { name: 'AES-GCM' }, false, ['encrypt']);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce as BufferSource, additionalData: new Uint8Array(0) }, cekKey, padded as BufferSource,
  ));
  return concat(header, ciphertext);
}

export interface VapidKeys {
  /** base64url of the 65-byte uncompressed P-256 public point */
  publicKey: string;
  /** base64url of the 32-byte private scalar */
  privateKey: string;
  /** contact URI, e.g. "mailto:ops@example.com" */
  subject: string;
}

/** DER (r,s) → raw 64-byte R||S for JWS. */
function derToRaw(der: Uint8Array): Uint8Array {
  let o = 0;
  if (der[o++] !== 0x30) throw new Error('bad DER');
  let len = der[o++];
  if (len & 0x80) { const n = len & 0x7f; len = 0; for (let i = 0; i < n; i++) len = (len << 8) | der[o++]; }
  const ints: Uint8Array[] = [];
  for (let i = 0; i < 2; i++) {
    if (der[o++] !== 0x02) throw new Error('bad DER int');
    let l = der[o++];
    let v = der.slice(o, o + l); o += l;
    while (v.length > 32 && v[0] === 0) v = v.slice(1); // strip DER leading zero
    if (v.length > 32) throw new Error('bad DER int length');
    const padded = new Uint8Array(32);
    padded.set(v, 32 - v.length);
    ints.push(padded);
  }
  return concat(ints[0]!, ints[1]!);
}

/**
 * RFC 8292: build the `Authorization: vapid t=..., k=...` header value.
 * `audience` is the push service origin (scheme + host), e.g. "https://fcm.googleapis.com".
 */
export async function vapidAuthorization(vapid: VapidKeys, audience: string, nowMs: number): Promise<string> {
  const { x, y } = splitUncompressedPoint(b64uDecode(vapid.publicKey));
  const d = b64uDecode(vapid.privateKey);
  if (d.length !== 32) throw new Error('VAPID private key must be 32 bytes');
  const key = await crypto.subtle.importKey(
    'jwk',
    { kty: 'EC', crv: 'P-256', x: b64uEncode(x), y: b64uEncode(y), d: b64uEncode(d) },
    { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign'],
  );
  const header = b64uEncode(te.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const payload = b64uEncode(te.encode(JSON.stringify({
    aud: audience,
    exp: Math.floor(nowMs / 1000) + 12 * 3600,
    sub: vapid.subject,
  })));
  const signingInput = te.encode(`${header}.${payload}`);
  const sigBytes = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, signingInput as BufferSource));
  const sig = b64uEncode(ecdsaSigToRaw(sigBytes));
  return `vapid t=${header}.${payload}.${sig}, k=${vapid.publicKey}`;
}

/**
 * Normalize an ECDSA signature to raw 64-byte R||S. WebCrypto (Workers, Node)
 * returns raw R||S; some stacks return DER — accept both.
 */
function ecdsaSigToRaw(sig: Uint8Array): Uint8Array {
  if (sig.length !== 64) return derToRaw(sig);
  if (sig[0] === 0x30) {
    try { return derToRaw(sig); } catch { /* a raw sig starting with 0x30 — fall through */ }
  }
  return sig.slice();
}
