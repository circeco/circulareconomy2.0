import { FooterComponent } from '../../components/footer/footer.component';
import {
  Component,
  AfterViewInit,
  OnDestroy,
  NgZone,
  ElementRef,
  ViewChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { DEMO_VIDEO_URL } from '../../config/media';


@Component({
  selector: 'app-landing',
  standalone: true,
  imports: [CommonModule, FooterComponent],
  templateUrl: './landing.component.html',
  styleUrls: ['./landing.component.scss'],
})
export class LandingComponent implements AfterViewInit, OnDestroy {
  @ViewChild('titleList', { static: true })
  titleList!: ElementRef<HTMLUListElement>;

  private revealed = false;
  private io?: IntersectionObserver;

  constructor(
    private zone: NgZone,
    private router: Router
  ) {}

  demoUrl = DEMO_VIDEO_URL;

  ngAfterViewInit(): void {
    const section = this.titleList.nativeElement.closest(
      '#title_section'
    ) as HTMLElement | null;

    if (!section) {
      this.revealNow();
      return;
    }

    this.zone.runOutsideAngular(() => {
      this.io = new IntersectionObserver(
        (entries) => {
          if (this.revealed) return;
          const e = entries[0];
          if (e?.isIntersecting) {
            this.revealed = true;
            this.io?.disconnect();

            const prefersReduced =
              window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
            prefersReduced ? this.revealNow() : this.revealSequence();
          }
        },
        { threshold: 0.4 }
      );
      this.io.observe(section);
    });
  }

  goToMapPage() {
    this.router.navigate(['/atlas']);
  }

  ngOnDestroy(): void {
    this.io?.disconnect();
  }

  private revealNow() {
    const items = Array.from(this.titleList.nativeElement.querySelectorAll('li'));
    items.forEach((li) => li.classList.add('revealed'));
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
      setTimeout(step, 120); // stagger timing
    };
    step();
  }
}
