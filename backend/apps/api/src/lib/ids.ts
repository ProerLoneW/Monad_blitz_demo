import { ulid } from 'ulid';

const pref = (p: string) => `${p}_${ulid().toLowerCase()}`;

export function newId(prefix: string): string {
  return pref(prefix);
}

export const newUserId = () => pref('usr');
export const newProfileId = () => pref('profile');
export const newMediaId = () => pref('media');
export const newNoteId = () => pref('note');
export const newNoteManifestId = () => pref('note_manifest');
export const newImpactId = () => pref('impact');
export const newEvidenceId = () => pref('evidence');
export const newCampaignId = () => pref('campaign');
export const newExpenseId = () => pref('expense');
export const newTxId = () => pref('tx');
export const newRequestId = () => `req_${ulid().toLowerCase()}`;
