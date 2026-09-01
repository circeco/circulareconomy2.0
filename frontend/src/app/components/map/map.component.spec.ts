import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, Subject } from 'rxjs';
import { ActivatedRoute } from '@angular/router';

import { MapComponent } from './map.component';
import { MapService } from '../../services/map.service';
import { PlacesFilter } from '../../services/places-filter.service';
import { CityContextService } from '../../services/city-context.service';
import { CitiesService } from '../../services/cities.service';
import { FeaturedPlacesService } from '../../services/featured-places.service';
import { AuthService } from '../../services/auth.service';
import { MapServiceStub, PlacesFilterStub } from '../../testing/test-doubles';

const EMPTY_FC = { type: 'FeatureCollection', features: [] };

describe('MapComponent', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  async function createComponent(options?: {
    geojson$?: Subject<{ type: string; features: any[] }>;
    filteredFeatures$?: Subject<any[]>;
  }): Promise<ComponentFixture<MapComponent>> {
    const geojson$ = options?.geojson$;
    const filteredFeatures$ = options?.filteredFeatures$;

    const filterStub = new PlacesFilterStub();
    if (filteredFeatures$) {
      filterStub.filteredFeatures$ = filteredFeatures$.asObservable();
    }

    await TestBed.configureTestingModule({
      imports: [MapComponent],
      providers: [
        { provide: MapService, useClass: MapServiceStub },
        { provide: PlacesFilter, useValue: filterStub },
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: { queryParamMap: { get: () => null } },
            queryParams: of({}),
          },
        },
        { provide: CityContextService, useValue: { cityId$: of('milan'), cityId: () => 'milan' } },
        { provide: CitiesService, useValue: { cities$: of([{ id: 'milan', center: { lat: 45.4642, lng: 9.19 } }]) } },
        {
          provide: FeaturedPlacesService,
          useValue: {
            getGeoJsonForCurrentCity: () => geojson$ ? geojson$.asObservable() : of(EMPTY_FC),
          },
        },
        { provide: AuthService, useValue: { user$: of(null) } },
      ]
    })
    .compileComponents();

    const fixture = TestBed.createComponent(MapComponent);
    fixture.detectChanges();
    return fixture;
  }

  function listingsText(fixture: ComponentFixture<MapComponent>): string {
    return (fixture.nativeElement.querySelector('.listings')?.textContent || '').replace(/\s+/g, ' ').trim();
  }

  it('should create', async () => {
    const fixture = await createComponent();
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('shows loading copy until places data is ready, not the empty-filters sentence', async () => {
    const geojson$ = new Subject<{ type: string; features: any[] }>();
    const fixture = await createComponent({ geojson$ });

    expect(listingsText(fixture)).toContain('Loading places…');
    expect(listingsText(fixture)).not.toContain('No places match the current filters.');

    geojson$.next(EMPTY_FC);
    fixture.detectChanges();

    expect(listingsText(fixture)).not.toContain('Loading places…');
    expect(listingsText(fixture)).toContain('No places match the current filters.');
  });

  it('hides the empty-filters sentence when places are listed', async () => {
    const filteredFeatures$ = new Subject<any[]>();
    const fixture = await createComponent({ filteredFeatures$ });

    filteredFeatures$.next([{
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [9.19, 45.46] },
      properties: { STORE_NAME: 'Milan Repair Cafe' },
    }]);
    fixture.detectChanges();

    expect(listingsText(fixture)).toContain('Milan Repair Cafe');
    expect(listingsText(fixture)).not.toContain('Loading places…');
    expect(listingsText(fixture)).not.toContain('No places match the current filters.');
  });
});
