import { useEffect, useMemo, useState } from "react";

import { AppIcon } from "@/components/AppIcon";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

const DISMISS_KEY = "install-hint-dismissed";

function isStandaloneDisplayMode() {
  if (typeof window === "undefined") {
    return false;
  }

  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export function InstallHint() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [visible, setVisible] = useState(false);
  const isIos = useMemo(() => {
    if (typeof navigator === "undefined") {
      return false;
    }

    return /iphone|ipad|ipod/i.test(navigator.userAgent);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    if (sessionStorage.getItem(DISMISS_KEY) === "true" || isStandaloneDisplayMode()) {
      return;
    }

    setVisible(true);

    function handleBeforeInstallPrompt(eventInput: Event) {
      const promptEvent = eventInput as BeforeInstallPromptEvent & { preventDefault?: () => void };
      promptEvent.preventDefault?.();
      setDeferredPrompt(promptEvent);
      setVisible(true);
    }

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    return () => window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
  }, []);

  if (!visible || isStandaloneDisplayMode()) {
    return null;
  }

  async function handleInstall() {
    if (!deferredPrompt) {
      return;
    }

    await deferredPrompt.prompt();
    const choice = await deferredPrompt.userChoice;

    if (choice.outcome === "accepted") {
      sessionStorage.setItem(DISMISS_KEY, "true");
      setVisible(false);
    }
  }

  function dismissHint() {
    sessionStorage.setItem(DISMISS_KEY, "true");
    setVisible(false);
  }

  return (
    <div className="install-hint-shell">
      <div className="install-hint">
        <div className="install-hint__icon">
          <AppIcon name="download" />
        </div>

        <div className="install-hint__content">
          <strong>{deferredPrompt ? "Installa la web app" : "Usala come app"}</strong>
          <p>
            {deferredPrompt
              ? "Aprila dalla Home per avere un'interfaccia più pulita e più vicina a un'app."
              : isIos
                ? "Su iPhone usa Condividi e poi “Aggiungi a Home” per aprirla come app."
                : "Aggiungila alla schermata Home per usarla con un look più pulito."}
          </p>
          <div className="install-hint__guides">
            <small>iPhone: Safari → Condividi → Aggiungi a Home.</small>
            <small>Android: menu browser → Installa app oppure Aggiungi a schermata Home.</small>
          </div>
        </div>

        {deferredPrompt ? (
          <button
            className="button button--soft button--small"
            onClick={() => void handleInstall()}
            type="button"
          >
            Installa
          </button>
        ) : null}

        <button
          aria-label="Chiudi suggerimento installazione"
          className="icon-button icon-button--soft install-hint__close"
          onClick={dismissHint}
          type="button"
        >
          <AppIcon name="x" />
        </button>
      </div>
    </div>
  );
}
