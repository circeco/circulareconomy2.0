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
import { MapServiceStub, PlacesFilterStub } from '../../testing/test-doubles';

describe('MapComponent', () => {
  let component: MapComponent;
  let fixture: ComponentFixture<MapComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MapComponent],
      providers: [
        { provide: MapService, useClass: MapServiceStub },
        { provide: PlacesFilter, useClass: PlacesFilterStub },
        { provide: ActivatedRoute, useValue: { queryParams: of({}) } },
        { provide: CityContextService, useValue: { cityId$: of('milan') } },
        { provide: CitiesService, useValue: { cities$: of([{ id: 'milan', center: { lat: 45.4642, lng: 9.19 } }]) } },
        {
          provide: FeaturedPlacesService,
          useValue: {
            getGeoJsonForCurrentCity: () => of({ type: 'FeatureCollection', features: [] }),
          },
        },
        { provide: AuthService, useValue: { user$: of(null) } },
      ]
    })
    .compileComponents();

    fixture = TestBed.createComponent(MapComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
