# ClerkProvider wiring: React-family sample

This is a shape-level sample for wiring Clerk's client SDK into a React-family client tier. It is a reference for the operator or the working agent realising the blueprint's TACs; it is not a copy-paste production module. The Clerk SDK identifiers below (`@clerk/clerk-react`, `ClerkProvider`, `useAuth`, `useUser`) reflect the SDK's shape at the blueprint's authoring window; consult Clerk's currently-canonical documentation at the project's build time and adjust if the package or export name has changed.

## Where the provider mounts

The provider wraps the client tier's route surface once, at the top of the tree, above the router. Every route inside the provider has access to the Clerk client through the hook surface; nothing outside the provider does.

```
// src/main.tsx (or the framework's equivalent boot module)
import { ClerkProvider } from '@clerk/clerk-react';
import { Router } from './router';

const publishableKey = window.__CLERK_PUBLISHABLE_KEY__;
// Read from the project's config surface, not from process.env directly.
// The secrets-management blueprint's Secrets Manager client is the source
// on the server side; the client tier consumes the publishable key
// as a build-time replacement or a boot-time injected global.

export function App() {
  return (
    <ClerkProvider publishableKey={publishableKey}>
      <Router />
    </ClerkProvider>
  );
}
```

## What the client tier reads

Two hooks cover most cases:

- `useAuth()` returns `{ isSignedIn, signOut, ... }`. The client tier calls `signOut()` on the operator's sign-out action; this is what invalidates the session on Clerk's side per AC-9107-1.
- `useUser()` returns the resolved user object; the client tier reads it for display purposes (an avatar, a display name). Downstream authorisation checks do not run on the client-tier user object; they run on the server against `request.auth` through the authorisation adapter.

## The `__session` cookie is invisible to the client tier

The Clerk SDK on the client tier does not read the `__session` cookie value (it is HttpOnly). The SDK's client-side state (whether the user is signed in, who the user is at the display level) is synchronised through Clerk's own client-side session store; the cookie is the credential the browser sends to the project's server on every same-origin request.

## Composition with the SPA blueprint

If the project has applied `application-spa`, the SPA blueprint's 401-redirect posture composes with this blueprint's middleware: a route the SPA blueprint marks as requiring authentication redirects to the sign-in surface when the middleware refuses; the SPA blueprint's error envelope shape is unchanged by this blueprint.

## What this sample deliberately does not cover

- A specific router library binding (React Router, TanStack Router). The provider mounts above the router; the router choice is the project's.
- Server-side rendering configuration. The Clerk SDK has SSR support that varies by framework (Next.js, Remix); consult the currently-canonical Clerk documentation for the project's framework.
- The sign-in and sign-up components themselves (`<SignIn />`, `<SignUp />`, or the hosted alternative). Those are Clerk-provided; the operator mounts them at a route (`/sign-in`, `/sign-up`) and the blueprint's job is to verify the resulting session on the server.
