import { createPrivateKey, createPublicKey, sign as rsaSign, verify as rsaVerify } from 'node:crypto';
import { crc32 as zlibCrc32 } from 'node:zlib';
import { generate } from 'selfsigned';

/** A PayPal host, so apps that check the cert URL's domain accept it; the register add-on sends the fetch to the twin. */
const CERT_BASE = 'https://api.sandbox.paypal.com/v1/notifications/certs/';

export function certUrl(certId: string): string {
  return `${CERT_BASE}${certId}`;
}

/** CRC32 of the UTF-8 bytes as an unsigned integer, the form PayPal puts in the signed string. */
export function crc32(data: string): number {
  return zlibCrc32(data);
}

/** What PayPal signs for each delivery (spec §6). `body` must be the exact bytes sent. */
export function signingString(transmissionId: string, transmissionTime: string, webhookId: string, body: string): string {
  return `${transmissionId}|${transmissionTime}|${webhookId}|${crc32(body)}`;
}

export interface Signer {
  /** `CERT-FF-<twinId>` */
  certId: string;
  certPem: string;
  /** Base64 RSA-SHA256, as in the PAYPAL-TRANSMISSION-SIG header. */
  sign(input: string): string;
  verify(input: string, sig: string): boolean;
}

/** A fresh key and self-signed cert per twin. Async because certificate generation is. */
export async function createSigner(twinId: string): Promise<Signer> {
  const pems = await generate(
    [
      { name: 'commonName', value: `Fastforward twin ${twinId}` },
      { name: 'organizationName', value: 'Fastforward (simulated PayPal)' },
    ],
    { keySize: 2048, algorithm: 'sha256' },
  );
  const privateKey = createPrivateKey(pems.private);
  const publicKey = createPublicKey(pems.cert);
  return {
    certId: `CERT-FF-${twinId}`,
    certPem: pems.cert,
    sign: (input) => rsaSign('sha256', Buffer.from(input), privateKey).toString('base64'),
    verify: (input, sig) => {
      try {
        return rsaVerify('sha256', Buffer.from(input), publicKey, Buffer.from(sig, 'base64'));
      } catch {
        return false;
      }
    },
  };
}
