import { Component, AfterViewInit, NgZone, ElementRef, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-title',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './title.component.html',
  styleUrls: ['./title.component.scss'],
})
export class TitleComponent implements AfterViewInit {
  @ViewChild('titleList', { static: true }) titleList!: ElementRef<HTMLUListElement>;

  private revealed = false;

  constructor(private zone: NgZone) {}

  ngAfterViewInit(): void {
    // Trigger the effect when the section enters viewport
    const section = this.titleList.nativeElement.closest('#title_section') as HTMLElement | null;
    if (!section) { this.revealNow(); return; }

    this.zone.runOutsideAngular(() => {
      const io = new IntersectionObserver((entries) => {
        if (this.revealed) return;
        const e = entries[0];
        if (e?.isIntersecting) {
          this.revealed = true;
          io.disconnect();
          // Respect reduced motion
          const prefersReduced = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
          prefersReduced ? this.revealNow() : this.revealSequence();
        }
      }, { threshold: 0.4 });
      io.observe(section);
    });
  }

  private revealNow() {
    const items = Array.from(this.titleList.nativeElement.querySelectorAll('li'));
    items.forEach(li => li.classList.add('revealed'));
    this.titleList.nativeElement.classList.remove('hidden');
  }

  private revealSequence() {
    const list = this.titleList.nativeElement;
    const items = Array.from(list.querySelectorAll('li'));
    list.classList.remove('hidden');

    let i = 0;
    const step = () => {
      if (i >= items.length) return;
      items[i].classList.add('revealed');
      i += 1;
      // stagger timing (tweak to taste)
      setTimeout(step, 120);
    };
    step();
  }
}
