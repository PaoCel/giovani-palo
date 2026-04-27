import { useEffect, useState } from "react";

import { useAuth } from "@/hooks/useAuth";
import { adminPushService, type AdminPushStatus } from "@/services/push/adminPushService";

function getAdminDisplayName(
  fullName: string | null | undefined,
  email?: string | null,
  displayName?: string | null,
) {
  if (fullName && fullName !== "Partecipante" && fullName !== "Ospite anonimo") {
    return fullName;
  }

  if (displayName) {
    return displayName;
  }

  return email || "Admin";
}

export function AdminPushSettingsCard() {
  const { session } = useAuth();
  const [pushStatus, setPushStatus] = useState<AdminPushStatus>({
    supported: false,
    permission: "unsupported",
    subscribed: false,
    requiresStandaloneInstall: false,
  });
  const [pushLoading, setPushLoading] = useState(false);
  const [pushMessage, setPushMessage] = useState("");

  useEffect(() => {
    void adminPushService
      .getStatus()
      .then((status) => {
        setPushStatus(status);
      })
      .catch(() => undefined);
  }, []);

  async function handleEnablePushNotifications() {
    if (!session?.isAdmin || !session.profile.stakeId) {
      return;
    }

    setPushLoading(true);
    setPushMessage("");

    try {
      const nextStatus = await adminPushService.enableCurrentDevice({
        stakeId: session.profile.stakeId,
        userId: session.firebaseUser.uid,
        userName: getAdminDisplayName(
          session.profile.fullName,
          session.firebaseUser.email,
          session.firebaseUser.displayName,
        ),
        role: session.profile.role,
      });

      setPushStatus(nextStatus);
      setPushMessage(
        nextStatus.subscribed
          ? "Questo dispositivo ora e registrato per ricevere notifiche push vere."
          : "Il browser non ha completato l'attivazione delle notifiche push.",
      );
    } catch (pushError) {
      setPushMessage(
        pushError instanceof Error
          ? pushError.message
          : "Non sono riuscito ad attivare le notifiche push su questo dispositivo.",
      );
    } finally {
      setPushLoading(false);
    }
  }

  async function handleDisablePushNotifications() {
    setPushLoading(true);
    setPushMessage("");

    try {
      const nextStatus = await adminPushService.disableCurrentDevice(session?.profile.stakeId);
      setPushStatus(nextStatus);
      setPushMessage("Le notifiche push sono state disattivate su questo dispositivo.");
    } catch {
      setPushMessage("Non sono riuscito a disattivare le notifiche push.");
    } finally {
      setPushLoading(false);
    }
  }

  return (
    <section className="admin-section">
      <div className="admin-section__head">
        <div>
          <h2>Notifiche admin</h2>
          <p className="subtle-text">
            Gestisci questo dispositivo per ricevere notifiche push vere sui nuovi iscritti.
          </p>
        </div>
      </div>

      {pushMessage ? (
        <div className="notice notice--info">
          <div>
            <h3>Stato notifiche push</h3>
            <p>{pushMessage}</p>
          </div>
        </div>
      ) : null}

      {pushStatus.requiresStandaloneInstall ? (
        <div className="notice notice--info">
          <div>
            <h3>Installa prima l&apos;app</h3>
            <p>
              Su iPhone e iPad devi prima aggiungere l&apos;app alla schermata Home, poi aprirla da
              li e attivare le notifiche push.
            </p>
          </div>
        </div>
      ) : !pushStatus.supported ? (
        <div className="notice notice--warning">
          <div>
            <h3>Push non supportate</h3>
            <p>Questo browser o dispositivo non supporta le notifiche push web richieste.</p>
          </div>
        </div>
      ) : pushStatus.subscribed ? (
        <div className="notice notice--success">
          <div>
            <h3>Push attive</h3>
            <p>
              Questo dispositivo e registrato. Le nuove iscrizioni verranno inviate anche fuori
              dall&apos;app.
            </p>
          </div>
          <button
            className="button button--soft button--small"
            disabled={pushLoading}
            onClick={() => void handleDisablePushNotifications()}
            type="button"
          >
            Disattiva
          </button>
        </div>
      ) : (
        <div className="notice notice--info">
          <div>
            <h3>Attiva le notifiche push</h3>
            <p>
              Consenti le notifiche su questo dispositivo per ricevere l&apos;avviso anche quando la
              PWA e in background o chiusa.
            </p>
            {pushStatus.permission === "denied" ? (
              <p>
                Il browser le ha bloccate: riattivale dalle impostazioni del sito e poi riprova.
              </p>
            ) : null}
          </div>
          {pushStatus.permission !== "denied" ? (
            <button
              className="button button--soft button--small"
              disabled={pushLoading}
              onClick={() => void handleEnablePushNotifications()}
              type="button"
            >
              {pushLoading ? "Attivazione..." : "Attiva notifiche push"}
            </button>
          ) : null}
        </div>
      )}
    </section>
  );
}
