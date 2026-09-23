import { useLocation } from '@tanstack/react-router';

type HeadProps = {
  title: string;
  description: string;
};

export function getCanonicalUrl(pathname: string) {
  return new URL(pathname, `${import.meta.env.VITE_SITE_URL}/`).toString();
}

export function Head({ title, description }: HeadProps) {
  const pathname = useLocation({
    select: (location) => location.pathname,
  });
  const canonicalUrl = getCanonicalUrl(pathname);

  return (
    <>
      <title>{title}</title>
      <meta name="description" content={description} />
      <meta property="og:title" content={title} />
      <meta property="og:description" content={description} />
      <meta property="og:url" content={canonicalUrl} />
      <link rel="canonical" href={canonicalUrl} />
    </>
  );
}
