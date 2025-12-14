import { ComponentFixture, TestBed } from '@angular/core/testing';

import { MapComponent } from './map.component';
import { MapService } from '../../services/map.service';
import { PlacesFilter } from '../../services/places-filter.service';
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
