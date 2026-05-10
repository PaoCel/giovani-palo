import { useEffect, useState } from "react";
import { RouterProvider } from "react-router-dom";

import { AuthProvider } from "@/app/providers/AuthProvider";
import { AdminPushSync } from "@/components/AdminPushSync";
import { AppLoader } from "@/components/AppLoader";
import { useAuth } from "@/hooks/useAuth";
import { router } from "@/routes/router";

// Soglia oltre cui si mostra splash invece del contenuto pubblico:
// sotto questo valore il primo paint pubblico e' percepito come "istantaneo"
// e non vale la pena mostrare l'overlay (eviterebbe il flash di un loader
// breve). Sopra, l'attesa diventa fastidiosa e il loader chiarifica
// "sto verificando se sei loggato".
const SPLASH_DELAY_MS = 250;

function AuthGate() {
  const { loading } = useAuth();
  const [splashVisible, setSplashVisible] = useState(false);

  useEffect(() => {
    if (!loading) {
      setSplashVisible(false);
      return;
    }

    const timer = window.setTimeout(() => setSplashVisible(true), SPLASH_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [loading]);

  if (loading && splashVisible) {
    return <AppLoader label="Verifica sessione..." />;
  }

  if (loading) {
    return null;
  }

  return (
    <>
      <AdminPushSync />
      <RouterProvider router={router} />
    </>
  );
}

function App() {
  return (
    <AuthProvider>
      <AuthGate />
    </AuthProvider>
  );
}

export default App;
