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
    document.documentElement.classList.remove('layout-phone', 'layout-desktop');
    document.body.classList.remove('layout-phone', 'layout-desktop');
    document.documentElement.style.removeProperty('--vv-width');
  });

  it('treats widths under 1024 as phone layout', () => {
    mockMatchMedia(true);
    const viewport = new ViewportService();
    expect(viewport.isPhone()).toBeTrue();
    expect(document.body.classList.contains('layout-phone')).toBeTrue();
    expect(document.documentElement.classList.contains('layout-phone')).toBeTrue();
  });

  it('treats 1024 and above as desktop layout', () => {
    mockMatchMedia(false);
    const viewport = new ViewportService();
    expect(viewport.isPhone()).toBeFalse();
    expect(document.body.classList.contains('layout-desktop')).toBeTrue();
    expect(document.documentElement.classList.contains('layout-desktop')).toBeTrue();
  });

  it('records visual viewport width and resets sideways scroll on phone', () => {
    mockMatchMedia(true);
    const scrollTo = spyOn(window, 'scrollTo');
    spyOnProperty(window, 'scrollX', 'get').and.returnValue(18);
    const vv = {
      width: 350,
      offsetLeft: 18,
      addEventListener: () => {},
      removeEventListener: () => {},
    };
    spyOnProperty(window, 'visualViewport', 'get').and.returnValue(vv as unknown as VisualViewport);
    const viewport = new ViewportService();
    expect(document.documentElement.style.getPropertyValue('--vv-width')).toBe('350px');
    expect(scrollTo).toHaveBeenCalledWith(0, window.scrollY);
    viewport.pinHorizontal();
    expect(document.documentElement.style.getPropertyValue('--vv-width')).toBe('350px');
  });

  it('caps --vv-width to window.innerWidth so a leftover keyboard width cannot exceed layout', () => {
    mockMatchMedia(true);
    spyOnProperty(window, 'innerWidth', 'get').and.returnValue(390);
    const vv = {
      width: 480,
      offsetLeft: 0,
      addEventListener: () => {},
      removeEventListener: () => {},
    };
    spyOnProperty(window, 'visualViewport', 'get').and.returnValue(vv as unknown as VisualViewport);
    new ViewportService();
    expect(document.documentElement.style.getPropertyValue('--vv-width')).toBe('390px');
  });

  it('clears the visual viewport width token on desktop', () => {
    mockMatchMedia(false);
    document.documentElement.style.setProperty('--vv-width', '390px');
    new ViewportService();
    expect(document.documentElement.style.getPropertyValue('--vv-width')).toBe('');
  });
});
