import { Component, AfterViewInit } from '@angular/core';
import { RouterModule } from '@angular/router';
import { CommonModule } from '@angular/common';
import { LegacyLoaderService } from './legacy-loader.service';

declare global {
  interface Window {
    myFunction?: () => void;
    sendMail?: (form: HTMLFormElement) => boolean;
  }
}

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
})
export class AppComponent implements AfterViewInit {
  constructor(private legacy: LegacyLoaderService) {}

  async ngAfterViewInit() {
    try {
      await this.legacy.loadAll();
      // All legacy code has executed by now (including any $(document).ready handlers)
    } catch (e) {
      console.error(e);
    }
  }

  onHamburger() { window.myFunction?.(); }

  onContactSubmit(e: Event) {
    const form = e.target as HTMLFormElement;
    const ok = window.sendMail ? window.sendMail(form) : true;
    if (!ok) e.preventDefault();
  }
}
