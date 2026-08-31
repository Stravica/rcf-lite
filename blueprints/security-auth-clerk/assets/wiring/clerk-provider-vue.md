# Clerk plugin wiring: Vue-family sample

The Vue-family counterpart to the React sample. Same shape (a provider mounted once, above the router); different SDK. The Clerk Vue-family package identifier below (`@clerk/vue`) reflects Clerk's Vue support at the blueprint's authoring window; consult Clerk's currently-canonical documentation at the project's build time and adjust if the package or plugin surface has changed.

## Where the plugin registers

The plugin registers on the Vue app instance once, at boot, before the router is used.

```
// src/main.ts (or the framework's equivalent boot module)
import { createApp } from 'vue';
import { clerkPlugin } from '@clerk/vue';
import App from './App.vue';
import { router } from './router';

const publishableKey = window.__CLERK_PUBLISHABLE_KEY__;
// Read from the project's config surface, not from import.meta.env directly.
// Same convention as the React sample.

const app = createApp(App);
app.use(clerkPlugin, { publishableKey });
app.use(router);
app.mount('#app');
```

## What the client tier reads

The Clerk Vue plugin exposes composables (`useAuth`, `useUser`, `useSignOut`) whose surface mirrors the React hooks. The client tier calls `useSignOut()` (or the equivalent) on the operator's sign-out action; that is what invalidates the session on Clerk's side per AC-9107-1.

## The `__session` cookie is invisible to the client tier

Same rule as the React sample: the cookie is HttpOnly; the SDK synchronises client-side sign-in state through its own store; the cookie rides on every same-origin request to the project's server.

## Composition with the SPA blueprint

If the project has applied `application-spa`, the SPA blueprint's 401-redirect posture composes with this blueprint's middleware exactly as it does in the React case; the SPA blueprint's session-and-redirect posture is framework-agnostic on the client tier.

## What this sample deliberately does not cover

- Nuxt-specific module wiring. Clerk has Nuxt-specific modules; the operator on a Nuxt project consults Clerk's Nuxt documentation for the module-mode wiring rather than following this shape.
- The sign-in and sign-up components. Same as the React sample: those are Clerk-provided.
