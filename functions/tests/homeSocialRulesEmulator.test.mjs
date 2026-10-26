// Synthetic data only: run with a local Firestore Emulator on a demo-* project.
import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { initializeApp, deleteApp } from 'firebase/app';
import { getFirestore, connectFirestoreEmulator, collection, doc, query, where,
  getDocsFromServer, getDocFromServer, setDoc, updateDoc, deleteDoc, writeBatch, increment } from 'firebase/firestore';
const require = createRequire(import.meta.url);
const { initializeApp: initAdmin, deleteApp: deleteAdmin } = require('firebase-admin/app');
const { getFirestore: adminFirestore } = require('firebase-admin/firestore');
const projectId = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || '';
const host = process.env.FIRESTORE_EMULATOR_HOST || '';
assert.match(projectId, /^demo-/u);
assert.match(host, /^(127\.0\.0\.1|localhost):\d+$/u);
const [hostname, port] = host.split(':');
const run = `home-${Date.now()}`;
const stake = `${run}-stake`, otherStake = `${run}-other`;
const adminApp = initAdmin({ projectId }, run);
const adb = adminFirestore(adminApp);
const clients = {};
const actors = ['member', 'admin', 'pending', 'out', 'otherstake', 'guest', 'anonymous'];
const states = {};
for (const published of [true, false]) for (const visibility of ['all_authenticated', 'gallery_members', 'admins_only']) {
  states[`${published ? 'published' : 'draft'}-${visibility}`] = { published, visibility };
}
const path = id => `stakes/${stake}/feedPosts/${id}`;
const uid = actor => `${run}-${actor}`;
const ref = (db, id, child = '') => doc(db, path(id) + child);
const posts = db => collection(db, `stakes/${stake}/feedPosts`);
const allowed = (actor, data) => actor === 'admin' || actor === 'member' && data.published && data.visibility !== 'admins_only';
const denied = promise => assert.rejects(promise, error => error.code === 'permission-denied');
async function check(promise, permit) { if (permit) return await promise; await denied(promise); }
function like(db, id, actor, remove = false) {
  const batch = writeBatch(db), target = ref(db, id, `/likes/${uid(actor)}`);
  if (remove) batch.delete(target); else batch.set(target, { uid: uid(actor), createdAt: '2026-10-26' });
  batch.update(ref(db, id), { likeCount: increment(remove ? -1 : 1) });
  return batch.commit();
}
before(async () => {
  const batch = adb.batch();
  batch.set(adb.doc(`stakes/${stake}`), { name: 'Palo sintetico' });
  batch.set(adb.doc(`stakes/${otherStake}`), { name: 'Altro palo sintetico' });
  for (const actor of actors.filter(a => a !== 'guest')) {
    batch.set(adb.doc(`users/${uid(actor)}`), { role: actor === 'admin' ? 'admin' : 'participant', stakeId: actor === 'otherstake' ? otherStake : stake });
    // Anonymous receives a forged active document to prove the provider guard.
    if (actor !== 'out') batch.set(adb.doc(`stakes/${actor === 'otherstake' ? otherStake : stake}/members/${uid(actor)}`), { status: actor === 'pending' ? 'pending' : 'active', staffRole: null });
  }
  for (const [id, state] of Object.entries(states)) {
    batch.set(adb.doc(path(id)), { ...state, title: 'Test sintetico', likeCount: 0 });
    for (const actor of actors) batch.set(adb.doc(`${path(id)}/comments/${uid(actor)}`), { uid: uid(actor), body: 'Commento sintetico', createdAt: '2026-10-26' });
  }
  await batch.commit();
  for (const actor of actors) {
    const app = initializeApp({ apiKey: 'demo-key', projectId }, uid(actor));
    const db = getFirestore(app);
    connectFirestoreEmulator(db, hostname, Number(port), actor === 'guest' ? {} : { mockUserToken: { sub: uid(actor), firebase: { sign_in_provider: actor === 'anonymous' ? 'anonymous' : 'password' } } });
    clients[actor] = { app, db };
  }
});
after(async () => {
  await Promise.all(Object.values(clients).map(c => deleteApp(c.app)));
  await adb.recursiveDelete(adb.doc(`stakes/${stake}`));
  await adb.recursiveDelete(adb.doc(`stakes/${otherStake}`));
  await Promise.all(actors.filter(a => a !== 'guest').map(a => adb.doc(`users/${uid(a)}`).delete()));
  await deleteAdmin(adminApp);
});
for (const actor of actors) {
  test(`${actor}: query client esatta, legacy e gestione`, async () => {
    const db = clients[actor].db;
    const current = query(posts(db), where('published', '==', true), where('visibility', 'in', ['all_authenticated', 'gallery_members']));
    const result = await check(getDocsFromServer(current), actor === 'member' || actor === 'admin');
    if (result) assert.deepEqual(result.docs.map(d => d.id).sort(), ['published-all_authenticated', 'published-gallery_members']);
    await check(getDocsFromServer(query(posts(db), where('published', '==', true))), actor === 'admin');
    await check(getDocsFromServer(posts(db)), actor === 'admin');
  });
  for (const [id, state] of Object.entries(states)) test(`${actor}: ${id} parent gate completo`, async () => {
    const db = clients[actor].db, permit = allowed(actor, state);
    await check(getDocFromServer(ref(db, id)), permit);
    await check(getDocFromServer(ref(db, id, `/likes/${uid(actor)}`)), permit);
    await check(getDocsFromServer(collection(db, `${path(id)}/likes`)), actor === 'admin');
    await check(getDocFromServer(ref(db, id, `/comments/${uid(actor)}`)), permit);
    await check(getDocsFromServer(collection(db, `${path(id)}/comments`)), permit);
    await check(like(db, id, actor), permit);
    if (permit) {
      assert.equal((await adb.doc(path(id)).get()).data().likeCount, 1);
      await like(db, id, actor, true);
      assert.equal((await adb.doc(path(id)).get()).data().likeCount, 0);
    }
    await check(setDoc(ref(db, id, `/comments/new-${uid(actor)}`), { uid: uid(actor), body: 'Nuovo sintetico', createdAt: '2026-10-26' }), permit);
    await check(updateDoc(ref(db, id, `/comments/${uid(actor)}`), { body: 'Aggiornato sintetico' }), permit);
    await check(deleteDoc(ref(db, id, `/comments/${uid(actor)}`)), permit);
    if (actor !== 'admin') {
      await denied(updateDoc(ref(db, id), { likeCount: 42 }));
      await denied(setDoc(ref(db, id, `/likes/${uid(actor)}`), { uid: uid(actor) }));
      await denied(updateDoc(ref(db, id), { title: 'Tentativo non autorizzato' }));
    }
  });
}
test('revoca e ritiro pubblicazione negano accesso anche con sessione già aperta', async () => {
  const db = clients.member.db, id = 'published-all_authenticated';
  await like(db, id, 'member');
  const membership = adb.doc(`stakes/${stake}/members/${uid('member')}`);
  await membership.update({ status: 'removed' });
  await denied(getDocFromServer(ref(db, id)));
  await denied(like(db, id, 'member', true));
  await membership.update({ status: 'active' });
  await adb.doc(path(id)).update({ published: false });
  await denied(getDocFromServer(ref(db, id, `/likes/${uid('member')}`)));
  await denied(like(db, id, 'member', true));
  await denied(getDocsFromServer(collection(db, `${path(id)}/comments`)));
  assert.equal((await adb.doc(path(id)).get()).data().likeCount, 1);
  await adb.doc(path(id)).update({ published: true });
  await like(db, id, 'member', true);
});
test('query nel service contiene entrambe le condizioni provate', () => {
  const source = readFileSync(new URL('../../src/services/firestore/feedService.ts', import.meta.url), 'utf8');
  const method = source.slice(source.indexOf('async listPublishedPosts'), source.indexOf('async listAllPosts'));
  assert.match(method, /where\("published", "==", true\)/u);
  assert.match(method, /where\("visibility", "in", \["all_authenticated", "gallery_members"\]\)/u);
});
