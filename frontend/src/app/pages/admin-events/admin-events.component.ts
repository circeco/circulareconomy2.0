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
  updateDoc,
  where,
} from 'firebase/firestore';

import { FS_PATHS } from '../../data/firestore-paths';
import type { EventDoc } from '../../data/models';
import { formatEventDateLabel } from '../../data/event-recurrence';
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

interface EventEditForm {
  title: string;
  startDate: string;
  endDate: string;
  address: string;
  website: string;
  description: string;
  timeDisplay: string;
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

  readonly filteredRows = computed(() => {
    const q = this.searchText().trim().toLowerCase();
    return this.rows().filter((r) => {
      if (!q) return true;
      const hay = `${r.title || ''} ${r.locationText || ''} ${r.address || ''} ${r.website || ''} ${r.description || ''}`.toLowerCase();
      return hay.includes(q);
    });
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
    this.editingId.set(null);
    this.editForm.set(null);
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

  openEdit(row: EventRow): void {
    const date = row.startDate || '';
    const time = this.normalizeTime24h(row.timeDisplay || '');
    this.editingId.set(row.id);
    this.editForm.set({
      title: row.title || '',
      startDate: date,
      endDate: date,
      address: String(row.address || row.locationText || '').trim(),
      website: row.website || '',
      description: row.description || '',
      timeDisplay: time,
      sectorCategories: canonicalizeSectorCategories(this.showList(row.sectorCategories)),
      actionTags: canonicalizeActionTags(this.showList(row.actionTags)),
    });
  }

  closeEdit(): void {
    this.editingId.set(null);
    this.editForm.set(null);
  }

  async saveEdit(row: EventRow): Promise<void> {
    const form = this.editForm();
    if (!form || this.editingId() !== row.id) return;
    await this.runRowOp(row.id, async () => {
      const date = form.startDate.trim();
      const address = form.address.trim();
      const payload: Record<string, unknown> = {
        title: form.title.trim(),
        startDate: date,
        endDate: date,
        locationText: address,
        address,
        website: form.website.trim(),
        description: form.description.trim(),
        timeDisplay: this.normalizeTime24h(form.timeDisplay),
        sectorCategories: canonicalizeSectorCategories(form.sectorCategories),
        actionTags: canonicalizeActionTags(form.actionTags),
        status: 'approved',
        updatedAt: serverTimestamp(),
      };
      await updateDoc(doc(this.fs, FS_PATHS.events, row.id), payload as any);
      this.rows.set(
        this.rows().map((r) =>
          r.id === row.id
            ? ({
                ...r,
                ...payload,
                sectorCategories: payload['sectorCategories'] as string[],
                actionTags: payload['actionTags'] as EventDoc['actionTags'],
              } as EventRow)
            : r
        )
      );
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
    const time = this.normalizeTime24h(row.timeDisplay || '');
    return time ? `${label} · ${time}` : label;
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

  private normalizeTime24h(raw: string): string {
    const s = String(raw || '').trim();
    if (/^\d{2}:\d{2}$/.test(s)) return s;
    if (/^\d{2}:\d{2}:\d{2}$/.test(s)) return s.slice(0, 5);
    return '';
  }

  private isPermissionDenied(e: unknown): boolean {
    const msg = e instanceof Error ? e.message : String(e);
    return msg.includes('permission-denied') || msg.includes('Missing or insufficient permissions');
  }
}

