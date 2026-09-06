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
import type { LatLng, PlaceDoc } from '../../data/models';
import { CityContextService } from '../../services/city-context.service';
import {
  ACTION_TAG_LABELS,
  ACTION_TAGS,
  canonicalizeActionTags,
  canonicalizeSectorCategories,
  SECTOR_CATEGORIES,
  SECTOR_CATEGORY_LABELS,
} from '../../data/taxonomy';
import { geocodeAddress } from '../../utils/geocode-address';
import { websiteDisplayLabel } from '../../utils/website-display';

type PlaceRow = PlaceDoc & { id: string };

interface PlaceEditForm {
  name: string;
  address: string;
  locationName: string;
  website: string;
  websiteLabel: string;
  description: string;
  sectorCategories: string[];
  actionTags: string[];
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
  readonly sectorOptions = SECTOR_CATEGORIES.slice();
  readonly actionTagOptions = ACTION_TAGS.slice();
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
      const hay = `${r.name || ''} ${r.address || ''} ${r.website || ''} ${r.websiteLabel || ''} ${r.description || ''}`.toLowerCase();
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
      websiteLabel: row.websiteLabel || '',
      description: row.description || '',
      sectorCategories: canonicalizeSectorCategories(this.showList(row.sectorCategories)),
      actionTags: canonicalizeActionTags(this.showList(row.actionTags)),
      latStr: lat != null && isFinite(lat) ? String(lat) : '',
      lngStr: lng != null && isFinite(lng) ? String(lng) : '',
    });
  }

  linkDisplayLabel(website?: string, websiteLabel?: string): string {
    return websiteDisplayLabel(website, websiteLabel);
  }

  closeEdit(): void {
    this.editingId.set(null);
    this.editForm.set(null);
  }

  async saveEdit(row: PlaceRow): Promise<void> {
    const form = this.editForm();
    if (!form || this.editingId() !== row.id) return;
    await this.runRowOp(row.id, async () => {
      const name = form.name.trim();
      const address = form.address.trim();
      if (!address) {
        this.error.set('Address is required to derive coordinates.');
        return;
      }

      const coords = await this.resolveCoordsFromAddress({
        cityId: this.cityId(),
        address,
        name,
        latStr: form.latStr,
        lngStr: form.lngStr,
      });
      if (!coords) {
        this.error.set('Could not derive coordinates from address. Please add latitude/longitude.');
        return;
      }

      this.editForm.set({ ...form, latStr: String(coords.lat), lngStr: String(coords.lng) });

      const payload: Record<string, unknown> = {
        name,
        address,
        locationName: form.locationName.trim(),
        website: form.website.trim(),
        websiteLabel: form.websiteLabel.trim(),
        description: form.description.trim(),
        sectorCategories: canonicalizeSectorCategories(form.sectorCategories),
        actionTags: canonicalizeActionTags(form.actionTags),
        coords,
        status: 'approved',
        updatedAt: serverTimestamp(),
      };
      await updateDoc(doc(this.fs, FS_PATHS.places, row.id), payload as any);
      const next = this.rows().map((r) =>
        r.id === row.id
          ? ({
              ...r,
              ...payload,
              coords,
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

  showList(v: unknown): string[] {
    if (!Array.isArray(v)) return [];
    return v
      .map((x) => String(x || '').trim())
      .filter(Boolean);
  }

  displaySectorCategories(v: unknown): string[] {
    return canonicalizeSectorCategories(this.showList(v)).map((s) => SECTOR_CATEGORY_LABELS[s]);
  }

  displayActionTags(v: unknown): string[] {
    return canonicalizeActionTags(this.showList(v)).map((t) => ACTION_TAG_LABELS[t]);
  }

  sectorLabel(id: string): string {
    return SECTOR_CATEGORY_LABELS[id as keyof typeof SECTOR_CATEGORY_LABELS] || id;
  }

  actionTagLabel(id: string): string {
    return ACTION_TAG_LABELS[id as keyof typeof ACTION_TAG_LABELS] || id;
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

  private isPermissionDenied(e: unknown): boolean {
    const msg = e instanceof Error ? e.message : String(e);
    return msg.includes('permission-denied') || msg.includes('Missing or insufficient permissions');
  }

  /**
   * Prefer geocoding from the edited address; fall back to explicit lat/lng if geocode fails.
   */
  private async resolveCoordsFromAddress(args: {
    cityId: string;
    address: string;
    name: string;
    latStr: string;
    lngStr: string;
  }): Promise<LatLng | null> {
    const geocoded = await geocodeAddress({
      cityId: args.cityId,
      address: args.address,
      nameHint: args.name,
      requestedWith: 'circeco-admin-places',
    });
    if (geocoded) return geocoded;

    const lat = Number(String(args.latStr || '').trim());
    const lng = Number(String(args.lngStr || '').trim());
    if (isFinite(lat) && isFinite(lng)) return { lat, lng };
    return null;
  }
}

