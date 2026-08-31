import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { ActivatedRoute } from '@angular/router';

import { MapComponent } from './map.component';
import { MapService } from '../../services/map.service';
import { PlacesFilter } from '../../services/places-filter.service';
import { CityContextService } from '../../services/city-context.service';
import { CitiesService } from '../../services/cities.service';
import { FeaturedPlacesService } from '../../services/featured-places.service';
import { AuthService } from '../../services/auth.service';
import { GeolocationService } from '../../services/geolocation.service';
import { MapServiceStub, PlacesFilterStub } from '../../testing/test-doubles';

describe('MapComponent', () => {
  let component: MapComponent;
  let fixture: ComponentFixture<MapComponent>;
  let geo: GeolocationService;

  beforeEach(async () => {
    try { sessionStorage.removeItem('circeco.geoConsent'); } catch {}
    await TestBed.configureTestingModule({
      imports: [MapComponent],
      providers: [
        { provide: MapService, useClass: MapServiceStub },
        { provide: PlacesFilter, useClass: PlacesFilterStub },
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: { get: () => null } }, queryParams: of({}) } },
        { provide: CityContextService, useValue: { cityId$: of('milan'), cityId: () => 'milan', setCityId: () => {} } },
        { provide: CitiesService, useValue: { cities$: of([{ id: 'milan', name: 'Milan', center: { lat: 45.4642, lng: 9.19 } }]) } },
        {
          provide: FeaturedPlacesService,
          useValue: {
            getGeoJsonForCurrentCity: () => of({ type: 'FeatureCollection', features: [] }),
          },
        },
        { provide: AuthService, useValue: { user$: of(null) } },
        GeolocationService,
      ]
    })
    .compileComponents();

    fixture = TestBed.createComponent(MapComponent);
    component = fixture.componentInstance;
    geo = TestBed.inject(GeolocationService);
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('asks before checking location', () => {
    const spy = spyOn(geo, 'locate');
    component.onLocateControlClick();
    fixture.detectChanges();
    expect(spy).not.toHaveBeenCalled();
    expect(component.locateAskOpen).toBeTrue();
    const title = fixture.nativeElement.querySelector('#locate-consent-title') as HTMLElement;
    expect(title?.textContent).toContain('nearby places');
  });

  it('does not call geolocation when the user chooses Not now', () => {
    const spy = spyOn(geo, 'locate');
    component.onLocateControlClick();
    component.onLocateNotNow();
    fixture.detectChanges();
    expect(spy).not.toHaveBeenCalled();
    expect(component.locateAskOpen).toBeFalse();
    expect(component.nearbyActive).toBeFalse();
  });

  it('keeps the city map when browser location is denied', async () => {
    spyOn(geo, 'locate').and.resolveTo({ ok: false, code: 'denied' });
    await component.onLocateAllow();
    fixture.detectChanges();
    expect(component.nearbyActive).toBeFalse();
    expect(component.locateAskOpen).toBeFalse();
    expect(component.locateStatusMessage).toContain('Location is off');
  });

  it('centers and zooms to the user after a successful locate', async () => {
    const map = TestBed.inject(MapService);
    spyOn(map, 'showUserLocation');
    spyOn(geo, 'locate').and.resolveTo({
      ok: true,
      fix: { lat: 45.4642, lng: 9.19, accuracy: 10 },
    });
    await component.onLocateAllow();
    expect(map.showUserLocation).toHaveBeenCalledWith(9.19, 45.4642, 10, true);
  });
});
