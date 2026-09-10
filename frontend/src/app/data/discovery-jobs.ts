import { Firestore } from '@angular/fire/firestore';
import {
  doc,
  onSnapshot,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore';

import { FS_PATHS } from './firestore-paths';

export type DiscoveryJobSource = 'places' | 'events';
export type DiscoveryJobStatus = 'queued' | 'running' | 'done' | 'failed';

export type DiscoveryJob = {
  id: string;
  cityId: string;
  source: DiscoveryJobSource;
  status: DiscoveryJobStatus;
  radiusM: number;
  requestedBy: string;
  errorSummary: string;
  requestedAtMs: number;
};

export function discoveryJobId(cityId: string, source: DiscoveryJobSource): string {
  return `${cityId}_${source}`;
}

export function parseDiscoveryJob(id: string, raw: unknown): DiscoveryJob | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const cityId = String(r['cityId'] || '').trim();
  const source = r['source'] === 'events' ? 'events' : r['source'] === 'places' ? 'places' : null;
  const statusRaw = String(r['status'] || '').trim();
  const status: DiscoveryJobStatus | null =
    statusRaw === 'queued' || statusRaw === 'running' || statusRaw === 'done' || statusRaw === 'failed'
      ? statusRaw
      : null;
  if (!cityId || !source || !status) return null;
  const requestedAt = r['requestedAt'];
  let requestedAtMs = 0;
  if (typeof requestedAt === 'string') requestedAtMs = Date.parse(requestedAt) || 0;
  else if (requestedAt && typeof requestedAt === 'object' && typeof (requestedAt as { toMillis?: () => number }).toMillis === 'function') {
    requestedAtMs = (requestedAt as { toMillis: () => number }).toMillis();
  }
  return {
    id,
    cityId,
    source,
    status,
    radiusM: Number(r['radiusM'] || 0) || 0,
    requestedBy: String(r['requestedBy'] || '').trim(),
    errorSummary: String(r['errorSummary'] || '').trim(),
    requestedAtMs,
  };
}

export function watchDiscoveryJob(
  fs: Firestore,
  cityId: string,
  source: DiscoveryJobSource,
  onJob: (job: DiscoveryJob | null) => void
): () => void {
  const id = discoveryJobId(cityId, source);
  return onSnapshot(
    doc(fs, FS_PATHS.discoveryJobs, id),
    (snap) => {
      onJob(snap.exists() ? parseDiscoveryJob(snap.id, snap.data()) : null);
    },
    () => onJob(null)
  );
}

export async function queueDiscoveryJob(args: {
  fs: Firestore;
  cityId: string;
  source: DiscoveryJobSource;
  radiusM?: number;
  uid: string;
}): Promise<string> {
  const id = discoveryJobId(args.cityId, args.source);
  await setDoc(
    doc(args.fs, FS_PATHS.discoveryJobs, id),
    {
      cityId: args.cityId,
      source: args.source,
      status: 'queued',
      radiusM: Number(args.radiusM || 0) || 0,
      requestedBy: args.uid,
      errorSummary: '',
      requestedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
  return id;
}

export function jobIsActive(job: DiscoveryJob | null): boolean {
  return !!job && (job.status === 'queued' || job.status === 'running');
}
