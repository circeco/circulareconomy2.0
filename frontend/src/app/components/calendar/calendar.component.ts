import { Component, signal, computed, output } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-calendar',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './calendar.component.html',
  styleUrls: ['./calendar.component.scss'],
})
export class CalendarComponent {
  selectedDatesChange = output<Date[]>();

  private readonly _viewDate = signal(new Date());
  private readonly _selectedDates = signal<Set<number>>(new Set());

  readonly viewDate = this._viewDate.asReadonly();
  readonly selectedDates = this._selectedDates.asReadonly();

  readonly monthYear = computed(() => {
    const d = this._viewDate();
    return d.toLocaleString('default', { month: 'long', year: 'numeric' });
  });

  readonly weeks = computed(() => {
    const d = this._viewDate();
    const year = d.getFullYear();
    const month = d.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const startPad = firstDay.getDay();
    const daysInMonth = lastDay.getDate();

    const days: (number | null)[] = [];
    for (let i = 0; i < startPad; i++) {
      days.push(null);
    }
    for (let i = 1; i <= daysInMonth; i++) {
      days.push(i);
    }
    const weeks: (number | null)[][] = [];
    for (let i = 0; i < days.length; i += 7) {
      weeks.push(days.slice(i, i + 7));
    }
    return weeks;
  });

  prevMonth(): void {
    const d = new Date(this._viewDate());
    d.setMonth(d.getMonth() - 1);
    this._viewDate.set(d);
  }

  nextMonth(): void {
    const d = new Date(this._viewDate());
    d.setMonth(d.getMonth() + 1);
    this._viewDate.set(d);
  }

  toggleDate(day: number | null): void {
    if (day === null) return;
    const d = this._viewDate();
    const key = new Date(d.getFullYear(), d.getMonth(), day).getTime();
    const set = new Set(this._selectedDates());
    if (set.has(key)) {
      set.delete(key);
    } else {
      set.add(key);
    }
    this._selectedDates.set(set);
    this.selectedDatesChange.emit(this.getSelectedDates());
  }

  isSelected(day: number | null): day is number {
    if (day === null) return false;
    const d = this._viewDate();
    const key = new Date(d.getFullYear(), d.getMonth(), day).getTime();
    return this._selectedDates().has(key);
  }

  getSelectedDates(): Date[] {
    return Array.from(this._selectedDates()).map((t) => new Date(t));
  }

  clearSelection(): void {
    this._selectedDates.set(new Set());
  }

  setSelectedDates(dates: Date[]): void {
    this._selectedDates.set(new Set(dates.map((d) => d.getTime())));
  }
}
