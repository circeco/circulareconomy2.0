import { Injectable, signal, computed } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class SearchService {
  private readonly searchQuery = signal<string>('');

  readonly query = this.searchQuery.asReadonly();

  setQuery(value: string): void {
    this.searchQuery.set(value.trim());
  }

  clearQuery(): void {
    this.searchQuery.set('');
  }
}
