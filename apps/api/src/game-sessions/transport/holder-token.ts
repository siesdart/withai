import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

export const holderTokenHeader = 'X-Holder-Token';

export type HolderTokenSigner = {
  createHolderId(): string;
  sign(holderId: string): string;
  read(token: string | undefined): string | undefined;
};

export const createHolderTokenSigner = (secret: string): HolderTokenSigner => {
  const signatureFor = (holderId: string) =>
    createHmac('sha256', secret).update(holderId).digest('base64url');

  return {
    createHolderId: randomUUID,
    sign: (holderId) => `${holderId}.${signatureFor(holderId)}`,
    read: (token) => {
      if (!token) return undefined;

      const separator = token.lastIndexOf('.');
      if (separator < 1) return undefined;

      const holderId = token.slice(0, separator);
      const signature = token.slice(separator + 1);
      const expectedSignature = signatureFor(holderId);
      if (signature.length !== expectedSignature.length) return undefined;

      return timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))
        ? holderId
        : undefined;
    },
  };
};

export const holderTokenSecret = () => {
  if (process.env.HOLDER_TOKEN_SECRET) return process.env.HOLDER_TOKEN_SECRET;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('HOLDER_TOKEN_SECRET must be configured in production.');
  }
  return 'local-development-secret';
};
