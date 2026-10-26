import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { AuthContext } from '/src/app/providers/AuthProvider';
import { UploadManagerProvider, useUploadState } from '/src/app/providers/UploadManagerProvider';
import { ActivityMediaCard } from '/src/components/gallery/ActivityMediaCard';
import { galleriesService } from '/src/services/firestore/galleriesService';
import { stakeMembersService } from '/src/services/firestore/stakeMembersService';
import '/src/styles/base.css';
const subscriptions: { kind: string; scope: string; callback: (value: unknown) => void }[] = [];
// Unsubscribed callbacks intentionally remain deliverable: the component must
// ignore a response already queued before its cleanup.
galleriesService.subscribeGalleryByActivity = (stake, event, callback) => {
  subscriptions.push({ kind: 'gallery', scope: `${stake}/${event}`, callback: callback as never });
  return () => {};
};
galleriesService.subscribeLatestMedia = (stake, gallery, _count, callback) => {
  subscriptions.push({ kind: 'latest', scope: `${stake}/${gallery}`, callback: callback as never });
  return () => {};
};
galleriesService.ensureActivityGallery = async () => ({}) as never;
stakeMembersService.subscribeOwn = (_stake, uid, callback) => {
  callback({ uid, status: 'active', staffRole: null } as never, true);
  return () => {};
};
function Probe() {
  const state = useUploadState();
  const location = useLocation();
  return <output data-testid="queue">{state.queue.length}:{location.pathname}</output>;
}
function App() {
  const [scope, setScope] = useState({ uid: 'qa-a', stake: 'qa-a', event: 'qa-a' });
  Object.assign(window, { __galleryContext: { subscriptions, setScope } });
  const session = { isAuthenticated: true, isAnonymous: false, isAdmin: false, isParent: false,
    firebaseUser: { uid: scope.uid }, profile: { role: 'participant', stakeId: scope.stake, fullName: 'Persona QA' } };
  const event = { id: scope.event, title: 'Attività QA', startDate: new Date(Date.now() - 3600000).toISOString(), endDate: new Date(Date.now() + 3600000).toISOString() };
  return <AuthContext.Provider value={{ session, loading: false } as never}>
    <MemoryRouter><UploadManagerProvider><ActivityMediaCard stakeId={scope.stake} event={event} /><Probe /></UploadManagerProvider></MemoryRouter>
  </AuthContext.Provider>;
}
createRoot(document.getElementById('root')!).render(<App />);
