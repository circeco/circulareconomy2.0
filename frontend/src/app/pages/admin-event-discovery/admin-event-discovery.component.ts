import { CommonModule } from '@angular/common';
import { Component, computed, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { Firestore } from '@angular/fire/firestore';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from 'firebase/firestore';

import {
  jobIsActive,
  queueDiscoveryJob,
  watchDiscoveryJob,
  type DiscoveryJob,
} from '../../data/discovery-jobs';
import { FS_PATHS } from '../../data/firestore-paths';
import {
  currentLearningPeriod,
  previousLearningPeriod,
} from '../../data/osm-discovery-queries';
import {
  asSeedQueryId,
  emptyEventQueryOverlay,
  eventQueriesFromRow,
  normalizeBlockDomain,
  normalizeEventQuery,
  overlayFromCityDiscovery,
  parseEventQueryOverlay,
  parseEventQueryStats,
  parseEventQuerySuggestions,
  parseLastEventRun,
  resolveEventDiscoveryPlan,
  type EventQueryItem,
  type EventQueryOverlay,
  type EventQueryStat,
  type EventQuerySuggestion,
  type LastEventRun,
} from '../../data/event-discovery-defaults';
import { AuthService } from '../../services/auth.service';
import { CityContextService } from '../../services/city-context.service';

type AddKind = 'search' | 'seed' | 'block';
type LearningReportView = {
  period: string;
  source: 'monthly' | 'live';
  reviewed: number;
  approved: number;
  rejected: number;
  approvalRate: number;
  queryStats: EventQueryStat[];
};

@Component({
  selector: 'admin-event-discovery',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, RouterLinkActive],
  templateUrl: './admin-event-discovery.component.html',
  styleUrl: '../admin-discovery/admin-discovery.component.scss',
})
export class AdminEventDiscoveryComponent {
  private fs = inject(Firestore);
  private auth = inject(AuthService);
  private cityContext = inject(CityContextService);
  private destroyRef = inject(DestroyRef);
  private jobUnsub: (() => void) | null = null;

  readonly globalOverlay = signal<EventQueryOverlay>(emptyEventQueryOverlay());
  readonly cityOverlay = signal<EventQueryOverlay>(emptyEventQueryOverlay());
  readonly cityDoc = signal<Record<string, unknown>>({});
  readonly suggestions = signal<ReturnType<typeof parseEventQuerySuggestions>>(
    parseEventQuerySuggestions({})
  );
  readonly report = signal<LearningReportView | null>(null);
  readonly lastEventRun = signal<LastEventRun | null>(null);
  readonly extraKeywords = signal<string[]>([]);
  readonly job = signal<DiscoveryJob | null>(null);
  readonly loading = signal(false);
  readonly loaded = signal(false);
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);
  readonly notice = signal<string | null>(null);
  readonly editingId = signal<string | null>(null);
  readonly editingKind = signal<AddKind>('search');
  readonly addKind = signal<AddKind>('search');
  readonly addToken = signal('');

  readonly running = computed(() => jobIsActive(this.job()));

  readonly plan = computed(() =>
    resolveEventDiscoveryPlan(
      this.cityContext.cityId(),
      this.globalOverlay(),
      this.cityOverlay(),
      this.cityDoc()
    )
  );

  readonly reportByQuery = computed(() => {
    const map = new Map<string, EventQueryStat>();
    for (const row of this.report()?.queryStats || []) map.set(row.id, row);
    return map;
  });

  readonly learningRows = computed(() => {
    const queryDisabled = new Set(this.plan().queries.disabledIds);
    const seedDisabled = new Set(this.plan().seeds.disabledIds);
    const blockDisabled = new Set(this.plan().blocks.disabledIds);
    const queries = this.plan().queries.catalog.map((item) => ({
      item,
      kind: 'search' as const,
      enabled: !queryDisabled.has(item.id),
      stat: this.reportByQuery().get(item.id) || null,
      yield: this.lastEventRun()?.queryYield?.[item.id] || null,
    }));
    const seeds = this.plan().seeds.catalog.map((item) => ({
      item,
      kind: 'seed' as const,
      enabled: !seedDisabled.has(item.id),
      stat: this.reportByQuery().get(item.id) || null,
      yield: this.lastEventRun()?.queryYield?.[item.id] || null,
    }));
    const blocks = this.plan().blocks.catalog.map((item) => ({
      item,
      kind: 'block' as const,
      enabled: !blockDisabled.has(item.id),
      stat: this.reportByQuery().get(item.id) || null,
      yield: this.lastEventRun()?.queryYield?.[item.id] || null,
    }));
    return [...queries, ...seeds, ...blocks];
  });

  readonly fetchRows = computed(() => this.learningRows().filter((row) => row.kind !== 'block'));
  readonly enabledCount = computed(() => this.fetchRows().filter((row) => row.enabled).length);

  constructor() {
    this.destroyRef.onDestroy(() => this.stopJobWatch());
    this.cityContext.cityId$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((cityId) => {
      this.attachJobWatch(cityId);
      this.notice.set(null);
      this.cancelEdit();
      void this.reload();
    });
  }

  cityLabel(): string {
    return this.cityContext.cityName() || this.cityContext.cityId();
  }

  percent(rate: number | undefined): string {
    if (!Number.isFinite(Number(rate))) return '—';
    return `${Math.round(Number(rate) * 100)}%`;
  }

  async reload(opts?: { quiet?: boolean }): Promise<void> {
    const cityId = this.cityContext.cityId();
    const quiet = !!opts?.quiet;
    if (!quiet) {
      this.loading.set(true);
      this.error.set(null);
    }
    try {
      let globalData: Record<string, unknown> = {};
      try {
        const globalSnap = await getDoc(
          doc(this.fs, FS_PATHS.discoveryConfig, FS_PATHS.discoveryConfigEvents)
        );
        if (globalSnap.exists()) globalData = globalSnap.data() || {};
      } catch {
        globalData = {};
      }
      this.globalOverlay.set(parseEventQueryOverlay(globalData));

      const citySnap = await getDoc(doc(this.fs, FS_PATHS.cities, cityId));
      const data = citySnap.exists() ? citySnap.data() || {} : {};
      this.cityDoc.set(data);
      this.cityOverlay.set(overlayFromCityDiscovery(data['discovery'], data));
      const discovery = data['discovery'] && typeof data['discovery'] === 'object'
        ? (data['discovery'] as Record<string, unknown>)
        : {};
      this.suggestions.set(parseEventQuerySuggestions(discovery['eventQuerySuggestions']));
      this.extraKeywords.set(
        Array.isArray(discovery['eventKeywords'])
          ? discovery['eventKeywords'].map((x) => String(x || '').trim()).filter(Boolean)
          : []
      );
      this.lastEventRun.set(parseLastEventRun(discovery['lastEventRun']));
      if (!this.lastEventRun()) {
        this.lastEventRun.set(await this.loadLastEventRunFallback(cityId));
      }
      await this.loadCityInsights(cityId);
    } catch (e) {
      this.error.set(this.errorMessage(e, 'Could not load event discovery queries.'));
    } finally {
      if (!quiet) this.loading.set(false);
      this.loaded.set(true);
    }
  }

  async runDiscovery(): Promise<void> {
    const uid = this.auth.displayUser()?.uid;
    if (!uid) {
      this.error.set('Sign in with an admin account to run discovery.');
      return;
    }
    this.error.set(null);
    this.notice.set(null);
    try {
      await queueDiscoveryJob({
        fs: this.fs,
        cityId: this.cityContext.cityId(),
        source: 'events',
        uid,
      });
      this.notice.set('Event discovery queued. It starts within a few minutes.');
    } catch (e) {
      this.error.set(this.errorMessage(e, 'Could not queue discovery.'));
    }
  }

  kindLabel(kind: AddKind): string {
    switch (kind) {
      case 'search':
        return 'Search';
      case 'seed':
        return 'Seed page';
      case 'block':
        return 'Blocked host';
      default: {
        const _never: never = kind;
        return _never;
      }
    }
  }

  startEdit(item: EventQueryItem, kind: AddKind): void {
    this.editingId.set(item.id);
    this.editingKind.set(kind);
    this.addKind.set(kind);
    switch (kind) {
      case 'seed':
        this.addToken.set(item.label);
        break;
      case 'search':
      case 'block':
        this.addToken.set(item.id);
        break;
      default: {
        const _never: never = kind;
        return _never;
      }
    }
  }

  cancelEdit(): void {
    this.editingId.set(null);
    this.editingKind.set('search');
    this.addKind.set('search');
    this.addToken.set('');
  }

  async toggleItem(item: EventQueryItem, kind: AddKind, enable: boolean): Promise<void> {
    const overlay = this.editableOverlay();
    const keys = this.keysFor(kind);
    const globalDisabled = this.globalDisabled(kind);
    if (enable) {
      overlay[keys.disabled] = overlay[keys.disabled].filter((id) => id !== item.id);
      if (globalDisabled.includes(item.id) && !overlay[keys.reenabled].includes(item.id)) {
        overlay[keys.reenabled].push(item.id);
      }
    } else {
      if (!overlay[keys.disabled].includes(item.id)) overlay[keys.disabled].push(item.id);
      overlay[keys.reenabled] = overlay[keys.reenabled].filter((id) => id !== item.id);
    }
    await this.saveOverlay(overlay, enable ? `Enabled ${item.label}` : `Disabled ${item.label}`);
  }

  async removeRow(item: EventQueryItem, kind: AddKind): Promise<void> {
    const overlay = this.editableOverlay();
    const keys = this.keysFor(kind);
    overlay[keys.extra] = overlay[keys.extra].filter((id) => id !== item.id);
    overlay[keys.reenabled] = overlay[keys.reenabled].filter((id) => id !== item.id);
    if (!overlay[keys.removed].includes(item.id)) overlay[keys.removed].push(item.id);
    if (!overlay[keys.disabled].includes(item.id)) overlay[keys.disabled].push(item.id);
    if (this.editingId() === item.id) this.cancelEdit();
    await this.saveOverlay(overlay, `Removed ${item.label}`);
  }

  async addFromForm(): Promise<void> {
    const kind = this.addKind();
    const token = this.addToken().trim();
    const overlay = this.editableOverlay();
    const originalId = this.editingId();
    const originalKind = this.editingKind();
    switch (kind) {
      case 'search': {
        const id = normalizeEventQuery(token);
        if (!id) {
          this.error.set('Search query must be 3–80 characters.');
          return;
        }
        this.applyEditedId(overlay, 'search', originalId, originalKind, id);
        break;
      }
      case 'seed': {
        const id = asSeedQueryId(token);
        if (!id) {
          this.error.set('Seed must be an http(s) URL.');
          return;
        }
        this.applyEditedId(overlay, 'seed', originalId, originalKind, id);
        break;
      }
      case 'block': {
        const id = normalizeBlockDomain(token);
        if (!id || !id.includes('.')) {
          this.error.set('Enter a host like example.com.');
          return;
        }
        this.applyEditedId(overlay, 'block', originalId, originalKind, id);
        break;
      }
      default: {
        const _never: never = kind;
        return _never;
      }
    }
    await this.saveOverlay(overlay, originalId ? `Updated ${token}` : `Added ${token}`);
    this.cancelEdit();
  }

  async applySuggestion(row: EventQuerySuggestion): Promise<void> {
    if (row.action === 'disable') {
      const item = this.plan().queries.catalog.find((c) => c.id === row.id)
        || this.plan().seeds.catalog.find((c) => c.id === row.id);
      if (!item) return;
      const kind = row.id.startsWith('seed:') ? 'seed' : 'search';
      await this.removeRow(item, kind);
      return;
    }
    const overlay = this.editableOverlay();
    if (row.id.startsWith('seed:')) {
      overlay.extraSeeds = overlay.extraSeeds.filter((id) => id !== row.id).concat(row.id);
      overlay.disabledSeeds = overlay.disabledSeeds.filter((id) => id !== row.id);
      overlay.removedSeeds = overlay.removedSeeds.filter((id) => id !== row.id);
    } else {
      const id = normalizeEventQuery(row.id);
      if (!id) {
        this.error.set(`Cannot add ${row.id}.`);
        return;
      }
      overlay.extraQueries = overlay.extraQueries.filter((q) => q !== id).concat(id);
      overlay.disabledQueries = overlay.disabledQueries.filter((q) => q !== id);
      overlay.removedQueries = overlay.removedQueries.filter((q) => q !== id);
    }
    await this.saveOverlay(overlay, `Added ${row.id}`);
  }

  setAddKind(kind: string): void {
    switch (kind) {
      case 'search':
      case 'seed':
      case 'block':
        this.addKind.set(kind);
        return;
      default:
        this.addKind.set('search');
    }
  }

  setAddToken(token: string): void {
    this.addToken.set(token);
  }

  addPlaceholder(): string {
    const kind = this.addKind();
    switch (kind) {
      case 'seed':
        return 'https://example.com/events';
      case 'block':
        return 'example.com';
      case 'search':
        return 'bytfest Stockholm';
      default: {
        const _never: never = kind;
        return _never;
      }
    }
  }

  addTokenCaption(): string {
    const kind = this.addKind();
    switch (kind) {
      case 'seed':
        return 'URL';
      case 'block':
        return 'Host';
      case 'search':
        return 'Query';
      default: {
        const _never: never = kind;
        return _never;
      }
    }
  }

  private attachJobWatch(cityId: string): void {
    this.stopJobWatch();
    this.job.set(null);
    this.jobUnsub = watchDiscoveryJob(this.fs, cityId, 'events', (job) => {
      const prev = this.job();
      this.job.set(job);
      if (prev && jobIsActive(prev) && job && (job.status === 'done' || job.status === 'failed')) {
        if (job.status === 'done') this.notice.set('Event discovery finished.');
        else this.error.set(job.errorSummary || 'Event discovery failed.');
        void this.reload({ quiet: true });
      }
    });
  }

  private stopJobWatch(): void {
    this.jobUnsub?.();
    this.jobUnsub = null;
  }

  private async loadLastEventRunFallback(cityId: string): Promise<LastEventRun | null> {
    try {
      const snap = await getDocs(query(
        collection(this.fs, FS_PATHS.discoveryRuns),
        where('cityId', '==', cityId),
        limit(40)
      ));
      let best: LastEventRun | null = null;
      let bestMs = 0;
      for (const d of snap.docs) {
        const data = d.data() || {};
        const parsed = parseLastEventRun(data['events']) || parseLastEventRun(data);
        if (!parsed) continue;
        const ms = Date.parse(parsed.at) || 0;
        if (ms >= bestMs) {
          best = parsed;
          bestMs = ms;
        }
      }
      return best;
    } catch {
      return null;
    }
  }

  private async loadCityInsights(cityId: string): Promise<void> {
    const period = currentLearningPeriod();
    const report = await this.loadLearningReport(cityId, period);
    if (report?.queryStats.length) {
      this.report.set(report);
      return;
    }
    const live = await this.loadLiveReviewStats(cityId, period);
    this.report.set(report ? { ...report, queryStats: live.queryStats } : live);
  }

  private async loadLearningReport(cityId: string, period: string): Promise<LearningReportView | null> {
    for (const p of [period, previousLearningPeriod(period)]) {
      try {
        const snap = await getDoc(doc(this.fs, FS_PATHS.learningStats, `${cityId}_${p}_events`));
        if (!snap.exists()) continue;
        const data = snap.data() || {};
        const reviewed = Number(data['reviewedCount'] || 0) || 0;
        const approved = Number(data['approvedCount'] || 0) || 0;
        const rejected = Number(data['rejectedCount'] || 0) || 0;
        return {
          period: String(data['period'] || p),
          source: 'monthly',
          reviewed,
          approved,
          rejected,
          approvalRate: reviewed ? approved / reviewed : Number(data['overallApprovalRate'] || 0) || 0,
          queryStats: parseEventQueryStats(data['eventQueryStats']),
        };
      } catch {
        return null;
      }
    }
    return null;
  }

  private async loadLiveReviewStats(cityId: string, period: string): Promise<LearningReportView> {
    const col = collection(this.fs, FS_PATHS.reviewQueue);
    const empty: LearningReportView = {
      period,
      source: 'live',
      reviewed: 0,
      approved: 0,
      rejected: 0,
      approvalRate: 0,
      queryStats: [],
    };
    try {
      const [approvedSnap, rejectedSnap] = await Promise.all([
        getDocs(query(col, where('status', '==', 'approved'), where('cityId', '==', cityId), limit(300))),
        getDocs(query(col, where('status', '==', 'rejected'), where('cityId', '==', cityId), limit(300))),
      ]);
      const { startMs, endMs } = periodBounds(period);
      const byQuery = new Map<string, EventQueryStat>();
      let approved = 0;
      let rejected = 0;
      const bump = (row: Record<string, unknown>, status: 'approved' | 'rejected') => {
        if (String(row['kind'] || '') !== 'event') return;
        if (!inPeriod(reviewedAtMs(row), startMs, endMs)) return;
        if (status === 'approved') approved += 1;
        else rejected += 1;
        for (const id of eventQueriesFromRow(row)) {
          const stat = byQuery.get(id) || { id, reviewed: 0, approved: 0, rejected: 0, approvalRate: 0 };
          stat.reviewed += 1;
          if (status === 'approved') stat.approved += 1;
          else stat.rejected += 1;
          stat.approvalRate = stat.reviewed ? stat.approved / stat.reviewed : 0;
          byQuery.set(id, stat);
        }
      };
      for (const d of approvedSnap.docs) bump(d.data() || {}, 'approved');
      for (const d of rejectedSnap.docs) bump(d.data() || {}, 'rejected');
      const reviewed = approved + rejected;
      return {
        period,
        source: 'live',
        reviewed,
        approved,
        rejected,
        approvalRate: reviewed ? approved / reviewed : 0,
        queryStats: [...byQuery.values()].sort((a, b) => b.reviewed - a.reviewed || a.id.localeCompare(b.id)),
      };
    } catch {
      return empty;
    }
  }

  private keysFor(kind: AddKind): {
    extra: 'extraQueries' | 'extraSeeds' | 'extraBlockDomains';
    disabled: 'disabledQueries' | 'disabledSeeds' | 'disabledBlockDomains';
    reenabled: 'reenabledQueries' | 'reenabledSeeds' | 'reenabledBlockDomains';
    removed: 'removedQueries' | 'removedSeeds' | 'removedBlockDomains';
  } {
    switch (kind) {
      case 'search':
        return { extra: 'extraQueries', disabled: 'disabledQueries', reenabled: 'reenabledQueries', removed: 'removedQueries' };
      case 'seed':
        return { extra: 'extraSeeds', disabled: 'disabledSeeds', reenabled: 'reenabledSeeds', removed: 'removedSeeds' };
      case 'block':
        return { extra: 'extraBlockDomains', disabled: 'disabledBlockDomains', reenabled: 'reenabledBlockDomains', removed: 'removedBlockDomains' };
      default: {
        const _never: never = kind;
        return _never;
      }
    }
  }

  private globalDisabled(kind: AddKind): string[] {
    switch (kind) {
      case 'search':
        return this.globalOverlay().disabledQueries;
      case 'seed':
        return this.globalOverlay().disabledSeeds;
      case 'block':
        return this.globalOverlay().disabledBlockDomains;
      default: {
        const _never: never = kind;
        return _never;
      }
    }
  }

  private applyEditedId(
    overlay: EventQueryOverlay,
    kind: AddKind,
    originalId: string | null,
    originalKind: AddKind,
    id: string
  ): void {
    const keys = this.keysFor(kind);
    if (originalId && originalKind === kind && originalId !== id) {
      overlay[keys.extra] = overlay[keys.extra].filter((q) => q !== originalId);
      overlay[keys.reenabled] = overlay[keys.reenabled].filter((q) => q !== originalId);
      if (!overlay[keys.removed].includes(originalId)) overlay[keys.removed].push(originalId);
      if (!overlay[keys.disabled].includes(originalId)) overlay[keys.disabled].push(originalId);
    }
    overlay[keys.extra] = overlay[keys.extra].filter((q) => q !== id).concat(id);
    overlay[keys.disabled] = overlay[keys.disabled].filter((q) => q !== id);
    overlay[keys.removed] = overlay[keys.removed].filter((q) => q !== id);
  }

  private editableOverlay(): EventQueryOverlay {
    const src = this.cityOverlay();
    return {
      extraQueries: [...src.extraQueries],
      disabledQueries: [...src.disabledQueries],
      reenabledQueries: [...src.reenabledQueries],
      removedQueries: [...src.removedQueries],
      extraSeeds: [...src.extraSeeds],
      disabledSeeds: [...src.disabledSeeds],
      reenabledSeeds: [...src.reenabledSeeds],
      removedSeeds: [...src.removedSeeds],
      extraBlockDomains: [...src.extraBlockDomains],
      disabledBlockDomains: [...src.disabledBlockDomains],
      reenabledBlockDomains: [...src.reenabledBlockDomains],
      removedBlockDomains: [...src.removedBlockDomains],
      queryPenalties: { ...src.queryPenalties },
    };
  }

  private async saveOverlay(overlay: EventQueryOverlay, okMessage: string): Promise<void> {
    this.saving.set(true);
    this.error.set(null);
    this.notice.set(null);
    try {
      await updateDoc(doc(this.fs, FS_PATHS.cities, this.cityContext.cityId()), {
        'discovery.eventQueryConfig.extraQueries': overlay.extraQueries,
        'discovery.eventQueryConfig.disabledQueries': overlay.disabledQueries,
        'discovery.eventQueryConfig.reenabledQueries': overlay.reenabledQueries,
        'discovery.eventQueryConfig.removedQueries': overlay.removedQueries,
        'discovery.eventSeedConfig.extraSeeds': overlay.extraSeeds,
        'discovery.eventSeedConfig.disabledSeeds': overlay.disabledSeeds,
        'discovery.eventSeedConfig.reenabledSeeds': overlay.reenabledSeeds,
        'discovery.eventSeedConfig.removedSeeds': overlay.removedSeeds,
        'discovery.eventBlockConfig.extraBlockDomains': overlay.extraBlockDomains,
        'discovery.eventBlockConfig.disabledBlockDomains': overlay.disabledBlockDomains,
        'discovery.eventBlockConfig.reenabledBlockDomains': overlay.reenabledBlockDomains,
        'discovery.eventBlockConfig.removedBlockDomains': overlay.removedBlockDomains,
        'discovery.eventBlockDomains': overlay.extraBlockDomains,
        updatedAt: serverTimestamp(),
      });
      this.cityOverlay.set(overlay);
      this.notice.set(okMessage);
    } catch (e) {
      this.error.set(this.errorMessage(e, 'Could not save queries.'));
    } finally {
      this.saving.set(false);
    }
  }

  private errorMessage(e: unknown, fallback: string): string {
    const err = e as { message?: string; code?: string };
    if (err?.code === 'permission-denied' || String(err?.message || '').includes('permission')) {
      return 'Permission denied. Sign in with an admin account. New query config also needs deployed Firestore rules.';
    }
    return err?.message || fallback;
  }
}

function periodBounds(period: string): { startMs: number; endMs: number } {
  const [year, month] = period.split('-').map((x) => parseInt(x, 10));
  const start = Date.UTC(year, month - 1, 1);
  const end = Date.UTC(month === 12 ? year + 1 : year, month === 12 ? 0 : month, 1);
  return { startMs: start, endMs: end };
}

function reviewedAtMs(row: Record<string, unknown>): number {
  const review = row['review'] && typeof row['review'] === 'object'
    ? (row['review'] as Record<string, unknown>)
    : {};
  const raw = review['reviewedAt'] || row['updatedAt'] || row['createdAt'];
  if (!raw) return 0;
  if (typeof raw === 'string') return Date.parse(raw) || 0;
  if (typeof raw === 'object' && raw && typeof (raw as { toDate?: () => Date }).toDate === 'function') {
    return (raw as { toDate: () => Date }).toDate().getTime();
  }
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

function inPeriod(ms: number, startMs: number, endMs: number): boolean {
  return Number.isFinite(ms) && ms >= startMs && ms < endMs;
}
