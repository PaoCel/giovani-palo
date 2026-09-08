"""Regressione del budget espressioni e dei campi immutabili delle iscrizioni.

Eseguire solo con Firestore Emulator e un project id demo tramite
firebase emulators:exec --only firestore --project demo-registration-rules
"python3 functions/tests/registrationUpdateRules.py".
"""

import base64
import copy
import json
import os
import time
import urllib.error
import urllib.request


PROJECT = os.environ.get('GCLOUD_PROJECT', '')
HOST = os.environ.get('FIRESTORE_EMULATOR_HOST', '')
assert PROJECT.startswith('demo-'), 'A demo project is required'
assert HOST.startswith(('127.0.0.1:', 'localhost:')), 'A local emulator is required'
PREFIX = f'projects/{PROJECT}/databases/(default)/documents/'
BASE = f'http://{HOST}/v1/{PREFIX}'
EVENT = 'stakes/test-stake/activities/test-trip'


def encode(value):
    if value is None:
        return {'nullValue': None}
    if isinstance(value, bool):
        return {'booleanValue': value}
    if isinstance(value, str):
        return {'stringValue': value}
    if isinstance(value, list):
        return {'arrayValue': {'values': [encode(item) for item in value]}}
    return {'mapValue': {'fields': fields(value)}}


def fields(value):
    return {key: encode(item) for key, item in value.items()}


def token(uid):
    def b64(value):
        return base64.urlsafe_b64encode(json.dumps(value).encode()).decode().rstrip('=')
    now = int(time.time())
    return b64({'alg': 'none', 'typ': 'JWT'}) + '.' + b64({
        'sub': uid, 'user_id': uid, 'aud': PROJECT,
        'iss': f'https://securetoken.google.com/{PROJECT}',
        'iat': now, 'exp': now + 3600, 'auth_time': now,
        'firebase': {'sign_in_provider': 'password'},
    }) + '.'


def call(path, payload=None, actor='owner', method=None, expected=200):
    url = BASE.rstrip('/') + path if path.startswith(':') else BASE + path
    request = urllib.request.Request(url, data=json.dumps(payload).encode() if payload is not None else None,
        headers={'Authorization': 'Bearer ' + (actor if actor == 'owner' else token(actor)),
                 'Content-Type': 'application/json'}, method=method)
    try:
        response = urllib.request.urlopen(request, timeout=15)
        status, result = response.status, json.load(response)
    except urllib.error.HTTPError as error:
        status, result = error.code, None
    assert status == expected, f'{method or "GET"} {path}: expected {expected}, got {status}'
    return result


def save(path, value, actor='owner', expected=200):
    return call(path, {'fields': fields(value)}, actor=actor, method='PATCH', expected=expected)


profile = {
    'firstName': 'Test', 'lastName': 'Parent', 'fullName': 'Test Parent',
    'email': 'parent@example.invalid', 'birthDate': '', 'genderRoleCategory': '',
    'unitId': 'test-unit', 'unitName': 'Test Unit', 'stakeId': 'test-stake',
    'role': 'parent', 'createdAt': '2026-01-01T00:00:00.000Z',
    'updatedAt': '2026-01-01T00:00:00.000Z',
}
save('users/test-parent', profile)
save('users/test-participant', {**profile, 'role': 'participant'})
save('users/test-admin', {**profile, 'role': 'admin'})
save(EVENT, {'activityType': 'temple_trip', 'isPublic': True, 'isVisible': True, 'status': 'published'})

registration = {key: None for key in [
    'userId', 'anonymousUid', 'anonymousTokenId', 'accessCode', 'recoveryCode',
    'parentConsentDocumentName', 'parentConsentDocumentUrl', 'parentConsentDocumentPath',
    'parentConsentUploadedAt', 'consentSignatureUrl', 'consentSignaturePath', 'consentSignatureSetAt',
    'parentIdDocumentName', 'parentIdDocumentUrl', 'parentIdDocumentPath', 'parentIdUploadedAt',
    'linkedLaterToUserId', 'assignedRoomId', 'assignedTempleShiftId', 'assignedPatrolId',
    'assignedPatrolName', 'assignedPatrolRole',
]}
registration.update({
    'firstName': 'Test', 'lastName': 'Child', 'fullName': 'Test Child',
    'email': 'parent@example.invalid', 'phone': '0000000000', 'birthDate': '2014-01-01',
    'genderRoleCategory': 'giovane_donna', 'unitId': 'test-unit', 'unitNameSnapshot': 'Test Unit',
    'answers': {'transportMode': 'bus'}, 'roomPreferenceMatches': {},
    'participatingDays': ['2026-10-16'], 'recoveryPdfGenerated': False,
    'parentUid': 'test-parent', 'childId': 'test-child', 'submittedByMode': 'parent',
    'parentAuthorization': {'status': 'email_sent', 'tokenId': 'test-token'},
    'registrationStatus': 'pending_parent_authorization',
    'assignedServiceTeamIds': [], 'assignedCommittees': [],
    'createdAt': '2026-01-01T00:00:00.000Z', 'updatedAt': '2026-01-01T00:00:00.000Z',
})
path = EVENT + '/registrations/child_test-parent_test-child'
save(path, registration)
save(path, {**registration, 'phone': '1111111111'}, actor='test-parent')
call(path, actor='test-parent')
query = {'structuredQuery': {'from': [{'collectionId': 'registrations', 'allDescendants': True}],
    'where': {'fieldFilter': {'field': {'fieldPath': 'parentUid'}, 'op': 'EQUAL',
                             'value': {'stringValue': 'test-parent'}}}}}
result = call(':runQuery', query, actor='test-parent')
assert len([item for item in result if 'document' in item]) == 1
print('PASS: parent read, family query and full client save')

protected = {
    'userId': 'test-participant', 'anonymousUid': 'outsider', 'createdAt': 'changed',
    'submittedByMode': 'authenticated', 'unitId': 'other-unit',
    'assignedRoomId': 'room', 'assignedTempleShiftId': 'shift', 'assignedServiceTeamIds': ['team'],
    'linkedLaterToUserId': 'test-participant', 'parentUid': 'outsider', 'childId': 'other-child',
    'parentAuthorization': {'status': 'authorized'}, 'parentConsentDocumentPath': 'forged.pdf',
    'registrationStatus': 'confirmed',
}
for key, value in protected.items():
    save(path, {**registration, key: value}, actor='test-parent', expected=403)
for key in ['createdAt', 'parentUid', 'childId', 'parentAuthorization']:
    value = copy.deepcopy(registration)
    del value[key]
    save(path, value, actor='test-parent', expected=403)
call(path, actor='outsider', expected=403)
save(path, registration, actor='outsider', expected=403)
print('PASS: ownership, assignments, consent and protected-field removal denied')

participant = {**registration, 'userId': 'test-participant', 'parentUid': None, 'childId': None,
               'submittedByMode': 'authenticated'}
participant_path = EVENT + '/registrations/user_test-participant'
save(participant_path, participant)
save(participant_path, {**participant, 'phone': '2222222222'}, actor='test-participant')
legacy = copy.deepcopy(participant)
for key in ['parentUid', 'childId', 'parentAuthorization', 'assignedCommittees']:
    del legacy[key]
save(participant_path, legacy)
save(participant_path, {**legacy, 'parentUid': None, 'childId': None, 'assignedCommittees': []}, actor='test-participant')
save(participant_path, {**legacy, 'parentAuthorization': None}, actor='test-participant', expected=403)
save(path, {**registration, 'registrationStatus': 'cancelled'}, actor='test-parent')
save(path, {**registration, 'assignedRoomId': 'admin-room'}, actor='test-admin')
print('PASS: participant and legacy saves, parent cancellation, admin update')
