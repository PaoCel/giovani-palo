(() => {
  const STORAGE_KEY = "irnm-system-state-v1";

  function createDefaultState() {
    return {
      locked: false,
      lockedAt: null,
      lockedBy: null,
      sessions: {},
    };
  }

  function sanitizeState(candidate) {
    const state = createDefaultState();

    if (!candidate || typeof candidate !== "object") {
      return state;
    }

    state.locked = Boolean(candidate.locked);
    state.lockedAt = typeof candidate.lockedAt === "number" ? candidate.lockedAt : null;

    if (candidate.lockedBy && typeof candidate.lockedBy === "object") {
      state.lockedBy = {
        pageId: String(candidate.lockedBy.pageId || ""),
        sourceLabel: String(candidate.lockedBy.sourceLabel || ""),
        startedAt:
          typeof candidate.lockedBy.startedAt === "number" ? candidate.lockedBy.startedAt : null,
        expiresAt:
          typeof candidate.lockedBy.expiresAt === "number" ? candidate.lockedBy.expiresAt : null,
      };
    }

    if (candidate.sessions && typeof candidate.sessions === "object") {
      Object.keys(candidate.sessions).forEach((key) => {
        const session = candidate.sessions[key];

        if (!session || typeof session !== "object") {
          return;
        }

        const pageId = typeof session.pageId === "string" ? session.pageId : key;
        const startedAt = typeof session.startedAt === "number" ? session.startedAt : Date.now();
        const expiresAt =
          typeof session.expiresAt === "number" ? session.expiresAt : startedAt + 15000;

        state.sessions[pageId] = {
          pageId,
          sourceLabel:
            typeof session.sourceLabel === "string"
              ? session.sourceLabel
              : "sessione non autorizzata",
          startedAt,
          expiresAt,
          lastSeenAt:
            typeof session.lastSeenAt === "number" ? session.lastSeenAt : Date.now(),
        };
      });
    }

    return state;
  }

  function readState() {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);

      if (!raw) {
        return createDefaultState();
      }

      return sanitizeState(JSON.parse(raw));
    } catch (_) {
      return createDefaultState();
    }
  }

  function writeState(candidate) {
    const nextState = sanitizeState(candidate);

    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(nextState));
    } catch (_) {
      return nextState;
    }

    return nextState;
  }

  function normalizeState() {
    let state = readState();

    if (state.locked) {
      return state;
    }

    const sessions = Object.values(state.sessions || {});
    const now = Date.now();
    const expiredSession = sessions.find((session) => now >= session.expiresAt);

    if (!expiredSession) {
      return state;
    }

    state = writeState({
      locked: true,
      lockedAt: now,
      lockedBy: expiredSession,
      sessions: {},
    });

    return state;
  }

  function getThreatStatus() {
    const state = normalizeState();
    const sessions = Object.values(state.sessions || {});
    const nextSession = sessions.reduce((earliest, session) => {
      if (!earliest || session.expiresAt < earliest.expiresAt) {
        return session;
      }

      return earliest;
    }, null);

    return {
      locked: state.locked,
      lockedAt: state.lockedAt,
      lockedBy: state.lockedBy,
      sessions,
      active: !state.locked && sessions.length > 0,
      nextExpiry: nextSession ? nextSession.expiresAt : null,
    };
  }

  function startThreatSession({ pageId, sourceLabel, durationMs = 15000 }) {
    const state = normalizeState();

    if (state.locked || !pageId) {
      return getThreatStatus();
    }

    const now = Date.now();
    const nextState = {
      ...state,
      sessions: {
        ...state.sessions,
        [pageId]: {
          pageId,
          sourceLabel: sourceLabel || "sessione non autorizzata",
          startedAt: now,
          expiresAt: now + durationMs,
          lastSeenAt: now,
        },
      },
    };

    writeState(nextState);

    return getThreatStatus();
  }

  function heartbeatThreatSession(pageId) {
    const state = normalizeState();

    if (state.locked || !pageId || !state.sessions[pageId]) {
      return getThreatStatus();
    }

    writeState({
      ...state,
      sessions: {
        ...state.sessions,
        [pageId]: {
          ...state.sessions[pageId],
          lastSeenAt: Date.now(),
        },
      },
    });

    return getThreatStatus();
  }

  function clearThreatSession(pageId) {
    const state = normalizeState();

    if (state.locked || !pageId || !state.sessions[pageId]) {
      return getThreatStatus();
    }

    const sessions = { ...state.sessions };
    delete sessions[pageId];

    writeState({
      ...state,
      sessions,
    });

    return getThreatStatus();
  }

  function unlockSystem(code) {
    if (String(code).trim() !== "0000") {
      return false;
    }

    writeState(createDefaultState());
    return true;
  }

  window.IRNMSystemState = {
    readState,
    normalizeState,
    getThreatStatus,
    startThreatSession,
    heartbeatThreatSession,
    clearThreatSession,
    unlockSystem,
  };
})();
