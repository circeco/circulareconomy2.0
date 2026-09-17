import {
  discoveryFinishedNotice,
  discoveryJobStatusCopy,
  discoveryRunButtonLabel,
  discoveryWorkerBusy,
  jobIsActive,
  queuedDiscoveryNotice,
  type DiscoveryJob,
} from './discovery-jobs';

function job(status: DiscoveryJob['status']): DiscoveryJob {
  return {
    id: 'milan_places',
    cityId: 'milan',
    source: 'places',
    status,
    radiusM: 6000,
    requestedBy: 'uid',
    errorSummary: '',
    requestedAtMs: 0,
  };
}

describe('discovery job helpers', () => {
  it('treats queued as waiting, not busy', () => {
    expect(jobIsActive(job('queued'))).toBeTrue();
    expect(discoveryWorkerBusy(job('queued'))).toBeFalse();
    expect(discoveryRunButtonLabel(job('queued'))).toBe('Queued…');
  });

  it('treats running as busy', () => {
    expect(discoveryWorkerBusy(job('running'))).toBeTrue();
    expect(discoveryRunButtonLabel(job('running'))).toBe('Running…');
  });

  it('restores the run label after done or failed', () => {
    expect(discoveryWorkerBusy(job('done'))).toBeFalse();
    expect(discoveryRunButtonLabel(job('done'))).toBe('Run discovery');
    expect(discoveryRunButtonLabel(job('failed'))).toBe('Run discovery');
    expect(discoveryRunButtonLabel(null)).toBe('Run discovery');
  });

  it('tells the admin the job was queued', () => {
    expect(queuedDiscoveryNotice('places')).toContain('Queued');
    expect(queuedDiscoveryNotice('events')).toContain('worker');
  });

  it('summarizes a finished run with counts', () => {
    expect(discoveryFinishedNotice('places', { fetchedCount: 12, queuedCount: 4 })).toContain('12');
    expect(discoveryFinishedNotice('places', { fetchedCount: 12, queuedCount: 4 })).toContain('4');
    expect(discoveryFinishedNotice('events', null)).toContain('review queue');
  });

  it('explains job status in plain language', () => {
    expect(discoveryJobStatusCopy(job('queued'))).toContain('waiting');
    expect(discoveryJobStatusCopy(job('running'))).toContain('Running');
    expect(discoveryJobStatusCopy(job('done'))).toContain('finished');
    expect(discoveryJobStatusCopy({ ...job('failed'), errorSummary: 'Overpass timeout' })).toBe('Overpass timeout');
  });
});
