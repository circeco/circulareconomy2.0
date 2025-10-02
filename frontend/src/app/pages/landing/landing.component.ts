import { FooterComponent } from '../../components/footer/footer.component';
import { Component } from '@angular/core';
import { AfterViewInit } from '@angular/core';
import { OnDestroy } from '@angular/core';
import { NgZone } from '@angular/core';
import { ElementRef } from '@angular/core';
import { ViewChild } from '@angular/core';
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

  demoUrl = DEMO_VIDEO_URL;

  private onScroll?: () => void;
  private ghostItems: HTMLElement[] = [];
  private rafId: number | null = null;
  private pending = false;

  constructor(
    private zone: NgZone,
    private router: Router
  ) {}

  ngAfterViewInit(): void {
    const listEl = this.titleList?.nativeElement;
    if (!listEl) return;

    // Collect elements that START as "ghost"
    this.ghostItems = Array.from(listEl.querySelectorAll('li.ghost')) as HTMLElement[];

    const applyState = () => {
      const scroll = window.scrollY || document.documentElement.scrollTop || 0;
      if (scroll < 30) {   // Very top: keep collapsed
        this.ghostItems.forEach((el) => el.classList.add('ghost'));
      } else if (scroll < 250) {    // Middle range: expand
        this.ghostItems.forEach((el) => el.classList.remove('ghost'));
      } else {    // Past threshold: collapse again
        this.ghostItems.forEach((el) => el.classList.add('ghost'));
      }
      this.pending = false;
      this.rafId = null;
    };

    const scheduleApply = () => {
      if (this.pending) return;
      this.pending = true;
      this.rafId = requestAnimationFrame(applyState);
    };

    // Run outside Angular for perf
    this.zone.runOutsideAngular(() => {
      const handler = () => scheduleApply();
      this.onScroll = handler;
      window.addEventListener('scroll', handler, { passive: true });
    });

    // Ensure correct state on first paint
    scheduleApply();
  }

  ngOnDestroy(): void {
    if (this.onScroll) {
      window.removeEventListener('scroll', this.onScroll as EventListener);
    }
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  goToMapPage(): void {
    this.router.navigate(['/atlas']);
  }
}
