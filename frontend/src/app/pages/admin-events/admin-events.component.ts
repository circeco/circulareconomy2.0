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
import { CityContextService } from '../../services/city-context.service';

type EventRow = EventDoc & { id: string };

interface EventEditForm {
  title: string;
  startDate: string;
  endDate: string;
  locationText: string;
  address: string;
  website: string;
  description: string;
  timeDisplay: string;
  sectorCategoriesText: string;
  actionTagsText: string;
}

@Component({
  selector: 'admin-events',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './admin-events.component.html',
  styleUrl: './admin-events.component.scss',
})
export class AdminEventsComponent {
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
    this.editingId.set(row.id);
    this.editForm.set({
      title: row.title || '',
      startDate: row.startDate || '',
      endDate: row.endDate || row.startDate || '',
      locationText: row.locationText || '',
      address: row.address || '',
      website: row.website || '',
      description: row.description || '',
      timeDisplay: row.timeDisplay || '',
      sectorCategoriesText: (row.sectorCategories || []).join(', '),
      actionTagsText: (row.actionTags || []).join(', '),
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
      const payload: Record<string, unknown> = {
        title: form.title.trim(),
        startDate: form.startDate.trim(),
        endDate: form.endDate.trim() || form.startDate.trim(),
        locationText: form.locationText.trim(),
        address: form.address.trim(),
        website: form.website.trim(),
        description: form.description.trim(),
        timeDisplay: form.timeDisplay.trim(),
        sectorCategories: this.splitCsv(form.sectorCategoriesText),
        actionTags: this.splitCsv(form.actionTagsText),
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

  private splitCsv(v: string): string[] {
    return String(v || '')
      .split(/[;,]/)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  private isPermissionDenied(e: unknown): boolean {
    const msg = e instanceof Error ? e.message : String(e);
    return msg.includes('permission-denied') || msg.includes('Missing or insufficient permissions');
  }
}

