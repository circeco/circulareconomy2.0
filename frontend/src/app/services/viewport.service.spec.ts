import { ViewportService, DESKTOP_MIN_WIDTH } from './viewport.service';

describe('ViewportService', () => {
  let listeners: Array<(event: MediaQueryListEvent) => void>;

  function mockMatchMedia(matches: boolean) {
    listeners = [];
    spyOn(window, 'matchMedia').and.callFake((query: string) => {
      expect(query).toContain(String(DESKTOP_MIN_WIDTH - 1));
      return {
        matches,
        addEventListener: (_type: string, fn: (event: MediaQueryListEvent) => void) => {
          listeners.push(fn);
        },
        removeEventListener: () => {},
        addListener: (fn: (event: MediaQueryListEvent) => void) => listeners.push(fn),
        removeListener: () => {},
      } as unknown as MediaQueryList;
    });
  }

  afterEach(() => {
    document.body.classList.remove('layout-phone', 'layout-desktop');
  });

  it('treats widths under 1024 as phone layout', () => {
    mockMatchMedia(true);
    const viewport = new ViewportService();
    expect(viewport.isPhone()).toBeTrue();
    expect(document.body.classList.contains('layout-phone')).toBeTrue();
  });

  it('treats 1024 and above as desktop layout', () => {
    mockMatchMedia(false);
    const viewport = new ViewportService();
    expect(viewport.isPhone()).toBeFalse();
    expect(document.body.classList.contains('layout-desktop')).toBeTrue();
  });
});
