import { createRootRoute, Link, Outlet, useLocation } from '@tanstack/react-router';
import { TanStackRouterDevtools } from '@tanstack/react-router-devtools';

function RootLayout() {
  const { pathname } = useLocation();
  const isPrototype = pathname.startsWith('/prototype/');

  return (
    <>
      {isPrototype ? null : (
        <>
          <div className="flex gap-2 p-2">
            <Link to="/" className="[&.active]:font-bold">
              Home
            </Link>{' '}
            <Link to="/about" className="[&.active]:font-bold">
              About
            </Link>
          </div>
          <hr />
        </>
      )}
      <Outlet />
      {isPrototype ? null : <TanStackRouterDevtools />}
    </>
  );
}

export const Route = createRootRoute({ component: RootLayout });
