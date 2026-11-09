/** Standard base64, shared with the Rust shell (`base64` STANDARD engine). */

const CHUNK = 0x4000;

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const slice = bytes.subarray(i, Math.min(i + CHUNK, bytes.length));
    let part = "";
    for (let j = 0; j < slice.length; j++) part += String.fromCharCode(slice[j]!);
    binary += part;
  }
  return btoa(binary);
}

export function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
