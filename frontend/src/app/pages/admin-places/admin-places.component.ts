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
import type { PlaceDoc } from '../../data/models';
import { CityContextService } from '../../services/city-context.service';

type PlaceRow = PlaceDoc & { id: string };

interface PlaceEditForm {
  name: string;
  address: string;
  locationName: string;
  website: string;
  description: string;
  sectorCategoriesText: string;
  actionTagsText: string;
  latStr: string;
  lngStr: string;
}

@Component({
  selector: 'admin-places',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './admin-places.component.html',
  styleUrl: './admin-places.component.scss',
})
export class AdminPlacesComponent {
  private fs = inject(Firestore);
  private cityContext = inject(CityContextService);

  readonly rows = signal<PlaceRow[]>([]);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly searchText = signal('');
  readonly busyIds = signal<Set<string>>(new Set());
  readonly editingId = signal<string | null>(null);
  readonly editForm = signal<PlaceEditForm | null>(null);

  readonly filteredRows = computed(() => {
    const q = this.searchText().trim().toLowerCase();
    return this.rows().filter((r) => {
      if (!q) return true;
      const hay = `${r.name || ''} ${r.address || ''} ${r.website || ''} ${r.description || ''}`.toLowerCase();
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
        collection(this.fs, FS_PATHS.places),
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
          collection(this.fs, FS_PATHS.places),
          where('cityId', '==', cityId),
          where('status', '==', 'approved')
        );
        snap = await getDocs(approvedQ);
        this.error.set('Limited mode: showing approved places only (admin claim/rules not active yet).');
      }
      const nextRows = snap.docs.map((d) => ({ id: d.id, ...(d.data() as PlaceDoc) }));
      this.rows.set(nextRows);
      console.info('[admin-places] rows loaded', {
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

  openEdit(row: PlaceRow): void {
    this.editingId.set(row.id);
    const lat = row.coords?.lat;
    const lng = row.coords?.lng;
    this.editForm.set({
      name: row.name || '',
      address: row.address || '',
      locationName: row.locationName || '',
      website: row.website || '',
      description: row.description || '',
      sectorCategoriesText: this.displaySectorCategories(row.sectorCategories).join(', '),
      actionTagsText: (row.actionTags || []).join(', '),
      latStr: lat != null && isFinite(lat) ? String(lat) : '',
      lngStr: lng != null && isFinite(lng) ? String(lng) : '',
    });
  }

  closeEdit(): void {
    this.editingId.set(null);
    this.editForm.set(null);
  }

  async saveEdit(row: PlaceRow): Promise<void> {
    const form = this.editForm();
    if (!form || this.editingId() !== row.id) return;
    await this.runRowOp(row.id, async () => {
      const lat = Number(form.latStr);
      const lng = Number(form.lngStr);
      const payload: Record<string, unknown> = {
        name: form.name.trim(),
        address: form.address.trim(),
        locationName: form.locationName.trim(),
        website: form.website.trim(),
        description: form.description.trim(),
        sectorCategories: this.normalizeSectorCategories(this.splitCsv(form.sectorCategoriesText)),
        actionTags: this.splitCsv(form.actionTagsText),
        status: 'approved',
        updatedAt: serverTimestamp(),
      };
      if (isFinite(lat) && isFinite(lng)) payload['coords'] = { lat, lng };
      await updateDoc(doc(this.fs, FS_PATHS.places, row.id), payload as any);
      const next = this.rows().map((r) =>
        r.id === row.id
          ? ({
              ...r,
              ...payload,
              coords: payload['coords'] as PlaceDoc['coords'] | undefined,
              sectorCategories: payload['sectorCategories'] as string[],
              actionTags: payload['actionTags'] as PlaceDoc['actionTags'],
            } as PlaceRow)
          : r
      );
      this.rows.set(next);
      this.closeEdit();
    });
  }

  async remove(row: PlaceRow): Promise<void> {
    const ok = window.confirm(`Delete place "${row.name}"? This cannot be undone.`);
    if (!ok) return;
    await this.runRowOp(row.id, async () => {
      await deleteDoc(doc(this.fs, FS_PATHS.places, row.id));
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

  showList(v: unknown): string[] {
    if (!Array.isArray(v)) return [];
    return v
      .map((x) => String(x || '').trim())
      .filter(Boolean);
  }

  displaySectorCategories(v: unknown): string[] {
    return this.showList(v)
      .map((x) =>
        x
          .replace(/^shop:/i, '')
          .replace(/^amenity:/i, '')
          .replace(/^craft:/i, '')
          .trim()
      )
      .filter(Boolean);
  }

  private normalizeSectorCategories(values: string[]): string[] {
    const out: string[] = [];
    for (const raw of values) {
      const cleaned = String(raw || '')
        .replace(/^shop:/i, '')
        .replace(/^amenity:/i, '')
        .replace(/^craft:/i, '')
        .toLowerCase()
        .trim();
      if (cleaned && !out.includes(cleaned)) out.push(cleaned);
    }
    return out;
  }

  private isPermissionDenied(e: unknown): boolean {
    const msg = e instanceof Error ? e.message : String(e);
    return msg.includes('permission-denied') || msg.includes('Missing or insufficient permissions');
  }
}

