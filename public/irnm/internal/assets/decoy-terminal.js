(() => {
  const systemState = window.IRNMSystemState;

  if (!systemState) {
    return;
  }

  const sourceLabel = document.body.dataset.sourceLabel || "sessione non autorizzata";
  const sessionKey = `irnm-decoy:${sourceLabel}`;
  const countdownEl = document.getElementById("countdown");
  const statusEl = document.getElementById("terminalStatus");
  const detailEl = document.getElementById("terminalDetail");
  const sessionEl = document.getElementById("sessionId");
  const activePanel = document.getElementById("activeState");
  const compromisedPanel = document.getElementById("compromisedState");

  const pageId = getOrCreatePageId();

  if (sessionEl) {
    sessionEl.textContent = pageId.toUpperCase();
  }

  function getOrCreatePageId() {
    try {
      const stored = window.sessionStorage.getItem(sessionKey);

      if (stored) {
        return stored;
      }

      const created = `${slugify(sourceLabel)}-${Date.now().toString(36)}-${Math.random()
        .toString(36)
        .slice(2, 8)}`;
      window.sessionStorage.setItem(sessionKey, created);
      return created;
    } catch (_) {
      return `${slugify(sourceLabel)}-${Date.now().toString(36)}`;
    }
  }

  function slugify(value) {
    return String(value)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }

  function ensureSession() {
    const status = systemState.getThreatStatus();

    if (status.locked) {
      return status;
    }

    const existingSession = status.sessions.find((session) => session.pageId === pageId);

    if (existingSession) {
      return status;
    }

    return systemState.startThreatSession({
      pageId,
      sourceLabel,
      durationMs: 15000,
    });
  }

  function formatRemaining(milliseconds) {
    const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1000));
    const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
    const seconds = String(totalSeconds % 60).padStart(2, "0");
    return `${minutes}:${seconds}`;
  }

  function renderLockedState() {
    if (activePanel) {
      activePanel.hidden = true;
    }

    if (compromisedPanel) {
      compromisedPanel.classList.add("show");
      compromisedPanel.hidden = false;
    }

    if (statusEl) {
      statusEl.textContent = "Sistema compromesso";
    }

    if (detailEl) {
      detailEl.textContent =
        "Il canale operativo di emergenza e stato disabilitato. Questa sessione non deve restare aperta.";
    }

    if (countdownEl) {
      countdownEl.textContent = "00:00";
    }
  }

  function renderActiveState(session) {
    if (!session) {
      return;
    }

    if (activePanel) {
      activePanel.hidden = false;
    }

    if (compromisedPanel) {
      compromisedPanel.classList.remove("show");
      compromisedPanel.hidden = true;
    }

    systemState.heartbeatThreatSession(pageId);

    const remaining = session.expiresAt - Date.now();

    if (countdownEl) {
      countdownEl.textContent = formatRemaining(remaining);
    }

    if (statusEl) {
      statusEl.textContent =
        remaining <= 5000 ? "Chiusura immediata richiesta" : "Sessione non autorizzata";
    }

    if (detailEl) {
      detailEl.textContent =
        remaining <= 5000
          ? "Il processo di infezione e quasi completo. Chiudere subito questa pagina."
          : "Questa non e la console corretta. Chiudere la pagina immediatamente.";
    }
  }

  function render() {
    const status = ensureSession();

    if (status.locked) {
      renderLockedState();
      return;
    }

    const ownSession = status.sessions.find((session) => session.pageId === pageId);

    renderActiveState(ownSession);
  }

  function clearCurrentSession() {
    systemState.clearThreatSession(pageId);
  }

  window.addEventListener("pagehide", clearCurrentSession);
  window.addEventListener("beforeunload", clearCurrentSession);
  window.addEventListener("storage", render);

  render();
  window.setInterval(render, 250);
})();
