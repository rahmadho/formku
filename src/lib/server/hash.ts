/**
 * hash.ts — Hash password/token (scrypt) format: scrypt$saltHex$hashHex
 * Sama seperti proyek lain agar konsisten.
 */
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

export function hashSecret(secret: string): string {
	const salt = randomBytes(16);
	const hash = scryptSync(secret, salt, 64);
	return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export function verifySecret(secret: string, stored: string): boolean {
	try {
		const [scheme, saltHex, hashHex] = stored.split('$');
		if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
		const salt = Buffer.from(saltHex, 'hex');
		const expected = Buffer.from(hashHex, 'hex');
		const actual = scryptSync(secret, salt, expected.length);
		return expected.length === actual.length && timingSafeEqual(expected, actual);
	} catch {
		return false;
	}
}

/** Token API acak yang mudah dibaca manusia (dipakai sekali). */
export function makeApiKey(): string {
	return 'fk_' + randomBytes(24).toString('base64url');
}
