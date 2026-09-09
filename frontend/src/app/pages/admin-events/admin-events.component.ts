import { CommonModule } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Firestore } from '@angular/fire/firestore';
import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';

import { FS_PATHS } from '../../data/firestore-paths';
import type { EventDoc } from '../../data/models';
import {
  DEFAULT_RECURRENCE_WINDOW_MONTHS,
  expandRecurrenceDates,
  formatEventDateLabel,
  inferRecurrenceFromDates,
  recurrenceLabel,
  weekdayNameFromIso,
  weekdayShortFromIso,
  type EventRecurrence,
  type EventRecurrenceFrequency,
} from '../../data/event-recurrence';
import { CityContextService } from '../../services/city-context.service';
import {
  ACTION_TAG_LABELS,
  ACTION_TAGS,
  canonicalizeActionTags,
  canonicalizeSectorCategories,
  SECTOR_CATEGORIES,
  SECTOR_CATEGORY_LABELS,
} from '../../data/taxonomy';

type EventRow = EventDoc & { id: string };

type EventOccurrenceRow = {
  date: string;
  time: string;
  endTime: string;
  recurrenceFrequency: EventRecurrenceFrequency;
  until: string;
};

interface EventEditForm {
  title: string;
  address: string;
  website: string;
  description: string;
  recurrenceWindowMonths: number;
  occurrenceRows: EventOccurrenceRow[];
  sectorCategories: string[];
  actionTags: string[];
}

@Component({
  selector: 'admin-events',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './admin-events.component.html',
  styleUrl: './admin-events.component.scss',
})
export class AdminEventsComponent {
  readonly sectorOptions = SECTOR_CATEGORIES.slice();
  readonly actionTagOptions = ACTION_TAGS.slice();
  private fs = inject(Firestore);
  private cityContext = inject(CityContextService);

  readonly rows = signal<EventRow[]>([]);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly searchText = signal('');
  readonly busyIds = signal<Set<string>>(new Set());
  readonly editingId = signal<string | null>(null);
  readonly editForm = signal<EventEditForm | null>(null);
  readonly creating = signal(false);
  readonly createForm = signal<EventEditForm | null>(null);
  readonly recurrenceOptions: { value: EventRecurrenceFrequency; label: string }[] = [
    { value: 'none', label: 'Does not repeat' },
    { value: 'weekly', label: 'Every week' },
    { value: 'monthly', label: 'Every month (same day)' },
    { value: 'monthly_nth', label: 'Every month (same weekday)' },
  ];
  readonly recurrenceWindowMonths = DEFAULT_RECURRENCE_WINDOW_MONTHS;

  readonly filteredRows = computed(() => {
    const q = this.searchText().trim().toLowerCase();
    const filtered = this.rows().filter((r) => {
      if (!q) return true;
      const hay = `${r.title || ''} ${r.locationText || ''} ${r.address || ''} ${r.website || ''} ${r.description || ''}`.toLowerCase();
      return hay.includes(q);
    });
    return filtered.sort((a, b) => this.compareEventRowsByDate(a, b));
  });

  constructor() {
    this.cityContext.cityId$.subscribe(() => {
      this.refresh();
    });
    queueMicrotask(() => {
      if (this.rows().length === 0 && !this.loading()) void this.refresh();
    });
  }

  cityId(): string {
    return this.cityContext.cityId();
  }

  setSearchText(value: string): void {
    this.searchText.set(value || '');
  }

  async refresh(): Promise<void> {
    this.rows.set([]);
    this.closeEdit();
    this.cancelCreate();
    await this.loadRows();
  }

  private async loadRows(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    const started = Date.now();
    try {
      const cityId = this.cityId();
      const q = query(
        collection(this.fs, FS_PATHS.events),
        where('cityId', '==', cityId),
        where('status', '==', 'approved')
      );
      let snap;
      try {
        snap = await getDocs(q);
      } catch (e) {
        if (!this.isPermissionDenied(e)) throw e;
        // Fallback for stale claims/rules: only approved rows satisfy public read rules.
        const approvedQ = query(
          collection(this.fs, FS_PATHS.events),
          where('cityId', '==', cityId),
          where('status', '==', 'approved')
        );
        snap = await getDocs(approvedQ);
        this.error.set('Limited mode: showing approved events only (admin claim/rules not active yet).');
      }
      const nextRows = snap.docs.map((d) => ({ id: d.id, ...(d.data() as EventDoc) }));
      this.rows.set(nextRows);
      console.info('[admin-events] rows loaded', {
        cityId,
        count: snap.docs.length,
        elapsedMs: Date.now() - started,
      });
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : String(e));
    } finally {
      this.loading.set(false);
    }
  }

  openCreate(): void {
    this.closeEdit();
    this.creating.set(true);
    this.createForm.set(this.emptyForm());
  }

  cancelCreate(): void {
    this.creating.set(false);
    this.createForm.set(null);
  }

  async createEvent(): Promise<void> {
    const form = this.createForm();
    if (!this.creating() || !form) return;
    const title = form.title.trim();
    const address = this.normalizeAddressDisplay(form.address);
    const occurrences = this.resolveOccurrencesFromForm(form);
    if (!title || !occurrences.length || !address) {
      this.error.set('Event requires title, at least one date, and address.');
      return;
    }
    await this.runRowOp('manual:add-event', async () => {
      const shared = this.formToSharedFields(form, address);
      const seriesId =
        occurrences.length > 1 || shared.recurrence.frequency !== 'none' ? this.newSeriesId() : '';
      const reviewedAt = new Date().toISOString();
      const batch = writeBatch(this.fs);
      const added: EventRow[] = [];
      for (const occ of occurrences) {
        const newRef = doc(collection(this.fs, FS_PATHS.events));
        const payload = this.buildEventPayload({
          cityId: this.cityId(),
          title,
          address,
          shared,
          startDate: occ.date,
          timeDisplay: occ.time || shared.timeDisplay,
          seriesId,
          reviewedAt,
        });
        batch.set(newRef, payload as Record<string, unknown>);
        added.push({ id: newRef.id, ...payload });
      }
      await batch.commit();
      this.rows.set([...added, ...this.rows()]);
      this.cancelCreate();
    });
  }

  async duplicate(row: EventRow): Promise<void> {
    await this.runRowOp(`${row.id}:duplicate`, async () => {
      const newRef = doc(collection(this.fs, FS_PATHS.events));
      const copyTitle = this.nextCopyTitle(row.title || 'Event');
      const address = String(row.address || row.locationText || '').trim();
      const payload: EventDoc = {
        cityId: row.cityId || this.cityId(),
        title: copyTitle,
        startDate: row.startDate,
        endDate: row.endDate || row.startDate,
        locationText: address,
        address,
        website: String(row.website || '').trim(),
        description: String(row.description || '').trim(),
        timeDisplay: String(row.timeDisplay || '').trim(),
        sectorCategories: canonicalizeSectorCategories(this.showList(row.sectorCategories)),
        actionTags: canonicalizeActionTags(this.showList(row.actionTags)),
        status: 'approved',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      if (row.imageUrl) payload.imageUrl = row.imageUrl;
      if (row.locationName) payload.locationName = row.locationName;
      if (row.coords) payload.coords = row.coords;
      if (row.recurrence) payload.recurrence = row.recurrence;
      if (Array.isArray(row.sourceRefs) && row.sourceRefs.length) payload.sourceRefs = [...row.sourceRefs];

      await setDoc(newRef, payload as any);
      this.rows.set([{ id: newRef.id, ...payload }, ...this.rows()]);
    });
  }

  openEdit(row: EventRow): void {
    this.cancelCreate();
    this.editingId.set(row.id);
    this.editForm.set(this.buildEventForm(row));
  }

  closeEdit(): void {
    this.editingId.set(null);
    this.editForm.set(null);
  }

  async saveEdit(row: EventRow): Promise<void> {
    const form = this.editForm();
    if (!form || this.editingId() !== row.id) return;
    const title = form.title.trim();
    const address = this.normalizeAddressDisplay(form.address);
    const occurrences = this.resolveOccurrencesFromForm(form);
    if (!title || !occurrences.length || !address) {
      this.error.set('Event requires title, at least one date, and address.');
      return;
    }
    await this.runRowOp(row.id, async () => {
      const shared = this.formToSharedFields(form, address);
      const primary = occurrences[0];
      const seriesId =
        row.seriesId ||
        (occurrences.length > 1 || shared.recurrence.frequency !== 'none' ? this.newSeriesId() : '');
      const reviewedAt = new Date().toISOString();
      const primaryPayload = this.buildEventPayload({
        cityId: row.cityId || this.cityId(),
        title,
        address,
        shared,
        startDate: primary.date,
        timeDisplay: primary.time || shared.timeDisplay,
        seriesId,
        reviewedAt,
        keepCreatedAt: true,
      });
      const updatePayload: Record<string, unknown> = { ...primaryPayload };
      delete updatePayload['createdAt'];
      await updateDoc(doc(this.fs, FS_PATHS.events, row.id), updatePayload as any);

      const extras: EventRow[] = [];
      const existingKeys = new Set(
        this.rows().map((r) => `${String(r.title || '').trim().toLowerCase()}|${String(r.startDate || '').trim()}`)
      );
      existingKeys.delete(`${String(row.title || '').trim().toLowerCase()}|${String(row.startDate || '').trim()}`);
      existingKeys.add(`${title.toLowerCase()}|${primary.date}`);

      for (const occ of occurrences.slice(1)) {
        const key = `${title.toLowerCase()}|${occ.date}`;
        if (existingKeys.has(key)) continue;
        existingKeys.add(key);
        const newRef = doc(collection(this.fs, FS_PATHS.events));
        const payload = this.buildEventPayload({
          cityId: row.cityId || this.cityId(),
          title,
          address,
          shared,
          startDate: occ.date,
          timeDisplay: occ.time || shared.timeDisplay,
          seriesId,
          reviewedAt,
        });
        await setDoc(newRef, payload as Record<string, unknown>);
        extras.push({ id: newRef.id, ...payload });
      }

      const updatedCurrent: EventRow = { ...row, ...primaryPayload, id: row.id };
      this.rows.set([updatedCurrent, ...extras, ...this.rows().filter((r) => r.id !== row.id)]);
      this.closeEdit();
    });
  }

  async remove(row: EventRow): Promise<void> {
    const ok = window.confirm(`Delete event "${row.title}"? This cannot be undone.`);
    if (!ok) return;
    await this.runRowOp(row.id, async () => {
      await deleteDoc(doc(this.fs, FS_PATHS.events, row.id));
      this.rows.set(this.rows().filter((r) => r.id !== row.id));
      if (this.editingId() === row.id) this.closeEdit();
    });
  }

  isBusy(id: string): boolean {
    return this.busyIds().has(id);
  }

  private async runRowOp(id: string, fn: () => Promise<void>): Promise<void> {
    this.error.set(null);
    const next = new Set(this.busyIds());
    next.add(id);
    this.busyIds.set(next);
    try {
      await fn();
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : String(e));
    } finally {
      const done = new Set(this.busyIds());
      done.delete(id);
      this.busyIds.set(done);
    }
  }

  sectorLabel(id: string): string {
    return SECTOR_CATEGORY_LABELS[id as keyof typeof SECTOR_CATEGORY_LABELS] || id;
  }

  actionTagLabel(id: string): string {
    return ACTION_TAG_LABELS[id as keyof typeof ACTION_TAG_LABELS] || id;
  }

  showList(v: unknown): string[] {
    if (!Array.isArray(v)) return [];
    return v.map((x) => String(x || '').trim()).filter(Boolean);
  }

  displaySectorCategories(v: unknown): string[] {
    return canonicalizeSectorCategories(this.showList(v)).map((s) => SECTOR_CATEGORY_LABELS[s]);
  }

  displayActionTags(v: unknown): string[] {
    return canonicalizeActionTags(this.showList(v)).map((t) => ACTION_TAG_LABELS[t]);
  }

  eventDateLine(row: EventRow): string {
    const date = String(row.startDate || '').trim();
    if (!date) return '(missing date)';
    const label = formatEventDateLabel(date);
    const time = this.formatTimeDisplayRangeFromRaw(row.timeDisplay || '');
    const rec = recurrenceLabel(row.recurrence, date);
    const head = time ? `${label} · ${time}` : label;
    return rec ? `${head} · ${rec}` : head;
  }

  eventAddressLine(row: EventRow): string {
    return String(row.address || row.locationText || '').trim() || '(missing address)';
  }

  isSelected(values: string[] | undefined, id: string): boolean {
    return Array.isArray(values) && values.includes(id);
  }

  toggleSelection(values: string[] | undefined, id: string, checked: boolean): string[] {
    const current = Array.isArray(values) ? values.slice() : [];
    const idx = current.indexOf(id);
    if (checked && idx === -1) current.push(id);
    if (!checked && idx !== -1) current.splice(idx, 1);
    return current;
  }

  addOccurrenceRow(form: EventEditForm): void {
    form.occurrenceRows = [
      ...form.occurrenceRows,
      { date: '', time: '', endTime: '', recurrenceFrequency: 'none', until: '' },
    ];
  }

  removeOccurrenceRow(form: EventEditForm, index: number): void {
    if (form.occurrenceRows.length <= 1) return;
    form.occurrenceRows = form.occurrenceRows.filter((_, i) => i !== index);
  }

  weekdayLabel(iso: string): string {
    return weekdayShortFromIso(iso);
  }

  recurrenceOptionLabel(value: EventRecurrenceFrequency, dateIso: string): string {
    switch (value) {
      case 'none':
        return 'Does not repeat';
      case 'weekly': {
        const day = weekdayNameFromIso(dateIso);
        return day ? `Every ${day}` : 'Every week';
      }
      case 'monthly':
        return 'Every month (same day)';
      case 'monthly_nth': {
        const day = weekdayNameFromIso(dateIso);
        if (!day) return 'Every month (same weekday)';
        return recurrenceLabel({ frequency: 'monthly_nth' }, dateIso) || `Every ${day} of the month`;
      }
      default: {
        const _exhaustive: never = value;
        return _exhaustive;
      }
    }
  }

  previewOccurrenceCount(form: EventEditForm | null): number {
    if (!form) return 0;
    return this.resolveOccurrencesFromForm(form).length;
  }

  resolveOccurrencesFromForm(form: EventEditForm): Array<{ date: string; time: string }> {
    const out: Array<{ date: string; time: string }> = [];
    const windowMonths = Number(form.recurrenceWindowMonths) || DEFAULT_RECURRENCE_WINDOW_MONTHS;
    for (const row of form.occurrenceRows || []) {
      const date = String(row.date || '').trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
      const time = this.formatTimeDisplayRange(row.time || '', row.endTime || '');
      const freq = row.recurrenceFrequency || 'none';
      if (freq === 'none') {
        out.push({ date, time });
        continue;
      }
      const expanded = expandRecurrenceDates(date, {
        frequency: freq,
        windowMonths,
        until: String(row.until || '').trim() || undefined,
      });
      for (const d of expanded) out.push({ date: d, time });
    }
    const seen = new Set<string>();
    return out.filter((o) => {
      const key = `${o.date}|${o.time}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  private parseTimeDisplayRange(raw: string): { time: string; endTime: string } {
    const s = String(raw || '').trim();
    const range = s.match(/^(\d{1,2}:\d{2})(?::\d{2})?\s*[–\-—]\s*(\d{1,2}:\d{2})(?::\d{2})?$/);
    if (range) {
      return {
        time: this.normalizeTime24h(range[1]),
        endTime: this.normalizeTime24h(range[2]),
      };
    }
    return { time: this.normalizeTime24h(s), endTime: '' };
  }

  private formatTimeDisplayRange(startRaw: string, endRaw: string): string {
    const start = this.normalizeTime24h(startRaw);
    const end = this.normalizeTime24h(endRaw);
    if (start && end) return `${start}–${end}`;
    return start || end || '';
  }

  private formatTimeDisplayRangeFromRaw(raw: string): string {
    const { time, endTime } = this.parseTimeDisplayRange(raw);
    return this.formatTimeDisplayRange(time, endTime);
  }

  private normalizeTime24h(raw: string): string {
    const s = String(raw || '').trim();
    const m = s.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
    if (!m) return '';
    const hh = Number(m[1]);
    const mm = Number(m[2]);
    if (!Number.isFinite(hh) || !Number.isFinite(mm) || hh > 23 || mm > 59) return '';
    return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  }

  private nextCopyTitle(title: string): string {
    const t = String(title || '').trim() || 'Event';
    if (/\(copy(?:\s+\d+)?\)$/i.test(t)) {
      const m = t.match(/^(.*)\(copy(?:\s+(\d+))?\)$/i);
      const stem = (m?.[1] || t).trim();
      const n = Number(m?.[2] || 1) + 1;
      return `${stem} (copy ${n})`;
    }
    return `${t} (copy)`;
  }

  private emptyForm(): EventEditForm {
    return this.buildEventForm({
      title: '',
      startDate: new Date().toISOString().slice(0, 10),
      address: '',
      website: '',
      description: '',
      timeDisplay: '',
      sectorCategories: [],
      actionTags: [],
      recurrence: { frequency: 'none', windowMonths: DEFAULT_RECURRENCE_WINDOW_MONTHS },
    });
  }

  private buildEventForm(row: Partial<EventRow>): EventEditForm {
    const dates = [...new Set([String(row.startDate || '').trim()].filter(Boolean))].sort();
    const storedFreq = row.recurrence?.frequency;
    let inferred: EventRecurrenceFrequency = 'none';
    if (storedFreq === 'none') {
      inferred = 'none';
    } else if (storedFreq === 'weekly' || storedFreq === 'monthly' || storedFreq === 'monthly_nth') {
      inferred = storedFreq;
    } else {
      inferred = inferRecurrenceFromDates(dates) || 'none';
    }
    const { time, endTime } = this.parseTimeDisplayRange(row.timeDisplay || '');
    const until = row.recurrence?.until ?? '';
    const occurrenceRows: EventOccurrenceRow[] = (dates.length ? dates : ['']).map((date, index) => ({
      date,
      time,
      endTime,
      recurrenceFrequency: index === 0 ? inferred : 'none',
      until: index === 0 ? until : '',
    }));
    if (!occurrenceRows.length) {
      occurrenceRows.push({
        date: new Date().toISOString().slice(0, 10),
        time: '',
        endTime: '',
        recurrenceFrequency: 'none',
        until: '',
      });
    }
    return {
      title: row.title || '',
      address: String(row.address || row.locationText || '').trim(),
      website: row.website || '',
      description: row.description || '',
      recurrenceWindowMonths: row.recurrence?.windowMonths ?? DEFAULT_RECURRENCE_WINDOW_MONTHS,
      occurrenceRows,
      sectorCategories: canonicalizeSectorCategories(this.showList(row.sectorCategories)),
      actionTags: canonicalizeActionTags(this.showList(row.actionTags)),
    };
  }

  private formToSharedFields(form: EventEditForm, address: string): {
    website: string;
    description: string;
    timeDisplay: string;
    sectorCategories: string[];
    actionTags: EventDoc['actionTags'];
    recurrence: EventRecurrence;
    sourceRefs: EventDoc['sourceRefs'];
  } {
    const rows = (form.occurrenceRows || []).filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(String(r.date || '').trim()));
    const primary = rows[0] || form.occurrenceRows[0];
    const recurringRow = rows.find((r) => r.recurrenceFrequency && r.recurrenceFrequency !== 'none');
    const website = this.normalizeWebsiteUrl(form.website.trim());
    return {
      website,
      description: form.description.trim(),
      timeDisplay: this.formatTimeDisplayRange(primary?.time || '', primary?.endTime || ''),
      sectorCategories: canonicalizeSectorCategories(form.sectorCategories),
      actionTags: canonicalizeActionTags(form.actionTags),
      recurrence: this.firestoreRecurrence(
        recurringRow?.recurrenceFrequency || 'none',
        Number(form.recurrenceWindowMonths) || DEFAULT_RECURRENCE_WINDOW_MONTHS,
        recurringRow?.until
      ),
      sourceRefs: website
        ? [{ sourceType: 'website', url: website, retrievedAt: new Date().toISOString() }]
        : [],
    };
  }

  private buildEventPayload(args: {
    cityId: string;
    title: string;
    address: string;
    shared: ReturnType<AdminEventsComponent['formToSharedFields']>;
    startDate: string;
    timeDisplay: string;
    seriesId: string;
    reviewedAt: string;
    keepCreatedAt?: boolean;
  }): EventDoc {
    const payload: EventDoc = {
      cityId: args.cityId,
      title: args.title,
      startDate: args.startDate,
      endDate: args.startDate,
      locationText: args.address,
      address: args.address,
      website: args.shared.website,
      description: args.shared.description,
      timeDisplay: args.timeDisplay,
      sectorCategories: args.shared.sectorCategories,
      actionTags: args.shared.actionTags,
      sourceRefs: args.shared.sourceRefs,
      recurrence: args.shared.recurrence,
      status: 'approved',
      review: { reviewedAt: args.reviewedAt },
      updatedAt: serverTimestamp(),
    };
    if (!args.keepCreatedAt) payload.createdAt = serverTimestamp();
    if (args.seriesId) payload.seriesId = args.seriesId;
    return payload;
  }

  private firestoreRecurrence(
    frequency: EventRecurrenceFrequency | string | undefined,
    windowMonths?: number,
    until?: string
  ): EventRecurrence {
    const freq = (frequency || 'none') as EventRecurrenceFrequency;
    const recurrence: EventRecurrence = {
      frequency: freq,
      windowMonths: Number(windowMonths) || DEFAULT_RECURRENCE_WINDOW_MONTHS,
    };
    const untilDay = String(until || '').trim();
    if (untilDay) recurrence.until = untilDay;
    return recurrence;
  }

  private newSeriesId(): string {
    return `series_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  }

  private normalizeAddressDisplay(v: unknown): string {
    const raw = String(v || '')
      .replace(/\s+/g, ' ')
      .replace(/\s+,/g, ',')
      .trim();
    if (!raw) return '';
    const parts = raw.split(',').map((p) => p.trim()).filter(Boolean);
    if (!parts.length) return '';
    const first = parts[0];
    const m = first.match(/^(\d+[a-zA-Z]?)\s+(.+)$/);
    if (m) parts[0] = `${m[2]} ${m[1]}`.trim().replace(/\s+/g, ' ');
    return parts.join(', ');
  }

  private normalizeWebsiteUrl(raw: string): string {
    const w = String(raw || '').trim();
    if (!w) return '';
    if (/^https?:\/\//i.test(w)) return w;
    return `https://${w.replace(/^\/\//, '')}`;
  }

  private compareEventRowsByDate(a: EventRow, b: EventRow): number {
    const da = String(a.startDate || '').trim();
    const db = String(b.startDate || '').trim();
    if (!da && !db) return (a.title || '').localeCompare(b.title || '');
    if (!da) return 1;
    if (!db) return -1;
    const cmp = da.localeCompare(db);
    if (cmp !== 0) return cmp;
    return (a.title || '').localeCompare(b.title || '');
  }

  private isPermissionDenied(e: unknown): boolean {
    const msg = e instanceof Error ? e.message : String(e);
    return msg.includes('permission-denied') || msg.includes('Missing or insufficient permissions');
  }
}

