import type { FirebaseApp, FirebaseOptions } from "firebase/app";
import type { Auth, GoogleAuthProvider } from "firebase/auth";

const requiredConfigKeys = [
  "apiKey",
  "authDomain",
  "projectId",
  "appId",
  "messagingSenderId",
] as const;

function isDevEnvironment() {
  return import.meta.env.DEV;
}

function maskApiKey(apiKey?: string) {
  if (!apiKey) {
    return "(missing)";
  }

  if (apiKey.length <= 10) {
    return apiKey;
  }

  return `${apiKey.slice(0, 6)}...${apiKey.slice(-4)}`;
}

function getMissingConfigKeys(options: FirebaseOptions) {
  return requiredConfigKeys.filter((key) => !options[key]);
}

function getErrorCode(error: unknown) {
  if (error && typeof error === "object" && "code" in error) {
    return String(error.code);
  }

  return null;
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

export function logFirebaseBootstrap(args: {
  app: FirebaseApp;
  auth: Auth;
  googleProvider: GoogleAuthProvider;
}) {
  if (!isDevEnvironment()) {
    return;
  }

  const { app, auth, googleProvider } = args;
  const missingKeys = getMissingConfigKeys(app.options);

  console.groupCollapsed("[Firebase] Bootstrap");
  console.info("Runtime config", {
    projectId: app.options.projectId,
    authDomain: app.options.authDomain,
    appId: app.options.appId,
    messagingSenderId: app.options.messagingSenderId,
    storageBucket: app.options.storageBucket ?? "(not set)",
    apiKey: maskApiKey(app.options.apiKey),
    origin: typeof window !== "undefined" ? window.location.origin : "(no window)",
    missingRequiredKeys: missingKeys,
  });
  console.info("Runtime instances", {
    appName: app.name,
    authAppName: auth.app.name,
    currentUser: auth.currentUser?.uid ?? null,
    googleProviderId: googleProvider.providerId,
    tenantId: auth.tenantId ?? null,
  });
  console.groupEnd();
}

export function logAuthFailure(
  operation: string,
  auth: Auth,
  error: unknown,
  extra?: Record<string, unknown>,
) {
  if (!isDevEnvironment()) {
    return;
  }

  console.group(`[Firebase Auth] ${operation} failed`);
  console.error("Firebase Auth error", {
    code: getErrorCode(error),
    message: getErrorMessage(error),
  });
  console.info("Auth runtime", {
    projectId: auth.app.options.projectId,
    authDomain: auth.app.options.authDomain,
    appId: auth.app.options.appId,
    messagingSenderId: auth.app.options.messagingSenderId,
    storageBucket: auth.app.options.storageBucket ?? "(not set)",
    apiKey: maskApiKey(auth.app.options.apiKey),
    authAppName: auth.app.name,
    origin: typeof window !== "undefined" ? window.location.origin : "(no window)",
    ...extra,
  });
  console.groupEnd();
}

export function toUserFacingAuthError(error: unknown) {
  const code = getErrorCode(error);

  if (code === "auth/configuration-not-found") {
    return "Il frontend sta puntando al progetto Firebase corretto, ma Firebase Authentication non risulta inizializzata o abilitata lato backend per questo progetto.";
  }

  return getErrorMessage(error);
}
