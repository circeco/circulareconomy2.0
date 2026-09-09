import { ComponentFixture, TestBed } from '@angular/core/testing';

import { CalendarComponent } from './calendar.component';

describe('CalendarComponent', () => {
  let component: CalendarComponent;
  let fixture: ComponentFixture<CalendarComponent>;
  let emitted: Date[][];

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CalendarComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(CalendarComponent);
    component = fixture.componentInstance;
    emitted = [];
    component.selectedDatesChange.subscribe((dates) => emitted.push(dates));
    fixture.componentRef.setInput('initialViewDate', new Date(2026, 8, 1));
    fixture.componentRef.setInput('eventDates', [
      new Date(2026, 8, 15),
      new Date(2026, 8, 20),
    ]);
    fixture.detectChanges();
  });

  function selectedDays(): number[] {
    return component.getSelectedDates().map((d) => d.getDate()).sort((a, b) => a - b);
  }

  it('ignores days that have no events', () => {
    component.toggleDate(1);
    expect(selectedDays()).toEqual([]);
    expect(emitted.length).toBe(0);
  });

  it('selects one event day, replaces it, and toggles off', () => {
    component.toggleDate(15);
    expect(selectedDays()).toEqual([15]);

    component.toggleDate(20);
    expect(selectedDays()).toEqual([20]);

    component.toggleDate(20);
    expect(selectedDays()).toEqual([]);
  });

  it('keeps a selected Saturday on the same fill as other selected days', () => {
    fixture.componentRef.setInput('eventDates', [
      new Date(2026, 8, 15),
      new Date(2026, 8, 19),
    ]);
    fixture.detectChanges();

    component.toggleDate(19);
    fixture.detectChanges();

    const saturday = fixture.nativeElement.querySelector('.calendar-day.selected') as HTMLElement;
    expect(saturday?.textContent?.trim()).toBe('19');
    const styles = getComputedStyle(saturday);
    expect(styles.backgroundColor).not.toBe('rgb(255, 82, 82)');
    expect(styles.borderTopColor).toBe('rgb(255, 82, 82)');
  });
});
