import { createHmac, timingSafeEqual } from 'node:crypto';

import { find, map, pipe } from 'remeda';

export type GuestCookieSigner = {
  sign(holderId: string): string;
  read(cookie: string | undefined): string | undefined;
};

export const createGuestCookieSigner = (cookieName: string, secret: string): GuestCookieSigner => {
  const signatureFor = (holderId: string) =>
    createHmac('sha256', secret).update(holderId).digest('base64url');

  return {
    sign: (holderId) => `${holderId}.${signatureFor(holderId)}`,
    read: (cookie) => {
      const value = pipe(
        cookie?.split(';') ?? [],
        map((part) => part.trim()),
        find((part) => part.startsWith(`${cookieName}=`)),
      )?.slice(cookieName.length + 1);
      if (!value) return undefined;

      const separator = value.lastIndexOf('.');
      if (separator < 1) return undefined;

      const holderId = value.slice(0, separator);
      const signature = value.slice(separator + 1);
      const expectedSignature = signatureFor(holderId);
      if (signature.length !== expectedSignature.length) return undefined;

      return timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))
        ? holderId
        : undefined;
    },
  };
};

export const guestCookieSecret = () => {
  if (process.env.GUEST_COOKIE_SECRET) return process.env.GUEST_COOKIE_SECRET;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('GUEST_COOKIE_SECRET must be configured in production.');
  }
  return 'local-development-secret';
};
