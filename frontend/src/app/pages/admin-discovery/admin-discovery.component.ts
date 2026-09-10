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
  DEFAULT_OSM_CLAUSES,
  OSM_AND_KEY_LABELS,
  OSM_AND_KEYS,
  OSM_AND_SHOP_VALUES,
  OSM_CLAUSE_KEYS,
  OSM_LOCAL_RADIUS_M,
  OSM_RADIUS_KM_OPTIONS,
  clausesFromQueueRow,
  currentLearningPeriod,
  normalizeOsmClause,
  overlayFromCityDiscovery,
  parseLastPlaceRun,
  parseOsmClauseStats,
  parseOsmQueryOverlay,
  parseOsmQuerySuggestions,
  previousLearningPeriod,
  radiusKmFromM,
  radiusMFromKm,
  resolveOsmClauses,
  type LastPlaceRun,
  type OsmAndKey,
  type OsmClause,
  type OsmClauseKind,
  type OsmClauseStat,
  type OsmQueryOverlay,
  type OsmQuerySuggestion,
} from '../../data/osm-discovery-queries';
import { AuthService } from '../../services/auth.service';
import { CityContextService } from '../../services/city-context.service';

type DraftForm = {
  kind: OsmClauseKind;
  key: string;
  token: string;
  andKey: OsmAndKey;
};

type LearningReportView = {
  period: string;
  source: 'monthly' | 'live';
  reviewed: number;
  approved: number;
  rejected: number;
  approvalRate: number;
  clauseStats: OsmClauseStat[];
};

@Component({
  selector: 'admin-discovery',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, RouterLinkActive],
  templateUrl: './admin-discovery.component.html',
  styleUrl: './admin-discovery.component.scss',
})
export class AdminDiscoveryComponent {
  readonly clauseKeys = OSM_CLAUSE_KEYS.slice();
  readonly shopValues = OSM_AND_SHOP_VALUES.slice();
  readonly andKeys = OSM_AND_KEYS.slice();
  readonly andKeyLabels = OSM_AND_KEY_LABELS;
  readonly radiusOptions = OSM_RADIUS_KM_OPTIONS;

  private fs = inject(Firestore);
  private auth = inject(AuthService);
  private cityContext = inject(CityContextService);
  private destroyRef = inject(DestroyRef);
  private jobUnsub: (() => void) | null = null;

  readonly globalOverlay = signal<OsmQueryOverlay>(parseOsmQueryOverlay({}));
  readonly cityOverlay = signal<OsmQueryOverlay>(parseOsmQueryOverlay({}));
  readonly suggestions = signal<ReturnType<typeof parseOsmQuerySuggestions>>(
    parseOsmQuerySuggestions({})
  );
  readonly report = signal<LearningReportView | null>(null);
  readonly lastPlaceRun = signal<LastPlaceRun | null>(null);
  readonly searchCenter = signal<{ lat: number; lng: number } | null>(null);
  readonly radiusKm = signal(radiusKmFromM(OSM_LOCAL_RADIUS_M));
  readonly job = signal<DiscoveryJob | null>(null);
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);
  readonly notice = signal<string | null>(null);
  readonly editingId = signal<string | null>(null);
  readonly addForm = signal<DraftForm>({ kind: 'tag', key: 'shop', token: '', andKey: 'second_hand' });

  readonly running = computed(() => jobIsActive(this.job()));

  readonly resolved = computed(() =>
    resolveOsmClauses(this.globalOverlay(), this.cityOverlay())
  );

  readonly reportByClause = computed(() => {
    const map = new Map<string, OsmClauseStat>();
    for (const row of this.report()?.clauseStats || []) map.set(row.id, row);
    return map;
  });

  readonly learningRows = computed(() => {
    const disabled = new Set(this.resolved().disabledIds);
    return this.resolved().catalog.map((clause) => ({
      clause,
      enabled: !disabled.has(clause.id),
      stat: this.reportByClause().get(clause.id) || null,
      yield: this.lastPlaceRun()?.clauseYield?.[clause.id] || null,
    }));
  });

  readonly enabledCount = computed(() => this.learningRows().filter((row) => row.enabled).length);

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

  async reload(): Promise<void> {
    const cityId = this.cityContext.cityId();
    this.loading.set(true);
    this.error.set(null);
    try {
      let globalData: Record<string, unknown> = {};
      try {
        const globalSnap = await getDoc(
          doc(this.fs, FS_PATHS.discoveryConfig, FS_PATHS.discoveryConfigOsmPlaces)
        );
        if (globalSnap.exists()) globalData = globalSnap.data() || {};
      } catch {
        globalData = {};
      }
      this.globalOverlay.set(parseOsmQueryOverlay(globalData));

      const citySnap = await getDoc(doc(this.fs, FS_PATHS.cities, cityId));
      const data = citySnap.exists() ? citySnap.data() || {} : {};
      this.cityOverlay.set(overlayFromCityDiscovery(data['discovery']));
      this.suggestions.set(parseOsmQuerySuggestions(
        data['discovery'] && typeof data['discovery'] === 'object'
          ? (data['discovery'] as Record<string, unknown>)['osmQuerySuggestions']
          : {}
      ));
      const discovery = data['discovery'] && typeof data['discovery'] === 'object'
        ? (data['discovery'] as Record<string, unknown>)
        : {};
      const center = data['center'] && typeof data['center'] === 'object'
        ? (data['center'] as Record<string, unknown>)
        : {};
      const lat = Number(center['lat']);
      const lng = Number(center['lng']);
      this.searchCenter.set(Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null);
      this.radiusKm.set(snapRadiusKm(Number(discovery['radiusM']) || OSM_LOCAL_RADIUS_M));
      this.lastPlaceRun.set(parseLastPlaceRun(discovery['lastPlaceRun']));
      if (!this.lastPlaceRun()) {
        this.lastPlaceRun.set(await this.loadLastPlaceRunFallback(cityId));
      }
      await this.loadCityInsights(cityId);
    } catch (e) {
      this.error.set(this.errorMessage(e, 'Could not load discovery queries.'));
    } finally {
      this.loading.set(false);
    }
  }

  async setRadiusKm(km: number): Promise<void> {
    const next = snapRadiusKm(radiusMFromKm(km));
    const prev = this.radiusKm();
    if (next === prev) return;
    this.radiusKm.set(next);
    this.saving.set(true);
    this.error.set(null);
    try {
      await updateDoc(doc(this.fs, FS_PATHS.cities, this.cityContext.cityId()), {
        'discovery.radiusM': radiusMFromKm(next),
        updatedAt: serverTimestamp(),
      });
    } catch (e) {
      this.radiusKm.set(prev);
      this.error.set(this.errorMessage(e, 'Could not save radius.'));
    } finally {
      this.saving.set(false);
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
        source: 'places',
        radiusM: radiusMFromKm(this.radiusKm()),
        uid,
      });
      this.notice.set('Place discovery queued. It starts within a few minutes.');
    } catch (e) {
      this.error.set(this.errorMessage(e, 'Could not queue discovery.'));
    }
  }

  startEdit(clause: OsmClause): void {
    this.editingId.set(clause.id);
    this.addForm.set({
      kind: clause.kind,
      key: clause.key,
      token: clause.kind === 'name_regex' ? String(clause.pattern || '') : String(clause.value || ''),
      andKey: this.formAndKey(clause.andKey || 'second_hand'),
    });
  }

  cancelEdit(): void {
    this.editingId.set(null);
    this.addForm.set({ kind: 'tag', key: 'shop', token: '', andKey: 'second_hand' });
  }

  extraShopOption(): string | null {
    const form = this.addForm();
    const token = form.token.trim();
    if (form.kind !== 'and_tag' || !token || (this.shopValues as string[]).includes(token)) {
      return null;
    }
    return token;
  }

  valueLabel(): string {
    const kind = this.addForm().kind;
    switch (kind) {
      case 'name_regex':
        return 'Text in name';
      case 'and_tag':
        return 'Shop type';
      case 'tag':
        return 'Value';
      default: {
        const _never: never = kind;
        return String(_never);
      }
    }
  }

  valuePlaceholder(): string {
    const kind = this.addForm().kind;
    switch (kind) {
      case 'name_regex':
        return 'loppis';
      case 'and_tag':
        return 'clothes';
      case 'tag':
        return 'antiques';
      default: {
        const _never: never = kind;
        return String(_never);
      }
    }
  }

  async toggleClause(clause: OsmClause, enable: boolean): Promise<void> {
    const overlay = this.editableOverlay();
    if (enable) {
      overlay.disabledClauseIds = overlay.disabledClauseIds.filter((id) => id !== clause.id);
      if (this.globalOverlay().disabledClauseIds.includes(clause.id)) {
        if (!overlay.reenabledClauseIds.includes(clause.id)) overlay.reenabledClauseIds.push(clause.id);
      }
    } else {
      if (!overlay.disabledClauseIds.includes(clause.id)) overlay.disabledClauseIds.push(clause.id);
      overlay.reenabledClauseIds = overlay.reenabledClauseIds.filter((id) => id !== clause.id);
    }
    await this.saveOverlay(overlay, enable ? `Enabled ${clause.label}` : `Disabled ${clause.label}`);
  }

  async removeRow(clause: OsmClause): Promise<void> {
    const overlay = this.editableOverlay();
    overlay.extraClauses = overlay.extraClauses.filter((c) => c.id !== clause.id);
    overlay.reenabledClauseIds = overlay.reenabledClauseIds.filter((id) => id !== clause.id);
    const persists =
      clause.builtin
      || DEFAULT_OSM_CLAUSES.some((c) => c.id === clause.id)
      || this.globalOverlay().extraClauses.some((c) => c.id === clause.id);
    if (persists && !overlay.disabledClauseIds.includes(clause.id)) {
      overlay.disabledClauseIds.push(clause.id);
    }
    await this.saveOverlay(overlay, `Removed ${clause.label}`);
  }

  async addFromForm(): Promise<void> {
    const form = this.addForm();
    const kind = this.formKind(form.kind);
    const raw = this.formRaw(kind, form);
    const clause = normalizeOsmClause(raw, false);
    if (!clause) {
      this.error.set('Use shop/amenity/craft and a simple value (letters, numbers, underscore). Name contains cannot be a regex.');
      return;
    }
    const overlay = this.editableOverlay();
    const originalId = this.editingId();
    if (originalId && originalId !== clause.id) {
      overlay.extraClauses = overlay.extraClauses.filter((c) => c.id !== originalId);
      if (!overlay.disabledClauseIds.includes(originalId)) overlay.disabledClauseIds.push(originalId);
      overlay.reenabledClauseIds = overlay.reenabledClauseIds.filter((id) => id !== originalId);
    }
    overlay.extraClauses = overlay.extraClauses.filter((c) => c.id !== clause.id).concat(clause);
    overlay.disabledClauseIds = overlay.disabledClauseIds.filter((id) => id !== clause.id);
    await this.saveOverlay(overlay, originalId ? `Updated ${clause.label}` : `Added ${clause.label}`);
    this.cancelEdit();
  }

  async applySuggestion(row: OsmQuerySuggestion): Promise<void> {
    if (row.action === 'disable') {
      const clause = this.resolved().catalog.find((c) => c.id === row.id);
      if (!clause) return;
      await this.removeRow(clause);
      return;
    }
    const clause = normalizeOsmClause(
      { kind: row.kind || 'tag', key: row.key || 'shop', value: row.value || row.id.split(':')[1] },
      false
    );
    if (!clause) {
      this.error.set(`Cannot add ${row.id}.`);
      return;
    }
    const overlay = this.editableOverlay();
    overlay.extraClauses = overlay.extraClauses.filter((c) => c.id !== clause.id).concat(clause);
    await this.saveOverlay(overlay, `Added ${clause.label}`);
  }

  setAddKind(kind: string): void {
    const next = this.formKind(kind);
    this.addForm.update((f) => {
      const token = next === 'and_tag' && !(this.shopValues as string[]).includes(f.token)
        ? 'clothes'
        : f.token;
      return { ...f, kind: next, token, andKey: this.formAndKey(f.andKey) };
    });
  }

  setAddKey(key: string): void {
    this.addForm.update((f) => ({ ...f, key }));
  }

  setAddToken(token: string): void {
    this.addForm.update((f) => ({ ...f, token }));
  }

  setAddAndKey(andKey: string): void {
    this.addForm.update((f) => ({ ...f, andKey: this.formAndKey(andKey) }));
  }

  private formAndKey(key: string): OsmAndKey {
    switch (key) {
      case 'second_hand':
        return 'second_hand';
      case 'vintage':
        return 'vintage';
      case 'rental':
        return 'rental';
      case 'repair':
        return 'repair';
      default:
        return 'second_hand';
    }
  }

  private formKind(kind: string): OsmClauseKind {
    switch (kind) {
      case 'name_regex':
        return 'name_regex';
      case 'and_tag':
        return 'and_tag';
      case 'tag':
        return 'tag';
      default:
        return 'tag';
    }
  }

  private formRaw(kind: OsmClauseKind, form: DraftForm): Record<string, unknown> {
    switch (kind) {
      case 'name_regex':
        return { kind, key: form.key, pattern: form.token };
      case 'and_tag':
        return { kind, key: form.key, value: form.token, andKey: this.formAndKey(form.andKey), andValue: 'yes' };
      case 'tag':
        return { kind, key: form.key, value: form.token };
      default: {
        const _never: never = kind;
        return _never;
      }
    }
  }

  private attachJobWatch(cityId: string): void {
    this.stopJobWatch();
    this.job.set(null);
    this.jobUnsub = watchDiscoveryJob(this.fs, cityId, 'places', (job) => {
      const prev = this.job();
      this.job.set(job);
      if (prev && jobIsActive(prev) && job && (job.status === 'done' || job.status === 'failed')) {
        if (job.status === 'done') this.notice.set('Place discovery finished.');
        else this.error.set(job.errorSummary || 'Place discovery failed.');
        void this.reload();
      }
    });
  }

  private stopJobWatch(): void {
    this.jobUnsub?.();
    this.jobUnsub = null;
  }

  private async loadLastPlaceRunFallback(cityId: string): Promise<LastPlaceRun | null> {
    try {
      const snap = await getDocs(query(
        collection(this.fs, FS_PATHS.discoveryRuns),
        where('cityId', '==', cityId),
        limit(40)
      ));
      let best: LastPlaceRun | null = null;
      let bestMs = 0;
      for (const d of snap.docs) {
        const data = d.data() || {};
        const parsed = parseLastPlaceRun(data['places']) || parseLastPlaceRun(data);
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
    if (report?.clauseStats.length) {
      this.report.set(report);
      return;
    }
    const live = await this.loadLiveReviewStats(cityId, period);
    this.report.set(report ? { ...report, clauseStats: live.clauseStats } : live);
  }

  private async loadLearningReport(cityId: string, period: string): Promise<LearningReportView | null> {
    for (const p of [period, previousLearningPeriod(period)]) {
      try {
        const snap = await getDoc(doc(this.fs, FS_PATHS.learningStats, `${cityId}_${p}`));
        if (!snap.exists()) continue;
        const data = snap.data() || {};
        const reviewed = Number(data['reviewedCount'] || 0) || 0;
        const approved = Number(data['approvedCount'] || 0) || 0;
        const rejected = Number(data['rejectedCount'] || 0) || 0;
        const clauseStats = parseOsmClauseStats(data['osmClauseStats']);
        return {
          period: String(data['period'] || p),
          source: 'monthly',
          reviewed,
          approved,
          rejected,
          approvalRate: reviewed ? approved / reviewed : Number(data['overallApprovalRate'] || 0) || 0,
          clauseStats,
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
      clauseStats: [],
    };
    try {
      const [approvedSnap, rejectedSnap] = await Promise.all([
        getDocs(query(col, where('status', '==', 'approved'), where('cityId', '==', cityId), limit(300))),
        getDocs(query(col, where('status', '==', 'rejected'), where('cityId', '==', cityId), limit(300))),
      ]);
      const { startMs, endMs } = periodBounds(period);
      const byClause = new Map<string, OsmClauseStat>();
      let approved = 0;
      let rejected = 0;
      const bump = (row: Record<string, unknown>, status: 'approved' | 'rejected') => {
        if (String(row['kind'] || '') !== 'place') return;
        if (!inPeriod(reviewedAtMs(row), startMs, endMs)) return;
        if (status === 'approved') approved += 1;
        else rejected += 1;
        const ids = clausesFromQueueRow(row);
        for (const id of ids) {
          const stat = byClause.get(id) || { id, reviewed: 0, approved: 0, rejected: 0, approvalRate: 0 };
          stat.reviewed += 1;
          if (status === 'approved') stat.approved += 1;
          else stat.rejected += 1;
          stat.approvalRate = stat.reviewed ? stat.approved / stat.reviewed : 0;
          byClause.set(id, stat);
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
        clauseStats: [...byClause.values()].sort((a, b) => b.reviewed - a.reviewed || a.id.localeCompare(b.id)),
      };
    } catch {
      return empty;
    }
  }

  private editableOverlay(): OsmQueryOverlay {
    const src = this.cityOverlay();
    return {
      disabledClauseIds: [...src.disabledClauseIds],
      reenabledClauseIds: [...src.reenabledClauseIds],
      extraClauses: src.extraClauses.map((c) => ({ ...c })),
      clausePenalties: { ...src.clausePenalties },
    };
  }

  private async saveOverlay(overlay: OsmQueryOverlay, okMessage: string): Promise<void> {
    this.saving.set(true);
    this.error.set(null);
    this.notice.set(null);
    try {
      await updateDoc(doc(this.fs, FS_PATHS.cities, this.cityContext.cityId()), {
        'discovery.osmQueries.disabledClauseIds': overlay.disabledClauseIds,
        'discovery.osmQueries.reenabledClauseIds': overlay.reenabledClauseIds,
        'discovery.osmQueries.extraClauses': overlay.extraClauses.map((c) => this.clauseToFirestore(c)),
        updatedAt: serverTimestamp(),
      });
      this.notice.set(okMessage);
      await this.reload();
    } catch (e) {
      this.error.set(this.errorMessage(e, 'Could not save queries.'));
    } finally {
      this.saving.set(false);
    }
  }

  private clauseToFirestore(clause: OsmClause): Record<string, string | boolean> {
    switch (clause.kind) {
      case 'tag':
        return {
          id: clause.id,
          group: clause.group,
          kind: clause.kind,
          key: clause.key,
          value: String(clause.value || ''),
          label: clause.label,
          builtin: false,
        };
      case 'name_regex':
        return {
          id: clause.id,
          group: clause.group,
          kind: clause.kind,
          key: clause.key,
          pattern: String(clause.pattern || ''),
          label: clause.label,
          builtin: false,
        };
      case 'and_tag':
        return {
          id: clause.id,
          group: clause.group,
          kind: clause.kind,
          key: clause.key,
          value: String(clause.value || ''),
          andKey: String(clause.andKey || ''),
          andValue: String(clause.andValue || ''),
          label: clause.label,
          builtin: false,
        };
      default: {
        const _never: never = clause.kind;
        throw new Error(`Unhandled OSM clause kind: ${_never}`);
      }
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

function snapRadiusKm(meters: number): number {
  const km = radiusKmFromM(meters);
  return OSM_RADIUS_KM_OPTIONS.reduce(
    (best, option) => (Math.abs(option - km) < Math.abs(best - km) ? option : best),
    OSM_RADIUS_KM_OPTIONS[2]
  );
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
